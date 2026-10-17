const { acquireAuthSuiteMutex } = require('./auth-suite-mutex.cjs');
let releaseAuthMutex;
require('reflect-metadata');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
assert.match(process.env.TEST_DATABASE_URL || '', /\/gdes_f003_test(?:\?|$)/);
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const argon2 = require('argon2');
const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const suffix = randomUUID();
let users = [],
  codes = [];
let server;
async function request(
  path,
  { body, method = body ? 'POST' : 'GET', cookie, csrf, origin, jwt } = {},
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: r.status,
    body: r.status === 204 ? null : await r.json(),
    cookie: r.headers.get('set-cookie'),
    headers: r.headers,
  };
}
async function login(user = users[0], client = 'MOBILE', web = {}) {
  const r = await request('/auth/login', {
    body: { identifier: user.employeeId, password: 'legacy pass', client },
    ...web,
  });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.equal(r.body.data.tokens, undefined);
  await new Promise((r) => setTimeout(r, 10));
  return { ...r.body.data, code: codes.at(-1) };
}
async function mobile(user = users[0]) {
  const c = await login(user);
  const r = await request('/auth/otp/verify', {
    body: { challengeId: c.challengeId, code: c.code },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data;
}
async function webBootstrap() {
  const r = await request('/auth/web/csrf');
  return {
    cookie: r.cookie.split(';')[0],
    csrf: r.body.data.csrfToken,
    origin: 'http://localhost:5173',
  };
}
async function adminLogin(rememberSession = false) {
  const web = await webBootstrap();
  const r = await request('/auth/login', {
    body: { identifier: users[1].email, password: 'legacy pass', client: 'ADMIN', rememberSession },
    ...web,
  });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  await new Promise((r) => setTimeout(r, 10));
  const v = await request('/auth/login/2fa/verify', {
    body: { challengeId: r.body.data.challengeId, code: codes.at(-1) },
    ...web,
  });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return v;
}

const base = 'http://127.0.0.1:33444/api/v1';
before(async () => {
  releaseAuthMutex = await acquireAuthSuiteMutex(process.env.TEST_DATABASE_URL);
  const site = await db.site.findFirstOrThrow();
  const passwordHash = await argon2.hash('legacy pass');
  for (const role of ['EMPLOYEE', 'ADMIN', 'TO_BE_ADMIN'])
    users.push(
      await db.user.create({
        data: {
          role,
          firstName: 'Auth',
          lastName: 'Test',
          email: role + '-' + suffix + '@test.local',
          employeeId: role + '-' + suffix,
          dni: role + '-' + suffix,
          passwordHash,
          phone: '1234567890',
          address: 'Test',
          birthDate: new Date('1990-01-01'),
          siteId: site.id,
          emailVerifiedAt: new Date(),
        },
      }),
    );
  const env = Object.fromEntries(
    readFileSync('.env.example', 'utf8')
      .split('\n')
      .filter((x) => x && !x.startsWith('#'))
      .map((x) => {
        const i = x.indexOf('=');
        return [x.slice(0, i), x.slice(i + 1)];
      }),
  );
  server = spawn(process.execPath, ['dist/main.js'], {
    env: {
      ...env,
      ...process.env,
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      PORT: '33444',
      NODE_ENV: 'test',
      EMAIL_PROVIDER: 'log',
      WHATSAPP_PROVIDER: 'log',
      JWT_REFRESH_SECRET: 'test-f002-refresh-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout.on('data', (x) => {
    output += x;
    for (const m of x.toString().matchAll(/code=(\d{6})/g)) codes.push(m[1]);
  });
  server.stderr.on('data', (x) => (output += x));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch('http://127.0.0.1:33444/health')).ok) return;
    } catch {}
    if (server.exitCode !== null) throw Error(output);
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error(output);
});
beforeEach(async () => {
  await db.authRateLimit.deleteMany();
});
after(async () => {
  server?.kill();
  await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  await db.$disconnect();
  if (releaseAuthMutex) await releaseAuthMutex();
});
test('web CSRF bootstrap creates secure preauth cookie without authenticated session', async () => {
  const r = await fetch(base + '/auth/web/csrf');
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(typeof b.data.csrfToken, 'string');
  assert.match(r.headers.get('set-cookie'), /__Host-gdes-preauth=.*HttpOnly.*Secure/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('mobile password login requires OTP; verify emits real JWT and revocable per-session refresh', async () => {
  const c = await login();
  assert.equal(c.otpRequired, true);
  assert.match(c.code, /^\d{6}$/);
  const r = await request('/auth/otp/verify', {
    body: { challengeId: c.challengeId, code: c.code },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const data = r.body.data;
  assert.equal(data.user.role, 'EMPLOYEE');
  assert.equal(data.tokens.expiresIn, 1800);
  assert.equal(typeof data.tokens.refreshToken, 'string');
  assert.equal((await request('/workplaces', { jwt: data.tokens.accessToken })).status, 200);
  assert.equal(
    (await request('/auth/otp/verify', { body: { challengeId: c.challengeId, code: c.code } }))
      .status,
    401,
  );
  const rotated = await request('/auth/refresh', {
    body: { refreshToken: data.tokens.refreshToken },
  });
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.body.data.tokens.refreshToken, data.tokens.refreshToken);
  const replay = await request('/auth/refresh', {
    body: { refreshToken: data.tokens.refreshToken },
  });
  assert.equal(replay.status, 401);
  assert.equal(replay.body.error.code, 'REFRESH_TOKEN_REUSED');
  assert.equal(
    (await request('/workplaces', { jwt: rotated.body.data.tokens.accessToken })).status,
    401,
  );
});
test('role, inactive, unverified and invalid credentials prevent sending challenge', async () => {
  let n = codes.length;
  for (const [user, body, status, code] of [
    [users[1], { client: 'MOBILE' }, 403, 'ROLE_NOT_ALLOWED'],
    [users[2], { client: 'ADMIN' }, 403, 'ADMIN_ACCESS_PENDING'],
    [users[0], { client: 'MOBILE', password: 'wrong' }, 401, 'INVALID_CREDENTIALS'],
  ]) {
    const web = body.client === 'ADMIN' ? await webBootstrap() : {};
    const r = await request('/auth/login', {
      body: { identifier: user.employeeId, password: 'legacy pass', ...body },
      ...web,
    });
    assert.equal(r.status, status, JSON.stringify(r.body));
    assert.equal(r.body.error.code, code);
  }
  for (const [patch, code] of [
    [{ accountStatus: 'INACTIVE' }, 'ACCOUNT_INACTIVE'],
    [{ emailVerifiedAt: null }, 'EMAIL_NOT_VERIFIED'],
  ]) {
    await db.user.update({ where: { id: users[0].id }, data: patch });
    const r = await request('/auth/login', {
      body: { identifier: users[0].email, password: 'legacy pass', client: 'MOBILE' },
    });
    assert.equal(r.body.error.code, code);
    await db.user.update({
      where: { id: users[0].id },
      data: { accountStatus: 'ACTIVE', emailVerifiedAt: new Date() },
    });
  }
  assert.equal(codes.length, n);
});
test('OTP failed attempts persist, expire, reject cross-purpose; resend cooldown preserves attempts', async () => {
  const c = await login();
  const input = { challengeId: c.challengeId, code: c.code === '000000' ? '111111' : '000000' };
  for (let i = 0; i < 5; i++) {
    const r = await request('/auth/otp/verify', { body: input });
    assert.equal(r.status, i === 4 ? 429 : 401);
  }
  assert.equal(
    (await db.authChallenge.findUniqueOrThrow({ where: { id: c.challengeId } })).attempts,
    5,
  );
  assert.equal(
    (await request('/auth/otp/verify', { body: { ...input, code: c.code } })).status,
    429,
  );
  const expired = await login();
  await db.authChallenge.update({
    where: { id: expired.challengeId },
    data: { expiresAt: new Date(0) },
  });
  assert.equal(
    (
      await request('/auth/otp/verify', {
        body: { challengeId: expired.challengeId, code: expired.code },
      })
    ).status,
    410,
  );
  const resend = await login();
  assert.equal(
    (await request('/auth/otp/resend', { body: { challengeId: resend.challengeId } })).body.error
      .code,
    'OTP_RESEND_COOLDOWN',
  );
  await db.authChallenge.update({
    where: { id: resend.challengeId },
    data: { sentAt: new Date(Date.now() - 61000), attempts: 2 },
  });
  const sent = await request('/auth/otp/resend', { body: { challengeId: resend.challengeId } });
  assert.equal(sent.status, 202);
  await new Promise((r) => setTimeout(r, 10));
  const newCode = codes.at(-1);
  const challenge = await db.authChallenge.findUniqueOrThrow({ where: { id: resend.challengeId } });
  assert.equal(challenge.attempts, 2);
  if (newCode !== resend.code)
    assert.equal(
      (
        await request('/auth/otp/verify', {
          body: { challengeId: resend.challengeId, code: resend.code },
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await request('/auth/otp/verify', {
        body: { challengeId: resend.challengeId, code: newCode },
      })
    ).status,
    200,
  );
});
test('web 2FA binds original preauth, CSRF and Origin; cookie never leaks into mobile JSON', async () => {
  const web = await webBootstrap();
  const body = {
    identifier: users[1].email,
    password: 'legacy pass',
    client: 'ADMIN',
    rememberSession: true,
  };
  assert.equal((await request('/auth/login', { body })).status, 400);
  assert.equal(
    (await request('/auth/login', { body, ...web, origin: 'https://evil.test' })).status,
    400,
  );
  const c = await request('/auth/login', { body, ...web });
  assert.equal(c.status, 202);
  await new Promise((r) => setTimeout(r, 10));
  const code = codes.at(-1);
  const input = { challengeId: c.body.data.challengeId, code };
  assert.equal((await request('/auth/otp/verify', { body: input })).status, 401);
  assert.equal(
    (await request('/auth/login/2fa/verify', { body: input, ...(await webBootstrap()) })).status,
    400,
  );
  const v = await request('/auth/login/2fa/verify', { body: input, ...web });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(v.body.data.tokens.refreshToken, undefined);
  assert.equal(v.body.data.rememberSession, true);
  assert.match(v.cookie, /Max-Age=/);
  const cookie = v.cookie.split(';')[0];
  const refresh = cookie.split('=')[1];
  assert.equal((await request('/auth/refresh', { body: { refreshToken: refresh } })).status, 401);
  const session = await request('/auth/web/session', { cookie });
  assert.equal(session.status, 200);
  assert.equal(session.body.data.tokens, undefined);
  const csrf = (await request('/auth/web/csrf', { cookie })).body.data.csrfToken;
  assert.notEqual(csrf, web.csrf);
  const rotate = await request('/auth/web/refresh', { body: {}, cookie, csrf, origin: web.origin });
  assert.equal(rotate.status, 200);
  assert.equal(rotate.body.data.tokens.refreshToken, undefined);
  assert.equal(rotate.body.data.sessionExpiresAt, v.body.data.sessionExpiresAt);
  const replay = await request('/auth/web/refresh', { body: {}, cookie, csrf, origin: web.origin });
  assert.equal(replay.status, 401);
  assert.equal(replay.body.error.code, 'REFRESH_TOKEN_REUSED');
  assert.match(replay.cookie, /Max-Age=0/);
});
test('concurrent refresh and OTP verify succeed at most once; logout revokes only its session', async () => {
  const c = await login();
  const results = await Promise.all(
    [1, 2].map(() =>
      request('/auth/otp/verify', { body: { challengeId: c.challengeId, code: c.code } }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
  const first = results.find((r) => r.status === 200).body.data;
  const refresh = await Promise.all(
    [1, 2].map(() =>
      request('/auth/refresh', { body: { refreshToken: first.tokens.refreshToken } }),
    ),
  );
  assert.deepEqual(refresh.map((r) => r.status).sort(), [200, 401]);
  assert.equal(
    (
      await request('/workplaces', {
        jwt: refresh.find((r) => r.status === 200).body.data.tokens.accessToken,
      })
    ).status,
    401,
  );
  const a = await mobile();
  const b = await mobile();
  assert.equal(
    (await request('/auth/logout', { body: {}, jwt: a.tokens.accessToken })).status,
    204,
  );
  assert.equal((await request('/workplaces', { jwt: a.tokens.accessToken })).status, 401);
  assert.equal((await request('/workplaces', { jwt: b.tokens.accessToken })).status, 200);
});

test('mobile rotation renews seven days while revoked/expired/inactive/changed-role sessions cannot issue tokens', async () => {
  const a = await mobile();
  const token = a.tokens.refreshToken;
  const hash = require('node:crypto')
    .createHmac('sha256', 'test-f002-refresh-secret')
    .update(token)
    .digest('hex');
  const row = await db.authRefreshToken.findUniqueOrThrow({ where: { hash } });
  const old = new Date(Date.now() + 100000);
  await db.authSession.update({ where: { id: row.sessionId }, data: { expiresAt: old } });
  await db.authRefreshToken.update({ where: { hash }, data: { expiresAt: old } });
  const r = await request('/auth/refresh', { body: { refreshToken: token } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.user, undefined);
  const renewed = await db.authSession.findUniqueOrThrow({ where: { id: row.sessionId } });
  assert.ok(renewed.expiresAt.getTime() > Date.now() + 604000000);
  const b = await mobile();
  const bt = await db.authRefreshToken.findUniqueOrThrow({
    where: {
      hash: require('node:crypto')
        .createHmac('sha256', 'test-f002-refresh-secret')
        .update(b.tokens.refreshToken)
        .digest('hex'),
    },
  });
  await db.authSession.update({ where: { id: bt.sessionId }, data: { expiresAt: new Date(0) } });
  assert.equal(
    (await request('/auth/refresh', { body: { refreshToken: b.tokens.refreshToken } })).status,
    401,
  );
  for (const patch of [{ accountStatus: 'INACTIVE' }, { role: 'ADMIN' }]) {
    const m = await mobile();
    await db.user.update({ where: { id: users[0].id }, data: patch });
    try {
      assert.ok(
        [401, 403].includes(
          (await request('/auth/refresh', { body: { refreshToken: m.tokens.refreshToken } }))
            .status,
        ),
      );
    } finally {
      await db.user.update({
        where: { id: users[0].id },
        data: { accountStatus: 'ACTIVE', role: 'EMPLOYEE' },
      });
    }
  }
});
test('web session cookie persistence, logout, expired limit, Unicode CSRF and authenticated login precedence', async () => {
  const v = await adminLogin(false);
  assert.doesNotMatch(v.cookie.split(',')[0], /Max-Age=/);
  const cookie = v.cookie.split(';')[0];
  const csrf = (await request('/auth/web/csrf', { cookie })).body.data.csrfToken;
  assert.equal(
    (
      await request('/auth/web/logout', {
        body: {},
        cookie,
        csrf: 'é'.repeat(64),
        origin: 'http://localhost:5173',
      })
    ).status,
    400,
  );
  const r = await request('/auth/login', {
    body: { identifier: users[1].employeeId, password: 'legacy pass', client: 'ADMIN' },
    cookie,
    csrf,
    origin: 'http://localhost:5173',
  });
  assert.equal(r.status, 400);
  assert.equal(
    (await request('/auth/web/logout', { body: {}, cookie, csrf, origin: 'http://localhost:5173' }))
      .status,
    204,
  );
  assert.equal((await request('/auth/web/session', { cookie })).status, 401);
  const expires = await adminLogin();
  const eCookie = expires.cookie.split(';')[0];
  const refresh = eCookie.split('=')[1];
  const row = await db.authRefreshToken.findUniqueOrThrow({
    where: {
      hash: require('node:crypto')
        .createHmac('sha256', 'test-f002-refresh-secret')
        .update(refresh)
        .digest('hex'),
    },
  });
  await db.authSession.update({ where: { id: row.sessionId }, data: { expiresAt: new Date(0) } });
  assert.equal((await request('/auth/web/session', { cookie: eCookie })).status, 401);
  const invalid = await request('/auth/otp/verify', { body: { challengeId: 'bad', code: 12 } });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.headers.get('cache-control'), 'no-store');
});

test('login identifier ambiguity is rejected; DB rate limits survive new challenges and admin email does not require mobile verification', async () => {
  const hash = await argon2.hash('legacy pass');
  const duplicate = await db.user.create({
    data: {
      ...Object.fromEntries(
        Object.entries(users[0]).filter(
          ([key]) => !['id', 'createdAt', 'updatedAt', 'employeeId', 'email', 'dni'].includes(key),
        ),
      ),
      passwordHash: hash,
      email: 'alias-' + suffix + '@test.local',
      employeeId: users[0].email,
      dni: 'alias-' + suffix,
    },
  });
  users.push(duplicate);
  const ambiguous = await request('/auth/login', {
    body: { identifier: users[0].email, password: 'legacy pass', client: 'MOBILE' },
  });
  assert.equal(ambiguous.status, 401);
  assert.equal(ambiguous.body.error.code, 'INVALID_CREDENTIALS');
  await db.user.update({ where: { id: users[1].id }, data: { emailVerifiedAt: null } });
  try {
    await adminLogin();
  } finally {
    await db.user.update({ where: { id: users[1].id }, data: { emailVerifiedAt: new Date() } });
  }
  for (let i = 0; i < 10; i++)
    assert.equal(
      (
        await request('/auth/login', {
          body: { identifier: 'missing-' + suffix, password: 'wrong', client: 'MOBILE' },
        })
      ).status,
      401,
    );
  const limited = await request('/auth/login', {
    body: { identifier: 'missing-' + suffix, password: 'wrong', client: 'MOBILE' },
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'TOO_MANY_ATTEMPTS');
  assert.equal(limited.body.error.retryable, true);
  const challenges = [];
  for (let i = 0; i < 5; i++) challenges.push(await login());
  for (let i = 0; i < 20; i++) {
    const c = challenges[Math.floor(i / 4)];
    assert.equal(
      (
        await request('/auth/otp/verify', {
          body: { challengeId: c.challengeId, code: c.code === '000000' ? '111111' : '000000' },
        })
      ).status,
      401,
    );
  }
  const c = challenges.at(-1);
  assert.equal(
    (await request('/auth/otp/verify', { body: { challengeId: c.challengeId, code: c.code } }))
      .status,
    429,
  );
});
test('refresh races logout and replay without ever restoring a revoked chain', async () => {
  async function waiting() {
    const r =
      await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND (query LIKE '%AuthSession%' OR query LIKE '%User%')`;
    return r[0].count;
  }
  async function until(n) {
    const end = Date.now() + 3000;
    while (Date.now() < end) {
      if ((await waiting()) >= n) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.fail('Expected session lock wait');
  }
  for (const mode of ['refresh-first', 'logout-first', 'replay-first']) {
    const a = await mobile();
    let token = a.tokens.refreshToken;
    let jwt = a.tokens.accessToken;
    let old = token;
    if (mode === 'replay-first') {
      const rotated = await request('/auth/refresh', { body: { refreshToken: token } });
      token = rotated.body.data.tokens.refreshToken;
      jwt = rotated.body.data.tokens.accessToken;
    }
    const row = await db.authRefreshToken.findUniqueOrThrow({
      where: {
        hash: require('node:crypto')
          .createHmac('sha256', 'test-f002-refresh-secret')
          .update(token)
          .digest('hex'),
      },
    });
    let first, second;
    await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "AuthSession" WHERE "id"=${row.sessionId}::uuid FOR UPDATE`;
        first =
          mode === 'logout-first'
            ? request('/auth/logout', { body: {}, jwt })
            : request('/auth/refresh', {
                body: { refreshToken: mode === 'replay-first' ? old : token },
              });
        await until(1);
        second =
          mode === 'refresh-first'
            ? request('/auth/logout', { body: {}, jwt })
            : request('/auth/refresh', { body: { refreshToken: token } });
        await until(2);
      },
      { timeout: 10000 },
    );
    await Promise.all([first, second]);
    const session = await db.authSession.findUniqueOrThrow({ where: { id: row.sessionId } });
    assert.ok(session.revokedAt, mode);
    assert.equal((await request('/workplaces', { jwt })).status, 401);
  }
});

test('configuration rejects shared JWT secrets and log notification providers in production', async () => {
  const example = Object.fromEntries(
    readFileSync('.env.example', 'utf8')
      .split('\n')
      .filter((x) => x && !x.startsWith('#'))
      .map((x) => {
        const i = x.indexOf('=');
        return [x.slice(0, i), x.slice(i + 1)];
      }),
  );
  const { validateEnv } = require('../dist/config/env.validation');
  assert.throws(
    () => validateEnv({ ...example, JWT_ACCESS_SECRET: 'same', JWT_REFRESH_SECRET: 'same' }),
    /distinct/,
  );
  const child = spawn(process.execPath, ['dist/main.js'], {
    env: {
      ...example,
      ...process.env,
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'prod-test-access',
      JWT_REFRESH_SECRET: 'prod-test-refresh',
      PORT: '33445',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (x) => (output += x));
  child.stderr.on('data', (x) => (output += x));
  const exit = await new Promise((resolve) => child.on('exit', resolve));
  assert.notEqual(exit, 0);
  assert.match(output, /notification providers are not implemented/);
});

test('rotation serializes behind account deactivation without deadlock or restoring credentials', async () => {
  const a = await mobile();
  let rotating;
  try {
    await db.$transaction(
      async (tx) => {
        await tx.user.update({ where: { id: users[0].id }, data: { accountStatus: 'INACTIVE' } });
        rotating = request('/auth/refresh', { body: { refreshToken: a.tokens.refreshToken } });
        const end = Date.now() + 3000;
        let waiting = false;
        while (Date.now() < end) {
          const rows =
            await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%User%'`;
          if (rows[0].count) {
            waiting = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 10));
        }
        assert.ok(waiting, 'rotation must wait on account lock');
        await tx.authSession.updateMany({
          where: { userId: users[0].id },
          data: { revokedAt: new Date() },
        });
      },
      { timeout: 10000 },
    );
    const r = await rotating;
    assert.equal(r.status, 401, JSON.stringify(r.body));
  } finally {
    await rotating;
    await db.user.update({ where: { id: users[0].id }, data: { accountStatus: 'ACTIVE' } });
  }
});

test('OTP expiring while waiting for the account lock never consumes or emits credentials for either client', async () => {
  for (const [client, user, path] of [
    ['MOBILE', users[0], '/auth/otp/verify'],
    ['ADMIN', users[1], '/auth/login/2fa/verify'],
  ]) {
    const web = client === 'ADMIN' ? await webBootstrap() : {};
    const c = await login(user, client, web);
    const expiresAt = new Date(Date.now() + 600);
    await db.authChallenge.update({ where: { id: c.challengeId }, data: { expiresAt } });
    const sessions = await db.authSession.count({ where: { userId: user.id } });
    let verifying;
    await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${user.id}::uuid FOR UPDATE`;
        verifying = request(path, { body: { challengeId: c.challengeId, code: c.code }, ...web });
        const deadline = Date.now() + 3000;
        let waiting = false;
        while (Date.now() < deadline) {
          const rows =
            await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%User%' AND query LIKE '%FOR UPDATE%'`;
          if (rows[0].count) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.ok(waiting, 'verify must reach the account lock before the challenge expires');
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 50)),
        );
      },
      { timeout: 10000 },
    );
    const r = await verifying;
    assert.equal(r.status, 410, JSON.stringify(r.body));
    assert.equal(r.body.error.code, 'OTP_EXPIRED');
    assert.equal(
      (await db.authChallenge.findUniqueOrThrow({ where: { id: c.challengeId } })).consumedAt,
      null,
    );
    assert.equal(await db.authSession.count({ where: { userId: user.id } }), sessions);
  }
});
test('malformed JSON auth errors use Spanish BAD_REQUEST and no-store', async () => {
  const r = await fetch(base + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{bad',
  });
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), {
    error: { code: 'BAD_REQUEST', message: 'Solicitud inválida', retryable: false },
  });
  assert.equal(r.headers.get('cache-control'), 'no-store');
});
