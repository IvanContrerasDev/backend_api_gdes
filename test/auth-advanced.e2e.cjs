const { acquireAuthSuiteMutex } = require('./auth-suite-mutex.cjs');
let releaseAuthMutex;
require('reflect-metadata');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const argon2 = require('argon2');
const { NestFactory } = require('@nestjs/core');
const { PrismaClient } = require('@prisma/client');

assert.match(process.env.TEST_DATABASE_URL || '', /\/gdes_f003_test(?:\?|$)/);
const example = Object.fromEntries(
  readFileSync('.env.example', 'utf8')
    .split('\n')
    .filter((x) => x && !x.startsWith('#'))
    .map((x) => {
      const i = x.indexOf('=');
      return [x.slice(0, i), x.slice(i + 1)];
    }),
);
Object.assign(process.env, example, {
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  NODE_ENV: 'test',
  EMAIL_PROVIDER: 'log',
  WHATSAPP_PROVIDER: 'log',
  API_PUBLIC_URL: 'http://localhost:3000',
  JWT_ACCESS_SECRET: 'f008a-test-access',
  JWT_REFRESH_SECRET: 'f008a-test-refresh',
});
const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const run = randomUUID();
const password = 'luna violeta de jacarandá';
const nextPassword = 'sendero verde bajo estrellas';
const messages = { emails: [], otps: [] };
let app, base, site, mainUser;
let emailFails = false,
  otpFails = false;
let serial = Math.floor(Math.random() * 1000000);
const ids = [];
const profiles = [];

function profile(overrides = {}) {
  serial++;
  const value = {
    firstName: 'Registro',
    lastName: 'Prueba',
    email: `f008a-${run}-${serial}@example.com`,
    password,
    phone: '5493511234567',
    employeeId: `f008a-${run}-${serial}`,
    dni: String(10000000 + serial),
    address: 'Calle sin red 123',
    siteId: site.id,
    birthDate: '1990-01-01',
    ...overrides,
  };
  profiles.push(value);
  return value;
}
async function fixture(overrides = {}) {
  const value = profile();
  const { password: ignored, ...fields } = value;
  const user = await db.user.create({
    data: {
      ...fields,
      birthDate: new Date(fields.birthDate),
      passwordHash: await argon2.hash(password),
      emailVerifiedAt: new Date(),
      role: 'EMPLOYEE',
      ...overrides,
    },
  });
  ids.push(user.id);
  return user;
}
async function request(
  path,
  { body, method = body === undefined ? 'GET' : 'POST', jwt, headers = {} } = {},
) {
  const response = await fetch(base + path, {
    method,
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text && response.status !== 302 ? JSON.parse(text) : null,
    headers: response.headers,
    location: response.headers.get('location'),
  };
}
function error(result, status, code) {
  assert.equal(result.status, status, JSON.stringify(result.body));
  assert.equal(result.body.error.code, code);
  assert.equal(result.headers.get('cache-control'), 'no-store');
}
function tokenFromLastEmail(email) {
  const message = messages.emails.findLast((x) => x.to === email);
  assert.ok(message, 'fake provider must capture a message for the fixture');
  const href = /href=["']([^"']+)["']/.exec(message.html)?.[1]?.replaceAll('&amp;', '&');
  assert.ok(href, 'email must provide actionable link');
  const url = new URL(href);
  assert.ok(url.searchParams.get('token'));
  return { url, token: url.searchParams.get('token') };
}
async function register(value = profile()) {
  const result = await request('/auth/register', { body: value });
  assert.equal(result.status, 202, JSON.stringify(result.body));
  assert.deepEqual(Object.keys(result.body.data).sort(), ['challengeId', 'otpRequired']);
  assert.equal(result.body.data.otpRequired, true);
  const otp = messages.otps.at(-1);
  assert.equal(otp.phone, value.phone);
  assert.match(otp.code, /^\d{6}$/);
  return { ...result.body.data, code: otp.code, profile: value };
}
async function verifyRegistration(challenge) {
  const result = await request('/auth/otp/verify', {
    body: { challengeId: challenge.challengeId, code: challenge.code },
  });
  assert.equal(result.status, 202, JSON.stringify(result.body));
  assert.deepEqual(result.body, { data: { emailVerificationRequired: true } });
  const user = await db.user.findUniqueOrThrow({ where: { email: challenge.profile.email } });
  ids.push(user.id);
  const until = Date.now() + 6000;
  while (!messages.emails.some((x) => x.to === user.email) && Date.now() < until)
    await new Promise((r) => setTimeout(r, 20));
  assert.ok(
    messages.emails.some((x) => x.to === user.email),
    'registration worker must send verification email',
  );
  return user;
}
async function mobile(user = mainUser, secret = password) {
  const login = await request('/auth/login', {
    body: { identifier: user.email, password: secret, client: 'MOBILE' },
  });
  assert.equal(login.status, 202, JSON.stringify(login.body));
  const code = messages.otps.at(-1).code;
  const result = await request('/auth/otp/verify', {
    body: { challengeId: login.body.data.challengeId, code },
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body.data;
}
async function recovery(user = mainUser) {
  const before = messages.emails.filter((x) => x.to === user.email).length;
  const result = await request('/auth/password-recovery', { body: { email: user.email } });
  assert.equal(result.status, 202, JSON.stringify(result.body));
  assert.deepEqual(result.body, { data: { sent: true } });
  const until = Date.now() + 6000;
  while (messages.emails.filter((x) => x.to === user.email).length <= before && Date.now() < until)
    await new Promise((r) => setTimeout(r, 20));
  assert.ok(
    messages.emails.filter((x) => x.to === user.email).length > before,
    'durable email worker must send to existing recipient',
  );
  return tokenFromLastEmail(user.email).token;
}

async function startApplication() {
  // Boot the production AppModule. Replace only external provider methods on injected
  // instances; keep HTTP pipes/controllers, real Argon2, Prisma and guards intact.
  const { AppModule } = require('../dist/app.module');
  const {
    EmailProvider,
    WhatsAppProvider,
  } = require('../dist/modules/notifications/notifications.service');
  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/v1/auth/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  const unavailable = () => {
    const { ApiException } = require('../dist/common/errors/api.exception');
    return new ApiException(503, 'NOTIFICATION_UNAVAILABLE', 'No se pudo enviar la notificación');
  };
  app.get(EmailProvider).sendEmail = async (input) => {
    if (emailFails) throw unavailable();
    messages.emails.push(structuredClone(input));
  };
  app.get(WhatsAppProvider).sendOtp = async (input) => {
    if (otpFails) throw unavailable();
    messages.otps.push(structuredClone(input));
  };
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()) + '/api/v1';
}
before(async () => {
  releaseAuthMutex = await acquireAuthSuiteMutex(process.env.TEST_DATABASE_URL);
  await startApplication();
  site = await db.site.findFirstOrThrow();
  mainUser = await fixture();
});

beforeEach(async () => {
  emailFails = false;
  otpFails = false;
  await db.authRateLimit.deleteMany();
});
after(async () => {
  if (app) await app.close();
  // Delete only encrypted intents addressed to this run, never another worker namespace.
  const crypto = require('node:crypto');
  const queueKey = crypto
    .createHmac('sha256', 'f008a-test-refresh')
    .update('gdes:auth-email-intent:v1')
    .digest();
  const owned = [];
  for (const intent of await db.authEmailIntent.findMany()) {
    try {
      const [iv, tag, data] = intent.emailCiphertext
        .split('.')
        .map((x) => Buffer.from(x, 'base64url'));
      const decipher = crypto.createDecipheriv('aes-256-gcm', queueKey, iv);
      decipher.setAuthTag(tag);
      const email = Buffer.concat([decipher.update(data), decipher.final()]).toString();
      if (email.includes(run)) owned.push(intent.id);
    } catch {
      /* Another configured delivery namespace. */
    }
  }
  await db.authEmailIntent.deleteMany({ where: { id: { in: owned } } });
  await db.registrationChallenge.deleteMany({
    where: {
      identityHash: {
        in: profiles.map((p) =>
          require('node:crypto')
            .createHmac('sha256', 'f008a-test-refresh')
            .update('register-identity:' + p.email)
            .digest('hex'),
        ),
      },
    },
  });
  await db.user.deleteMany({
    where: {
      OR: [
        { id: { in: ids } },
        { email: { in: profiles.map((p) => p.email.trim().toLowerCase()) } },
      ],
    },
  });
  await db.$disconnect();
  if (releaseAuthMutex) await releaseAuthMutex();
});

test('registration creates no account until OTP and no session before local email verification', async () => {
  const challenge = await register();
  assert.equal(await db.user.count({ where: { email: challenge.profile.email } }), 0);
  const user = await verifyRegistration(challenge);
  assert.equal(user.role, 'EMPLOYEE');
  assert.equal(user.accountStatus, 'ACTIVE');
  assert.equal(user.emailVerifiedAt, null);
  assert.ok(await argon2.verify(user.passwordHash, password));
  assert.equal(await db.authSession.count({ where: { userId: user.id } }), 0);
  error(
    await request('/auth/login', { body: { identifier: user.email, password, client: 'MOBILE' } }),
    403,
    'EMAIL_NOT_VERIFIED',
  );
  const { url, token } = tokenFromLastEmail(user.email);
  error(
    await request('/auth/password-reset', { body: { token, newPassword: nextPassword } }),
    401,
    'INVALID_TOKEN',
  );
  assert.equal(url.origin, 'http://localhost:3000');
  assert.equal(url.pathname, '/api/v1/auth/email/verify');
  const verified = await request('/auth/email/verify?token=' + encodeURIComponent(token));
  assert.equal(verified.status, 302);
  assert.equal(verified.location, 'gdes://email-verified?success=true');
  assert.equal(verified.headers.get('cache-control'), 'no-store');
  assert.ok((await mobile(user)).tokens.accessToken);
  error(
    await request('/auth/email/verify?token=' + encodeURIComponent(token)),
    401,
    'INVALID_TOKEN',
  );
});

test('registration validates exactly ten fields with users civil/profile rules and local password policy', async () => {
  for (const overrides of [
    { birthDate: '2026-02-30' },
    { birthDate: '0000-01-01' },
    { phone: '+5493511234567' },
    { dni: '123' },
    { siteId: randomUUID() },
    { firstName: ' ' },
    { password: 'password12345' },
    { password: 'corta' },
    { password: '🪻'.repeat(129) },
    { role: 'ADMIN' },
    { emailVerifiedAt: new Date().toISOString() },
  ])
    error(await request('/auth/register', { body: profile(overrides) }), 422, 'VALIDATION_ERROR');
  const missing = profile();
  delete missing.address;
  error(await request('/auth/register', { body: missing }), 422, 'VALIDATION_ERROR');
});

test('a valid128 code-point password stays usable after registration and email verification', async () => {
  const secret = '🪻'.repeat(128);
  const challenge = await register(profile({ password: secret }));
  const user = await verifyRegistration(challenge);
  const { token } = tokenFromLastEmail(user.email);
  assert.equal(
    (await request('/auth/email/verify?token=' + encodeURIComponent(token))).status,
    302,
  );
  assert.ok((await mobile(user, secret)).tokens.accessToken);
});

test('registration uniqueness is global with original register error codes and races do not create twice', async () => {
  for (const [field, code] of [
    ['email', 'USER_ALREADY_EXISTS'],
    ['employeeId', 'EMPLOYEE_ID_ALREADY_EXISTS'],
    ['dni', 'DNI_ALREADY_EXISTS'],
  ]) {
    const payload = profile({ [field]: mainUser[field] });
    error(await request('/auth/register', { body: payload }), 409, code);
  }
  const first = await register();
  const second = await register({ ...first.profile, firstName: 'No puede pisar' });
  const responses = await Promise.all(
    [first, second].map((c) =>
      request('/auth/otp/verify', { body: { challengeId: c.challengeId, code: c.code } }),
    ),
  );
  assert.deepEqual(responses.map((r) => r.status).sort(), [202, 409]);
  const created = await db.user.findMany({ where: { email: first.profile.email } });
  assert.equal(created.length, 1);
  ids.push(created[0].id);
  assert.equal(await db.authSession.count({ where: { userId: created[0].id } }), 0);
});

test('registration OTP wrong attempts are durable and a consumed challenge cannot be resent', async () => {
  const c = await register();
  const wrong = c.code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) {
    error(
      await request('/auth/otp/verify', { body: { challengeId: c.challengeId, code: wrong } }),
      i === 4 ? 429 : 401,
      i === 4 ? 'TOO_MANY_ATTEMPTS' : 'INVALID_OTP',
    );
  }
  error(
    await request('/auth/otp/verify', { body: { challengeId: c.challengeId, code: c.code } }),
    429,
    'TOO_MANY_ATTEMPTS',
  );
  const next = await register();
  error(
    await request('/auth/otp/resend', { body: { challengeId: next.challengeId } }),
    429,
    'OTP_RESEND_COOLDOWN',
  );
  await verifyRegistration(next);
  error(
    await request('/auth/otp/resend', { body: { challengeId: next.challengeId } }),
    401,
    'INVALID_OTP',
  );
});

test('neutral email endpoints conceal existing, verified, missing and provider-failure cases', async () => {
  const unverified = await fixture({ emailVerifiedAt: null });
  for (const path of ['/auth/password-recovery', '/auth/email-verification/resend']) {
    for (const email of [mainUser.email, unverified.email, `absent-${run}@example.com`]) {
      const r = await request(path, { body: { email } });
      assert.equal(r.status, 202, JSON.stringify(r.body));
      assert.deepEqual(r.body, { data: { sent: true } });
    }
    emailFails = true;
    const r = await request(path, { body: { email: unverified.email } });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    assert.deepEqual(r.body, { data: { sent: true } });
    emailFails = false;
  }
});

test('recovery uses fixed admin link, purpose separation and reset revokes old mobile credentials', async () => {
  const session = await mobile();
  const unused = await request('/auth/login', {
    body: { identifier: mainUser.email, password, client: 'MOBILE' },
  });
  const staleCode = messages.otps.at(-1).code;
  const token = await recovery();
  const { url } = tokenFromLastEmail(mainUser.email);
  assert.equal(url.origin, 'http://localhost:5173');
  assert.equal(url.pathname, '/password-reset');
  error(
    await request('/auth/email/verify?token=' + encodeURIComponent(token)),
    401,
    'INVALID_TOKEN',
  );
  const result = await request('/auth/password-reset', {
    body: { token, newPassword: nextPassword },
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(result.body, { data: { updated: true } });
  error(
    await request('/auth/password-reset', { body: { token, newPassword: password } }),
    401,
    'INVALID_TOKEN',
  );
  error(
    await request('/auth/otp/verify', {
      body: { challengeId: unused.body.data.challengeId, code: staleCode },
    }),
    401,
    'INVALID_OTP',
  );
  error(
    await request('/auth/otp/resend', { body: { challengeId: unused.body.data.challengeId } }),
    401,
    'INVALID_OTP',
  );
  assert.equal((await request('/profile', { jwt: session.tokens.accessToken })).status, 401);
  assert.equal(
    (await request('/auth/refresh', { body: { refreshToken: session.tokens.refreshToken } }))
      .status,
    401,
  );
  error(
    await request('/auth/login', {
      body: { identifier: mainUser.email, password, client: 'MOBILE' },
    }),
    401,
    'INVALID_CREDENTIALS',
  );
  await mobile(mainUser, nextPassword);
  await db.user.update({
    where: { id: mainUser.id },
    data: { passwordHash: await argon2.hash(password) },
  });
});

test('parallel resets consume a token once and invalidate sibling recovery tokens', async () => {
  const first = await recovery();
  const second = await recovery();
  const responses = await Promise.all(
    [1, 2].map(() =>
      request('/auth/password-reset', { body: { token: second, newPassword: nextPassword } }),
    ),
  );
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 401]);
  error(
    await request('/auth/password-reset', { body: { token: first, newPassword: password } }),
    401,
    'INVALID_TOKEN',
  );
  await db.user.update({
    where: { id: mainUser.id },
    data: { passwordHash: await argon2.hash(password) },
  });
});

test('notification failure during register never creates credentials and provider retry stays possible', async () => {
  otpFails = true;
  const value = profile();
  error(await request('/auth/register', { body: value }), 503, 'NOTIFICATION_UNAVAILABLE');
  assert.equal(await db.user.count({ where: { email: value.email } }), 0);
  otpFails = false;
  const c = await register(value);
  emailFails = true;
  const result = await request('/auth/otp/verify', {
    body: { challengeId: c.challengeId, code: c.code },
  });
  assert.equal(result.status, 202, JSON.stringify(result.body));
  assert.equal(result.body?.data?.tokens, undefined);
  const user = await db.user.findUnique({ where: { email: value.email } });
  if (user) {
    ids.push(user.id);
    assert.equal(await db.authSession.count({ where: { userId: user.id } }), 0);
  }
  emailFails = false;
  const resend = await request('/auth/email-verification/resend', { body: { email: value.email } });
  assert.equal(resend.status, 202);
});

test('Google SDK adapter requires strict trusted claims and never exposes upstream token errors', async () => {
  const { ConfigService } = require('@nestjs/config');
  const { GoogleIdentityService } = require('../dist/modules/auth/google-identity.service');
  const payload = {
    sub: 'google-sub',
    email: ' Person@Example.com ',
    email_verified: true,
    aud: 'expected-google-client',
    iss: 'https://accounts.google.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  let options;
  const sdk = {
    async verifyIdToken(value) {
      options = value;
      return { getPayload: () => payload };
    },
  };
  const service = new GoogleIdentityService(
    new ConfigService({ GOOGLE_CLIENT_ID: 'expected-google-client' }),
    sdk,
  );
  assert.equal(await service.verify('sdk-token'), 'person@example.com');
  assert.deepEqual(options, { idToken: 'sdk-token', audience: 'expected-google-client' });
  for (const changes of [
    { aud: ['expected-google-client'] },
    { aud: 'other' },
    { iss: 'attacker' },
    { exp: Math.floor(Date.now() / 1000) - 1 },
    { email_verified: 'true' },
    { email_verified: false },
    { email: undefined },
  ]) {
    const altered = { ...payload, ...changes };
    const verifier = {
      async verifyIdToken() {
        return { getPayload: () => altered };
      },
    };
    await assert.rejects(
      new GoogleIdentityService(
        new ConfigService({ GOOGLE_CLIENT_ID: 'expected-google-client' }),
        verifier,
      ).verify('private-token'),
      (e) => {
        assert.equal(e.code, 'INVALID_GOOGLE_TOKEN');
        assert.doesNotMatch(JSON.stringify(e), /private-token/);
        return true;
      },
    );
  }
  await assert.rejects(
    new GoogleIdentityService(new ConfigService({ GOOGLE_CLIENT_ID: 'expected-google-client' }), {
      async verifyIdToken() {
        throw new Error('Invalid token signature private-token');
      },
    }).verify('private-token'),
    (e) => e.code === 'INVALID_GOOGLE_TOKEN' && !JSON.stringify(e).includes('private-token'),
  );
});

test('Google login keeps local contact/profile, requires local eligibility and issues credentials only after OTP', async () => {
  const { GoogleIdentityService } = require('../dist/modules/auth/google-identity.service');
  const adapter = app.get(GoogleIdentityService);
  const original = adapter.verify;
  const user = await fixture();
  adapter.verify = async () => user.email.toUpperCase();
  try {
    const start = await request('/auth/google', {
      body: { idToken: 'fake-sdk-token', phone: '1234567890' },
    });
    assert.equal(start.status, 202, JSON.stringify(start.body));
    assert.equal(start.body.data.tokens, undefined);
    assert.equal(messages.otps.at(-1).phone, user.phone);
    const challenge = await db.authChallenge.findUniqueOrThrow({
      where: { id: start.body.data.challengeId },
    });
    assert.equal(challenge.purpose, 'GOOGLE_LOGIN');
    const result = await request('/auth/otp/verify', {
      body: { challengeId: challenge.id, code: messages.otps.at(-1).code },
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.ok(result.body.data.tokens.accessToken);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).phone, user.phone);
    for (const [changes, code] of [
      [{ accountStatus: 'INACTIVE' }, 'ACCOUNT_INACTIVE'],
      [{ emailVerifiedAt: null }, 'EMAIL_NOT_VERIFIED'],
      [{ role: 'ADMIN' }, 'ROLE_NOT_ALLOWED'],
    ]) {
      await db.user.update({
        where: { id: user.id },
        data: {
          accountStatus: 'ACTIVE',
          emailVerifiedAt: new Date(),
          role: 'EMPLOYEE',
          ...changes,
        },
      });
      error(
        await request('/auth/google', { body: { idToken: 'fake', phone: user.phone } }),
        403,
        code,
      );
    }
    adapter.verify = async () => `absent-google-${run}@example.com`;
    error(
      await request('/auth/google', { body: { idToken: 'fake', phone: user.phone } }),
      404,
      'USER_NOT_FOUND',
    );
  } finally {
    adapter.verify = original;
  }
});

async function waitForLock(pattern, event) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const rows =
      await db.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ${'%' + pattern + '%'} AND (${event || null}::text IS NULL OR wait_event=${event || null})`;
    if (rows[0].n > 0) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail('expected a real PostgreSQL lock wait');
}
async function signedAt(user, purpose, issuedAt) {
  const { AuthLinksService } = require('../dist/modules/auth/auth-links.service');
  const original = Date.now;
  Date.now = () => issuedAt;
  try {
    return (await db.$transaction((tx) => app.get(AuthLinksService).create(tx, user, purpose)))
      .token;
  } finally {
    Date.now = original;
  }
}

test('signed links persist hashes only, enforce exact purpose TTL and do not accept forged or expired tokens', async () => {
  const user = await fixture({ emailVerifiedAt: null });
  for (const [purpose, ttl, path] of [
    ['EMAIL_VERIFICATION', 86400000, '/auth/email/verify'],
    ['PASSWORD_RESET', 3600000, '/auth/password-reset'],
  ]) {
    const issuedAt = Date.now();
    const token = await signedAt(user, purpose, issuedAt);
    const row = await db.authLink.findFirstOrThrow({ where: { userId: user.id, purpose } });
    assert.equal(row.expiresAt.getTime() - row.createdAt.getTime(), ttl);
    assert.notEqual(row.hash, token);
    assert.doesNotMatch(JSON.stringify(row), new RegExp(token.replaceAll('.', '\\.')));
    const expired = await signedAt(user, purpose, Date.now() - ttl - 2000);
    const result = path.includes('email')
      ? await request(path + '?token=' + encodeURIComponent(expired))
      : await request(path, { body: { token: expired, newPassword: nextPassword } });
    error(result, 410, 'TOKEN_EXPIRED');
  }
  error(
    await request('/auth/password-reset', { body: { token: 'forged', newPassword: nextPassword } }),
    401,
    'INVALID_TOKEN',
  );
  const token = await recovery(user);
  error(
    await request('/auth/password-reset', { body: { token, newPassword: 'password12345' } }),
    422,
    'VALIDATION_ERROR',
  );
  assert.equal(
    (
      await db.authLink.findFirstOrThrow({
        where: {
          hash: require('node:crypto')
            .createHmac('sha256', 'f008a-test-refresh')
            .update('gdes:auth-link:hash:PASSWORD_RESET:' + token)
            .digest('hex'),
        },
      })
    ).consumedAt,
    null,
  );
});

test('link expiry is checked again after real User lock waits for both purposes', async () => {
  for (const purpose of ['EMAIL_VERIFICATION', 'PASSWORD_RESET']) {
    const user = await fixture({ emailVerifiedAt: null });
    const ttl = purpose === 'PASSWORD_RESET' ? 3600000 : 86400000;
    const target = Math.ceil(Date.now() / 1000) * 1000 + 1000;
    const token = await signedAt(user, purpose, target - ttl);
    let operation;
    await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${user.id}::uuid FOR UPDATE`;
        operation =
          purpose === 'PASSWORD_RESET'
            ? request('/auth/password-reset', { body: { token, newPassword: nextPassword } })
            : request('/auth/email/verify?token=' + encodeURIComponent(token));
        await waitForLock('User');
        await new Promise((r) => setTimeout(r, Math.max(0, target - Date.now() + 30)));
      },
      { timeout: 10000 },
    );
    error(await operation, 410, 'TOKEN_EXPIRED');
    assert.equal(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt,
      null,
    );
    assert.ok(
      await argon2.verify(
        (await db.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash,
        password,
      ),
    );
  }
});

test('old email links and contact OTP cannot authorize a destination changed through admin PATCH', async () => {
  const admin = await fixture({ role: 'ADMIN' });
  const session = await db.authSession.create({
    data: {
      userId: admin.id,
      role: 'ADMIN',
      client: 'ADMIN',
      csrfSecret: randomUUID(),
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  const { JwtService } = require('@nestjs/jwt');
  const jwt = new JwtService().sign(
    { sub: admin.id, role: 'ADMIN', type: 'access', sid: session.id },
    { secret: 'f008a-test-access', expiresIn: 1800 },
  );
  const user = await fixture();
  const resetToken = await recovery(user);
  const verifyToken = await signedAt(user, 'EMAIL_VERIFICATION', Date.now());
  const login = await request('/auth/login', {
    body: { identifier: user.email, password, client: 'MOBILE' },
  });
  const code = messages.otps.at(-1).code;
  const nextEmail = `edited-${run}@example.com`;
  const edit = await request('/users/' + user.id, {
    method: 'PATCH',
    body: { email: nextEmail, phone: '1234567890' },
    jwt,
  });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  error(
    await request('/auth/email/verify?token=' + encodeURIComponent(verifyToken)),
    401,
    'INVALID_TOKEN',
  );
  error(
    await request('/auth/password-reset', {
      body: { token: resetToken, newPassword: nextPassword },
    }),
    401,
    'INVALID_TOKEN',
  );
  error(
    await request('/auth/otp/verify', { body: { challengeId: login.body.data.challengeId, code } }),
    401,
    'INVALID_OTP',
  );
  error(
    await request('/auth/otp/resend', { body: { challengeId: login.body.data.challengeId } }),
    401,
    'INVALID_OTP',
  );
  const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(after.email, nextEmail);
  assert.ok(await argon2.verify(after.passwordHash, password));
  assert.equal(await db.authSession.count({ where: { userId: user.id } }), 0);
});

test('reset holding User never waits on a Challenge already held by OTP verify', async () => {
  const user = await fixture();
  const login = await request('/auth/login', {
    body: { identifier: user.email, password, client: 'MOBILE' },
  });
  const code = messages.otps.at(-1).code;
  const token = await recovery(user);
  const key = Math.floor(Math.random() * 1000000000) + 100000;
  const fn = 'f008a_' + randomUUID().replaceAll('-', '');
  const gateUrl = new URL(process.env.TEST_DATABASE_URL);
  gateUrl.searchParams.set('connection_limit', '1');
  const gate = new PrismaClient({ datasources: { db: { url: gateUrl.href } } });
  let resetting, verifying;
  try {
    await db.$executeRawUnsafe(
      `CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${user.id}'::uuid AND NEW."passwordHash" IS DISTINCT FROM OLD."passwordHash" THEN PERFORM pg_advisory_xact_lock(${key}); END IF; RETURN NEW; END $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER "${fn}" BEFORE UPDATE OF "passwordHash" ON "User" FOR EACH ROW EXECUTE FUNCTION "${fn}"()`,
    );
    await gate.$queryRaw`SELECT pg_advisory_lock(${key})::text`;
    resetting = request('/auth/password-reset', { body: { token, newPassword: nextPassword } });
    await waitForLock('User', 'advisory');
    verifying = request('/auth/otp/verify', {
      body: { challengeId: login.body.data.challengeId, code },
    });
    await waitForLock('FOR UPDATE');
    await gate.$queryRaw`SELECT pg_advisory_unlock(${key})`;
    assert.equal((await resetting).status, 200);
    error(await verifying, 401, 'INVALID_OTP');
    assert.equal(await db.authSession.count({ where: { userId: user.id } }), 0);
  } finally {
    await gate.$disconnect();
    await Promise.allSettled([resetting, verifying].filter(Boolean));
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${fn}" ON "User"`);
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${fn}"()`);
  }
});

test('registration expiry/replay/retention and global identity attempt budget cannot be reset by replacement', async () => {
  const c = await register();
  const row = await db.registrationChallenge.findUniqueOrThrow({ where: { id: c.challengeId } });
  assert.equal(row.payload.password, undefined);
  assert.ok(row.payload.passwordHash.startsWith('$argon2'));
  assert.notEqual(row.codeHash, c.code);
  await db.registrationChallenge.update({
    where: { id: c.challengeId },
    data: { expiresAt: new Date(Date.now() - 1), sentAt: new Date(Date.now() - 61000) },
  });
  error(
    await request('/auth/otp/verify', { body: { challengeId: c.challengeId, code: c.code } }),
    410,
    'OTP_EXPIRED',
  );
  assert.equal(
    (await request('/auth/otp/resend', { body: { challengeId: c.challengeId } })).status,
    202,
  );
  const currentCode = messages.otps.at(-1).code;
  const verify = await Promise.all(
    [1, 2].map(() =>
      request('/auth/otp/verify', { body: { challengeId: c.challengeId, code: currentCode } }),
    ),
  );
  assert.deepEqual(verify.map((x) => x.status).sort(), [202, 401]);
  const user = await db.user.findUniqueOrThrow({ where: { email: c.profile.email } });
  ids.push(user.id);
  assert.equal(
    (await db.registrationChallenge.findUniqueOrThrow({ where: { id: c.challengeId } })).payload,
    null,
  );
  const old = await register();
  await db.registrationChallenge.update({
    where: { id: old.challengeId },
    data: { createdAt: new Date(Date.now() - 73 * 3600000), sentAt: new Date(Date.now() - 61000) },
  });
  error(
    await request('/auth/otp/resend', { body: { challengeId: old.challengeId } }),
    410,
    'OTP_EXPIRED',
  );
  const { AuthRegistrationService } = require('../dist/modules/auth/auth-registration.service');
  await app.get(AuthRegistrationService).purge();
  assert.equal(
    (await db.registrationChallenge.findUniqueOrThrow({ where: { id: old.challengeId } })).payload,
    null,
  );
  const shared = profile();
  for (let batch = 0; batch < 5; batch++) {
    const attempt = await register(shared);
    const wrong = attempt.code === '000000' ? '111111' : '000000';
    for (let n = 0; n < 4; n++)
      error(
        await request('/auth/otp/verify', {
          body: { challengeId: attempt.challengeId, code: wrong },
        }),
        401,
        'INVALID_OTP',
      );
  }
  const replacement = await register(shared);
  error(
    await request('/auth/otp/verify', {
      body: { challengeId: replacement.challengeId, code: replacement.code },
    }),
    429,
    'TOO_MANY_ATTEMPTS',
  );
});

test('API_PUBLIC_URL is explicit HTTPS in production and rejects attacker-controlled URL components', () => {
  const { validateEnv } = require('../dist/config/env.validation');
  const real = {
    ...example,
    EMAIL_PROVIDER: 'resend',
    WHATSAPP_PROVIDER: 'meta',
    WHATSAPP_PHONE_NUMBER_ID: '123456',
    WHATSAPP_API_VERSION: 'v23.0',
    WHATSAPP_OTP_TEMPLATE_NAME: 'otp',
    WHATSAPP_TEMPLATE_LANGUAGE: 'es_AR',
    NODE_ENV: 'production',
    ADMIN_FRONTEND_URL: 'https://admin.example.com',
  };
  for (const value of [
    'https://api.example.com/path',
    'https://me:pass@api.example.com',
    'https://api.example.com?redirect=x',
    'https://api.example.com#x',
  ])
    assert.throws(() => validateEnv({ ...example, API_PUBLIC_URL: value }), /API_PUBLIC_URL/);
  assert.throws(() => validateEnv({ ...real, API_PUBLIC_URL: undefined }), /API_PUBLIC_URL/);
  assert.throws(
    () => validateEnv({ ...real, API_PUBLIC_URL: 'http://api.example.com' }),
    /API_PUBLIC_URL/,
  );
  assert.doesNotThrow(() => validateEnv({ ...real, API_PUBLIC_URL: 'https://api.example.com' }));
});

test('neutral requests respond while an existing-recipient provider is blocked and durable retries keep one token', async () => {
  const { EmailProvider } = require('../dist/modules/notifications/notifications.service');
  const provider = app.get(EmailProvider);
  const original = provider.sendEmail;
  const user = await fixture();
  let release, entered;
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const sent = [];
  provider.sendEmail = async (input) => {
    if (input.to === user.email) {
      sent.push(input);
      entered();
      await gate;
    } else await original(input);
  };
  try {
    const response = await Promise.race([
      request('/auth/password-recovery', { body: { email: user.email } }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('neutral request awaited provider')), 1500),
      ),
    ]);
    assert.equal(response.status, 202);
    await waiting;
    const absent = await request('/auth/password-recovery', {
      body: { email: `not-existing-${run}@example.com` },
    });
    assert.deepEqual(absent.body, response.body);
    const intent = await db.authEmailIntent.findFirstOrThrow({
      where: { link: { userId: user.id } },
    });
    const serialized = JSON.stringify(intent);
    assert.ok(!serialized.includes(user.email));
    assert.ok(
      !serialized.includes(
        new URL(/href="([^"]+)"/.exec(sent[0].html)[1]).searchParams.get('token'),
      ),
    );
    release();
    await new Promise((resolve) => setTimeout(resolve, 30));
  } finally {
    release();
    provider.sendEmail = original;
  }
});

test('registration rechecks OTP expiry after a unique-index insertion wait and rolls back the new account', async () => {
  const c = await register();
  const expiresAt = new Date(Date.now() + 1200);
  await db.registrationChallenge.update({ where: { id: c.challengeId }, data: { expiresAt } });
  let verifying;
  const rollback = new Error('controlled fixture rollback');
  try {
    await db.$transaction(
      async (tx) => {
        const { password: ignored, ...p } = c.profile;
        await tx.user.create({
          data: {
            ...p,
            birthDate: new Date(p.birthDate),
            passwordHash: 'fixture-rollback-only',
            role: 'EMPLOYEE',
          },
        });
        verifying = request('/auth/otp/verify', {
          body: { challengeId: c.challengeId, code: c.code },
        });
        await waitForLock('INSERT');
        await new Promise((r) => setTimeout(r, Math.max(0, expiresAt.getTime() - Date.now() + 50)));
        throw rollback;
      },
      { timeout: 10000 },
    );
  } catch (e) {
    if (e !== rollback) throw e;
  }
  const result = await verifying;
  // Record a failed regression fixture for cleanup even before the fix is present.
  const accidental = await db.user.findUnique({ where: { email: c.profile.email } });
  if (accidental) ids.push(accidental.id);
  error(result, 410, 'OTP_EXPIRED');
  assert.equal(accidental, null);
});

test('expired worker leases are fenced and other delivery namespaces cannot consume or mutate the intent', async () => {
  const { AuthLinksService } = require('../dist/modules/auth/auth-links.service');
  const { AuthService } = require('../dist/modules/auth/auth.service');
  const { PrismaService } = require('../dist/prisma/prisma.service');
  const { ConfigService } = require('@nestjs/config');
  const { JwtService } = require('@nestjs/jwt');
  const { EmailProvider } = require('../dist/modules/notifications/notifications.service');
  const { PasswordPolicyService } = require('../dist/modules/users/password-policy.service');
  const user = await fixture();
  const appDb = app.get(PrismaService);
  const originalFind = appDb.user.findFirst;
  let release, entered;
  const gate = new Promise((r) => {
    release = r;
  });
  const waiting = new Promise((r) => {
    entered = r;
  });
  let blocked = false;
  appDb.user.findFirst = async function (args) {
    if (!blocked && args.where?.email?.equals === user.email) {
      blocked = true;
      entered();
      await gate;
    }
    return originalFind.call(this, args);
  };
  const config = app.get(ConfigService);
  const args = [
    appDb,
    config,
    app.get(JwtService),
    app.get(AuthService),
    app.get(EmailProvider),
    app.get(PasswordPolicyService),
  ];
  try {
    assert.equal(
      (await request('/auth/password-recovery', { body: { email: user.email } })).status,
      202,
    );
    await waiting;
    const intent = await db.authEmailIntent.findFirstOrThrow({
      where: { completedAt: null, linkId: null, attempts: 1 },
      orderBy: { createdAt: 'desc' },
    });
    await db.authEmailIntent.update({
      where: { id: intent.id },
      data: { lockedUntil: new Date(Date.now() - 1) },
    });
    const wrongArgs = [...args];
    wrongArgs[1] = new ConfigService({
      ...process.env,
      JWT_REFRESH_SECRET: 'another-server-key',
      API_PUBLIC_URL: 'https://other.example.com',
    });
    await new AuthLinksService(...wrongArgs).drain();
    assert.equal(
      (await db.authEmailIntent.findUniqueOrThrow({ where: { id: intent.id } })).attempts,
      1,
      'different namespace must not claim or consume retries',
    );
    await new AuthLinksService(...args).drain();
    release();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(
      await db.authLink.count({ where: { userId: user.id, purpose: 'PASSWORD_RESET' } }),
      1,
    );
    const delivery = messages.emails.filter((x) => x.to === user.email);
    assert.equal(delivery.length, 1);
    const final = await db.authEmailIntent.findUniqueOrThrow({ where: { id: intent.id } });
    assert.equal(final.attempts, 2);
    assert.ok(final.completedAt);
  } finally {
    release();
    appDb.user.findFirst = originalFind;
  }
});

test('failed email delivery survives application restart and reuses identical message, signed token and idempotency key', async () => {
  const { EmailProvider } = require('../dist/modules/notifications/notifications.service');
  const user = await fixture();
  const sent = [];
  const provider = app.get(EmailProvider);
  const original = provider.sendEmail;
  provider.sendEmail = async (input) => {
    if (input.to === user.email) {
      sent.push(structuredClone(input));
      throw new Error('test transient provider failure');
    }
    return original(input);
  };
  assert.equal(
    (await request('/auth/password-recovery', { body: { email: user.email } })).status,
    202,
  );
  const until = Date.now() + 5000;
  let intent;
  while (Date.now() < until) {
    intent = await db.authEmailIntent.findFirst({
      where: { link: { userId: user.id }, attempts: 1, lockedUntil: null },
    });
    if (intent) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.ok(intent, 'first failed attempt must leave durable retry');
  assert.equal(sent.length, 1);
  await app.close();
  app = undefined;
  await db.authEmailIntent.update({
    where: { id: intent.id },
    data: { nextAttemptAt: new Date(), lockedUntil: null },
  });
  const before = messages.emails.length;
  await startApplication();
  const retryUntil = Date.now() + 5000;
  while (!messages.emails.slice(before).some((x) => x.to === user.email) && Date.now() < retryUntil)
    await new Promise((r) => setTimeout(r, 20));
  const retried = messages.emails.slice(before).find((x) => x.to === user.email);
  assert.deepEqual(retried, sent[0]);
  assert.equal(
    await db.authLink.count({ where: { userId: user.id, purpose: 'PASSWORD_RESET' } }),
    1,
  );
});

test('real Google SDK verifies an offline RSA signature and the adapter rejects tampering without network', async () => {
  const {
    GoogleIdentityService,
    googleTokenVerifier,
  } = require('../dist/modules/auth/google-identity.service');
  const { ConfigService } = require('@nestjs/config');
  const crypto = require('node:crypto');
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sdk = googleTokenVerifier();
  sdk.getFederatedSignonCertsAsync = async () => ({
    certs: { test: keys.publicKey.export({ type: 'spki', format: 'pem' }) },
    format: 'PEM',
  });
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: 'test-sub',
    aud: 'offline-client',
    iss: 'accounts.google.com',
    iat: now,
    exp: now + 3600,
    email: 'offline@example.com',
    email_verified: true,
  };
  function signed(data, key = keys.privateKey) {
    const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(data)).toString('base64url');
    return (
      head +
      '.' +
      body +
      '.' +
      crypto.sign('RSA-SHA256', Buffer.from(head + '.' + body), key).toString('base64url')
    );
  }
  const adapter = new GoogleIdentityService(
    new ConfigService({ GOOGLE_CLIENT_ID: 'offline-client' }),
    sdk,
  );
  assert.equal(await adapter.verify(signed(payload)), 'offline@example.com');
  const wrong = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  for (const token of [
    signed(payload, wrong.privateKey),
    signed({ ...payload, aud: 'other' }),
    signed({ ...payload, iss: 'attacker' }),
    signed({ ...payload, exp: now - 1 }),
  ])
    await assert.rejects(
      adapter.verify(token),
      (e) => e.code === 'INVALID_GOOGLE_TOKEN' && !JSON.stringify(e).includes(token),
    );
});

test('Google OTP expiry after account lock and resend use current credential/contact generation', async () => {
  const { GoogleIdentityService } = require('../dist/modules/auth/google-identity.service');
  const adapter = app.get(GoogleIdentityService),
    original = adapter.verify;
  const user = await fixture();
  adapter.verify = async () => user.email;
  try {
    const start = await request('/auth/google', { body: { idToken: 'fake', phone: '1234567890' } });
    const id = start.body.data.challengeId,
      code = messages.otps.at(-1).code;
    const expiresAt = new Date(Date.now() + 1000);
    await db.authChallenge.update({ where: { id }, data: { expiresAt } });
    let verifying;
    await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${user.id}::uuid FOR UPDATE`;
        verifying = request('/auth/otp/verify', { body: { challengeId: id, code } });
        await waitForLock('User');
        await new Promise((r) => setTimeout(r, Math.max(0, expiresAt.getTime() - Date.now() + 30)));
      },
      { timeout: 10000 },
    );
    error(await verifying, 410, 'OTP_EXPIRED');
    await db.authChallenge.update({
      where: { id },
      data: { sentAt: new Date(Date.now() - 61000) },
    });
    assert.equal((await request('/auth/otp/resend', { body: { challengeId: id } })).status, 202);
    const current = messages.otps.at(-1);
    assert.equal(current.phone, user.phone);
    await db.user.update({
      where: { id: user.id },
      data: { email: `google-edited-${run}@example.com` },
    });
    error(
      await request('/auth/otp/verify', { body: { challengeId: id, code: current.code } }),
      401,
      'INVALID_OTP',
    );
    error(await request('/auth/otp/resend', { body: { challengeId: id } }), 401, 'INVALID_OTP');
  } finally {
    adapter.verify = original;
  }
});

test('deactivation after issuing links never reactivates or changes the password', async () => {
  const user = await fixture({ emailVerifiedAt: null });
  const token = await recovery(user),
    emailToken = await signedAt(user, 'EMAIL_VERIFICATION', Date.now());
  await db.user.update({ where: { id: user.id }, data: { accountStatus: 'INACTIVE' } });
  error(
    await request('/auth/password-reset', { body: { token, newPassword: nextPassword } }),
    403,
    'ACCOUNT_INACTIVE',
  );
  error(
    await request('/auth/email/verify?token=' + encodeURIComponent(emailToken)),
    403,
    'ACCOUNT_INACTIVE',
  );
  const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(after.accountStatus, 'INACTIVE');
  assert.equal(after.emailVerifiedAt, null);
  assert.ok(await argon2.verify(after.passwordHash, password));
});

test('registration verification commits a durable email intent and returns202 while the provider is blocked', async () => {
  const { EmailProvider } = require('../dist/modules/notifications/notifications.service');
  const provider = app.get(EmailProvider),
    original = provider.sendEmail;
  const c = await register();
  let release, entered;
  const gate = new Promise((r) => {
      release = r;
    }),
    waiting = new Promise((r) => {
      entered = r;
    });
  provider.sendEmail = async (input) => {
    if (input.to === c.profile.email) {
      entered();
      await gate;
    }
    return original(input);
  };
  try {
    const result = await Promise.race([
      request('/auth/otp/verify', { body: { challengeId: c.challengeId, code: c.code } }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('registration awaited external email')), 1500),
      ),
    ]);
    assert.equal(result.status, 202, JSON.stringify(result.body));
    assert.deepEqual(result.body, { data: { emailVerificationRequired: true } });
    const user = await db.user.findUniqueOrThrow({ where: { email: c.profile.email } });
    ids.push(user.id);
    assert.equal(user.emailVerifiedAt, null);
    assert.equal(await db.authSession.count({ where: { userId: user.id } }), 0);
    const intent = await db.authEmailIntent.findFirstOrThrow({
      where: { link: { userId: user.id, purpose: 'EMAIL_VERIFICATION' } },
    });
    assert.ok(intent.linkId);
    await Promise.race([
      waiting,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('worker never dispatched registration email')), 5000),
      ),
    ]);
    error(
      await request('/auth/otp/verify', { body: { challengeId: c.challengeId, code: c.code } }),
      401,
      'INVALID_OTP',
    );
    assert.equal(await db.user.count({ where: { email: c.profile.email } }), 1);
  } finally {
    release();
    provider.sendEmail = original;
  }
});
