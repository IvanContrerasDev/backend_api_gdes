const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { readFileSync } = require('node:fs');

// Never migrate/reset an existing database: caller supplies a dedicated test database.
assert.match(process.env.TEST_DATABASE_URL || '', /\/gdes_f003_test(?:\?|$)/);
const databaseUrl = process.env.TEST_DATABASE_URL;
const env = Object.fromEntries(
  readFileSync('.env.example', 'utf8')
    .split('\n')
    .filter((x) => x && !x.startsWith('#'))
    .map((x) => {
      const i = x.indexOf('=');
      return [x.slice(0, i), x.slice(i + 1)];
    }),
);
Object.assign(env, process.env, {
  DATABASE_URL: databaseUrl,
  JWT_ACCESS_SECRET: 'test-f004-access-secret',
  PORT: '33446',
});
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const base = 'http://127.0.0.1:33446';
const suffix = randomUUID();
let server, site, admin, employee, pending;
const users = [];
const codes = [];
let sequence = Math.floor(Math.random() * 1000000);
const argon2 = require('argon2');
function token(user, overrides = {}, secret = env.JWT_ACCESS_SECRET, algorithm = 'HS256') {
  const header = Buffer.from(JSON.stringify({ alg: algorithm, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.id,
      role: user.role,
      type: 'access',
      sid: user.sessionId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 1800,
      ...overrides,
    }),
  ).toString('base64url');
  return `${header}.${payload}.${createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')}`;
}
async function request(path, { method = 'GET', body, jwt = token(admin) } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = { status: response.status, body: await response.json() };
  if (path === '/api/v1/users' && method === 'POST' && result.status === 201)
    users.push(result.body.data.id);
  return result;
}
async function error(path, code, status, options) {
  const result = await request(path, options);
  assert.equal(result.status, status, JSON.stringify(result.body));
  assert.equal(result.body.error.code, code);
  assert.equal(result.body.error.retryable, false);
}
before(async () => {
  site = await db.site.findFirstOrThrow();
  for (const role of ['ADMIN', 'EMPLOYEE', 'TO_BE_ADMIN']) {
    const u = await db.user.create({
      data: {
        firstName: 'Test',
        lastName: 'F003',
        email: `${role}-${suffix}@test.local`,
        employeeId: `${role}-${suffix}`,
        dni: `${role}-${suffix}`,
        passwordHash: 'unused',
        emailVerifiedAt: new Date(),
        phone: '1234567890',
        address: 'Test',
        birthDate: new Date('1990-01-01'),
        siteId: site.id,
        role,
      },
    });
    const session = await db.authSession.create({
      data: {
        userId: u.id,
        role: u.role,
        client: role === 'EMPLOYEE' ? 'MOBILE' : 'ADMIN',
        csrfSecret: randomUUID(),
        expiresAt: new Date(Date.now() + 604800000),
      },
    });
    u.sessionId = session.id;
    users.push(u.id);
    if (role === 'ADMIN') admin = u;
    else if (role === 'EMPLOYEE') employee = u;
    else pending = u;
  }
  server = spawn(process.execPath, ['dist/main.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  server.stdout.on('data', (x) => {
    output += x;
    for (const match of x.toString().matchAll(/code=(\d{6})/g)) codes.push(match[1]);
  });
  server.stderr.on('data', (x) => (output += x));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + '/health')).ok) return;
    } catch {}
    if (server.exitCode !== null) throw new Error(output);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${output}`);
});
after(async () => {
  server?.kill('SIGTERM');
  // Delete only this run's fixtures, never production/historical data.

  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});

const detailKeys = [
  'id',
  'firstName',
  'lastName',
  'employeeId',
  'dni',
  'email',
  'phone',
  'site',
  'accountStatus',
  'address',
  'birthDate',
  'cuil',
  'hireDate',
  'position',
  'createdAt',
  'updatedAt',
].sort();
const listKeys = [
  'id',
  'firstName',
  'lastName',
  'employeeId',
  'dni',
  'email',
  'phone',
  'site',
  'accountStatus',
].sort();
function input(patch = {}) {
  sequence++;
  return {
    firstName: '  María ',
    lastName: ' Pérez ',
    employeeId: `F004-${suffix}-${sequence}`,
    dni: String(10000000 + sequence),
    email: `f004-${suffix}-${sequence}@test.local`,
    initialPassword: ' Río montaña luna café 726 ',
    phone: '1234567890',
    address: ' Casa 12 ',
    siteId: site.id,
    birthDate: '2000-02-29',
    ...patch,
  };
}
async function create(patch = {}) {
  const body = input(patch);
  const r = await request('/api/v1/users', { method: 'POST', body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  users.push(r.body.data.id);
  return { ...r.body.data, initialPassword: body.initialPassword };
}
async function session(user) {
  const s = await db.authSession.create({
    data: {
      userId: user.id,
      role: 'EMPLOYEE',
      client: 'MOBILE',
      csrfSecret: randomUUID(),
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  return token({ ...user, role: 'EMPLOYEE', sessionId: s.id });
}
test('employee creation, detail and own profile expose exact safe DTOs with verified Argon2 identity', async () => {
  const u = await create();
  const r = await request(`/api/v1/users/${u.id}`);
  assert.deepEqual(Object.keys(r.body.data).sort(), detailKeys);
  assert.equal(u.firstName, 'María');
  assert.equal(u.address, 'Casa 12');
  assert.equal(u.birthDate, '2000-02-29');
  assert.deepEqual(u.site, { id: site.id, name: site.name });
  assert.equal(u.cuil, null);
  assert.equal(u.hireDate, null);
  assert.equal(u.position, null);
  assert.match(u.createdAt, /Z$/);
  assert.equal(u.accountStatus, 'ACTIVE');
  const row = await db.user.findUniqueOrThrow({ where: { id: u.id } });
  assert.equal(row.role, 'EMPLOYEE');
  assert.ok(row.emailVerifiedAt);
  assert.ok(await argon2.verify(row.passwordHash, u.initialPassword));
  const profile = await request('/api/v1/profile', { jwt: await session(u) });
  assert.equal(profile.status, 200);
  assert.deepEqual(profile.body.data, {
    id: u.id,
    firstName: 'María',
    lastName: 'Pérez',
    employeeId: u.employeeId,
    dni: u.dni,
    email: u.email,
    phone: u.phone,
    address: u.address,
    birthDate: '2000-02-29',
    cuil: null,
    hireDate: null,
    position: null,
  });
});
test('users guards enforce admin CRUD, employee own profile and exclude administrator identities', async () => {
  for (const path of ['/api/v1/users', '/api/v1/profile'])
    await error(path, 'INVALID_TOKEN', 401, { jwt: null });
  for (const [tail, method, body] of [
    ['', 'GET'],
    ['', 'POST', input()],
    [`/${employee.id}`, 'GET'],
    [`/${employee.id}`, 'PATCH', {}],
    [`/${employee.id}/account-status`, 'PATCH', { accountStatus: 'ACTIVE' }],
  ])
    await error('/api/v1/users' + tail, 'ROLE_NOT_ALLOWED', 403, {
      jwt: token(employee),
      method,
      body,
    });
  await error('/api/v1/profile', 'ROLE_NOT_ALLOWED', 403);
  for (const [tail, method, body] of [
    [`/${admin.id}`, 'GET'],
    [`/${admin.id}`, 'PATCH', { firstName: 'Bad' }],
    [`/${admin.id}/account-status`, 'PATCH', { accountStatus: 'INACTIVE' }],
  ])
    await error('/api/v1/users' + tail, 'USER_NOT_FOUND', 404, { method, body });
  await error(`/api/v1/users/${randomUUID()}`, 'USER_NOT_FOUND', 404);
  assert.equal((await request(`/api/v1/users/${employee.id}`, { method: 'DELETE' })).status, 404);
});
test('PATCH preserves omitted and protected fields and supports exactly the nullable profile fields', async () => {
  const u = await create();
  const saved = await db.user.findUniqueOrThrow({ where: { id: u.id } });
  let r = await request(`/api/v1/users/${u.id}`, {
    method: 'PATCH',
    body: {
      cuil: '20123456789',
      hireDate: '2024-02-29',
      position: ' Operario ',
      email: ` ${u.email.toUpperCase()} `,
      initialPassword: 'Changed bad password',
      role: 'SUPER_ADMIN',
      accountStatus: 'INACTIVE',
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.position, 'Operario');
  assert.equal(r.body.data.hireDate, '2024-02-29');
  const row = await db.user.findUniqueOrThrow({ where: { id: u.id } });
  assert.equal(row.passwordHash, saved.passwordHash);
  assert.equal(row.role, 'EMPLOYEE');
  assert.equal(row.accountStatus, 'ACTIVE');
  assert.equal(row.email, u.email);
  r = await request(`/api/v1/users/${u.id}`, {
    method: 'PATCH',
    body: { cuil: null, hireDate: null, position: null },
  });
  assert.equal(r.body.data.cuil, null);
  assert.equal(r.body.data.hireDate, null);
  assert.equal(r.body.data.position, null);
  assert.equal(r.body.data.firstName, u.firstName);
  for (const key of [
    'firstName',
    'lastName',
    'employeeId',
    'dni',
    'email',
    'phone',
    'address',
    'siteId',
    'birthDate',
  ])
    await error(
      `/api/v1/users/${u.id}`,
      key === 'siteId' ? 'INVALID_SITE' : 'INVALID_USER_DATA',
      400,
      { method: 'PATCH', body: { [key]: null } },
    );
});
test('input validation rejects invalid civil dates, fields, sites and pagination', async () => {
  for (const patch of [
    { firstName: '' },
    { firstName: 'x'.repeat(101) },
    { lastName: 12 },
    { employeeId: 'x'.repeat(51) },
    { dni: '123456' },
    { dni: '123456789' },
    { phone: '+1234567890' },
    { phone: '1'.repeat(14) },
    { email: 'bad' },
    { address: ' ' },
    { birthDate: '2023-02-29' },
    { birthDate: '2000-02-30' },
    { birthDate: '2100-01-01' },
    { birthDate: '2000-01-01T00:00:00Z' },
  ])
    await error('/api/v1/users', 'INVALID_USER_DATA', 400, { method: 'POST', body: input(patch) });
  for (const siteId of ['bad', randomUUID()])
    await error('/api/v1/users', 'INVALID_SITE', 400, { method: 'POST', body: input({ siteId }) });
  const u = await create();
  for (const patch of [
    { cuil: '1' },
    { hireDate: '2100-01-01' },
    { hireDate: '2025-02-29' },
    { position: '' },
    { position: 'x'.repeat(101) },
  ])
    await error(`/api/v1/users/${u.id}`, 'INVALID_USER_DATA', 400, {
      method: 'PATCH',
      body: patch,
    });
  for (const query of [
    'page=0',
    'pageSize=101',
    'page=1.5',
    'accountStatus=BAD',
    'search=a&search=b',
    'sortBy=email',
  ])
    await error('/api/v1/users?' + query, 'INVALID_USER_DATA', 400);
});
test('local corpus rejects length-valid common passwords and simple variants, permits Unicode spaces without composition', async () => {
  for (const initialPassword of [
    'short',
    'x'.repeat(129),
    'masterbaiting',
    'Unbelievable',
    'unbelievable123!',
    '  unbelievable  ',
  ])
    await error('/api/v1/users', 'WEAK_PASSWORD', 400, {
      method: 'POST',
      body: input({ initialPassword }),
    });
  for (const initialPassword of ['árbol nieve río montaña', '😀'.repeat(12), 'x'.repeat(128)])
    await create({ initialPassword });
});
test('email, DNI and employeeId uniqueness are global, normalized and safe under concurrent requests', async () => {
  const u = await create();
  for (const [field, value, code] of [
    ['email', ` ${u.email.toUpperCase()} `, 'USER_EMAIL_ALREADY_EXISTS'],
    ['dni', u.dni, 'USER_DNI_ALREADY_EXISTS'],
    ['employeeId', ` ${u.employeeId} `, 'USER_EMPLOYEE_ID_ALREADY_EXISTS'],
    ['email', admin.email, 'USER_EMAIL_ALREADY_EXISTS'],
  ]) {
    await error('/api/v1/users', code, 409, { method: 'POST', body: input({ [field]: value }) });
    const other = await create();
    await error(`/api/v1/users/${other.id}`, code, 409, {
      method: 'PATCH',
      body: { [field]: value },
    });
  }
  const legacy = await create();
  await db.user.update({
    where: { id: legacy.id },
    data: { email: ` LEGACY-${suffix}@TEST.LOCAL ` },
  });
  await error('/api/v1/users', 'USER_EMAIL_ALREADY_EXISTS', 409, {
    method: 'POST',
    body: input({ email: `legacy-${suffix}@test.local` }),
  });
  for (const [field, code] of [
    ['email', 'USER_EMAIL_ALREADY_EXISTS'],
    ['dni', 'USER_DNI_ALREADY_EXISTS'],
    ['employeeId', 'USER_EMPLOYEE_ID_ALREADY_EXISTS'],
  ]) {
    const a = input(),
      b = input({ [field]: a[field] });
    const rs = await Promise.all(
      [a, b].map((body) => request('/api/v1/users', { method: 'POST', body })),
    );
    for (const r of rs) if (r.status === 201) users.push(r.body.data.id);
    assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409]);
    assert.equal(rs.find((r) => r.status === 409).body.error.code, code);
  }
});
test('list has exact DTO, fixed ordering, partial literal case-insensitive search, status filter and pagination', async () => {
  const a = await create({ lastName: `List ${suffix}`, firstName: 'A' }),
    b = await create({ lastName: `List ${suffix}`, firstName: 'B' });
  await request(`/api/v1/users/${b.id}/account-status`, {
    method: 'PATCH',
    body: { accountStatus: 'INACTIVE' },
  });
  const list = await request(
    `/api/v1/users?search=${encodeURIComponent('list ' + suffix)}&pageSize=1&page=2`,
  );
  assert.equal(list.body.data[0].id, b.id);
  assert.deepEqual(Object.keys(list.body.data[0]).sort(), listKeys);
  assert.deepEqual(list.body.pagination, { page: 2, pageSize: 1, totalItems: 2, totalPages: 2 });
  const active = await request(
    `/api/v1/users?search=${encodeURIComponent('list ' + suffix)}&accountStatus=ACTIVE`,
  );
  assert.equal(active.body.data[0].id, a.id);
  assert.equal(active.body.pagination.totalItems, 1);
  for (const search of [a.email.toUpperCase(), a.employeeId.toUpperCase(), a.dni])
    assert.equal(
      (await request(`/api/v1/users?search=${encodeURIComponent(search)}`)).body.data[0].id,
      a.id,
    );
  const all = await request('/api/v1/users');
  assert.equal(all.body.pagination.page, 1);
  assert.equal(all.body.pagination.pageSize, 25);
  assert.ok(!all.body.data.some((x) => x.id === admin.id));
  assert.equal((await request('/api/v1/users?search=%25')).body.pagination.totalItems, 0);
});
test('status changes atomically revoke all sessions; idempotence and reactivation preserve revocation', async () => {
  const u = await create();
  const jwt = await session(u);
  await session(u);
  for (let i = 0; i < 2; i++) {
    const r = await request(`/api/v1/users/${u.id}/account-status`, {
      method: 'PATCH',
      body: { accountStatus: 'INACTIVE' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.accountStatus, 'INACTIVE');
  }
  assert.equal(await db.authSession.count({ where: { userId: u.id, revokedAt: null } }), 0);
  await error('/api/v1/profile', 'ACCOUNT_INACTIVE', 403, { jwt });
  await error('/api/v1/auth/login', 'ACCOUNT_INACTIVE', 403, {
    method: 'POST',
    jwt: null,
    body: { identifier: u.email, password: u.initialPassword, client: 'MOBILE' },
  });
  await request(`/api/v1/users/${u.id}/account-status`, {
    method: 'PATCH',
    body: { accountStatus: 'ACTIVE' },
  });
  await error('/api/v1/profile', 'INVALID_TOKEN', 401, { jwt });
  assert.equal((await request('/api/v1/profile', { jwt: await session(u) })).status, 200);
  await error(`/api/v1/users/${u.id}/account-status`, 'INVALID_USER_DATA', 400, {
    method: 'PATCH',
    body: { accountStatus: 'OTHER' },
  });
});

async function until(predicate) {
  const end = Date.now() + 4000;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail('Expected PostgreSQL lock queue or OTP logger event');
}
async function challenge(u) {
  const before = codes.length;
  const r = await request('/api/v1/auth/login', {
    method: 'POST',
    jwt: null,
    body: { identifier: u.email, password: u.initialPassword, client: 'MOBILE' },
  });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  await until(() => codes.length > before);
  return { challengeId: r.body.data.challengeId, code: codes.at(-1) };
}
async function authenticated(u) {
  const body = await challenge(u);
  const r = await request('/api/v1/auth/otp/verify', { method: 'POST', jwt: null, body });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data;
}
async function blockedBy(pid, minimum = 1) {
  const [row] =
    await db.$queryRaw`WITH RECURSIVE waiters AS (SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND ${pid}::int = ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN waiters w ON w.pid = ANY(pg_blocking_pids(a.pid))) SELECT count(*)::int AS count FROM waiters`;
  return row.count >= minimum;
}
test('account-status HTTP serializes behind rotation and revokes the rotated chain without deadlock', async () => {
  const u = await create();
  const auth = await authenticated(u);
  const sess = await db.authSession.findFirstOrThrow({ where: { userId: u.id } });
  let rotating, deactivating;
  await db.$transaction(
    async (tx) => {
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${sess.id}::uuid FOR UPDATE`;
      rotating = request('/api/v1/auth/refresh', {
        method: 'POST',
        jwt: null,
        body: { refreshToken: auth.tokens.refreshToken },
      });
      await until(() => blockedBy(pid)); // rotation holds User and waits for session
      deactivating = request(`/api/v1/users/${u.id}/account-status`, {
        method: 'PATCH',
        body: { accountStatus: 'INACTIVE' },
      });
      await until(async () => {
        const [row] =
          await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%User%' AND query LIKE '%FOR UPDATE%'`;
        return row.count >= 1;
      });
    },
    { timeout: 10000 },
  );
  const [rotation, deactivation] = await Promise.all([rotating, deactivating]);
  assert.equal(rotation.status, 200, JSON.stringify(rotation.body));
  assert.equal(deactivation.status, 200, JSON.stringify(deactivation.body));
  assert.equal(await db.authSession.count({ where: { userId: u.id, revokedAt: null } }), 0);
  await error('/api/v1/auth/refresh', 'REFRESH_TOKEN_REUSED', 401, {
    method: 'POST',
    jwt: null,
    body: { refreshToken: rotation.body.data.tokens.refreshToken },
  });
});
test('rotation waits behind HTTP deactivation and can never issue credentials after it', async () => {
  const u = await create();
  const auth = await authenticated(u);
  let rotating, deactivating;
  await db.$transaction(
    async (tx) => {
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${u.id}::uuid FOR UPDATE`;
      deactivating = request(`/api/v1/users/${u.id}/account-status`, {
        method: 'PATCH',
        body: { accountStatus: 'INACTIVE' },
      });
      await until(() => blockedBy(pid));
      rotating = request('/api/v1/auth/refresh', {
        method: 'POST',
        jwt: null,
        body: { refreshToken: auth.tokens.refreshToken },
      });
      await until(() => blockedBy(pid, 2));
    },
    { timeout: 10000 },
  );
  const [deactivation, rotation] = await Promise.all([deactivating, rotating]);
  assert.equal(deactivation.status, 200, JSON.stringify(deactivation.body));
  assert.equal(rotation.status, 401, JSON.stringify(rotation.body));
  assert.equal(await db.authSession.count({ where: { userId: u.id, revokedAt: null } }), 0);
});
test('in-flight OTP verification creates a session before HTTP deactivation; the session is still revoked', async () => {
  const u = await create();
  const body = await challenge(u);
  let verifying, deactivating;
  await db.$transaction(
    async (tx) => {
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${u.id}::uuid FOR UPDATE`;
      verifying = request('/api/v1/auth/otp/verify', { method: 'POST', jwt: null, body });
      await until(() => blockedBy(pid));
      deactivating = request(`/api/v1/users/${u.id}/account-status`, {
        method: 'PATCH',
        body: { accountStatus: 'INACTIVE' },
      });
      await until(() => blockedBy(pid, 2));
    },
    { timeout: 10000 },
  );
  const [verified, deactivation] = await Promise.all([verifying, deactivating]);
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  assert.equal(deactivation.status, 200, JSON.stringify(deactivation.body));
  assert.equal(await db.authSession.count({ where: { userId: u.id } }), 1);
  assert.equal(await db.authSession.count({ where: { userId: u.id, revokedAt: null } }), 0);
  await error('/api/v1/profile', 'ACCOUNT_INACTIVE', 403, {
    jwt: verified.body.data.tokens.accessToken,
  });
});
test('civil dates honor real leap years and the GMT-3 day on both sides of UTC midnight', () => {
  const { civilDate } = require('../dist/modules/users/users.validation.js');
  assert.equal(
    civilDate('2026-10-15', new Date('2026-10-16T02:59:59Z')).toISOString(),
    '2026-10-15T00:00:00.000Z',
  );
  assert.throws(() => civilDate('2026-10-16', new Date('2026-10-16T02:59:59Z')));
  assert.equal(
    civilDate('2026-10-16', new Date('2026-10-16T03:00:00Z')).toISOString(),
    '2026-10-16T00:00:00.000Z',
  );
  assert.throws(() => civilDate('1900-02-29'));
  assert.equal(civilDate('2000-02-29').toISOString(), '2000-02-29T00:00:00.000Z');
});
test('normalized DB email index rejects legacy-case duplicates and migration refuses historical collisions without deleting identities', async () => {
  const a = await create(),
    b = await create();
  await assert.rejects(
    db.user.update({ where: { id: b.id }, data: { email: ` ${a.email.toUpperCase()} ` } }),
    (e) => e.code === 'P2002',
  );
  const sql = readFileSync(
    'prisma/migrations/20261016020000_users_email_normalized/migration.sql',
    'utf8',
  );
  const check = sql.slice(0, sql.indexOf('CREATE UNIQUE INDEX'));
  await assert.rejects(
    db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('CREATE TEMP TABLE "User" (email text) ON COMMIT DROP');
      await tx.$executeRawUnsafe(
        `INSERT INTO "User" VALUES ('Alice@example.test'), (' alice@EXAMPLE.test ')`,
      );
      await tx.$executeRawUnsafe(check);
    }),
    (e) => String(e).includes('historical identities collide'),
  );
  assert.equal(await db.user.count({ where: { id: { in: [a.id, b.id] } } }), 2);
});

test('civil year zero is rejected with a user validation error before PostgreSQL persistence', async () => {
  await error('/api/v1/users', 'INVALID_USER_DATA', 400, {
    method: 'POST',
    body: input({ birthDate: '0000-01-01' }),
  });
  const u = await create();
  await error(`/api/v1/users/${u.id}`, 'INVALID_USER_DATA', 400, {
    method: 'PATCH',
    body: { hireDate: '0000-02-29' },
  });
});

test('very large valid pages stay empty and never overflow Prisma pagination', async () => {
  for (const page of ['2147483648', '9007199254740991']) {
    const result = await request(`/api/v1/users?page=${page}&pageSize=1`);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(result.body.data, []);
    assert.equal(result.body.pagination.page, Number(page));
  }
});
test('SUPER_ADMIN manages employees; protected create fields cannot grant roles and profile never accepts another identity', async () => {
  const u = await create({
    role: 'SUPER_ADMIN',
    passwordHash: 'injected',
    accountStatus: 'INACTIVE',
    emailVerifiedAt: null,
    cuil: '20123456789',
  });
  const row = await db.user.findUniqueOrThrow({ where: { id: u.id } });
  assert.equal(row.role, 'EMPLOYEE');
  assert.equal(row.accountStatus, 'ACTIVE');
  assert.ok(row.emailVerifiedAt);
  assert.equal(row.cuil, null);
  const r = await request(`/api/v1/profile?userId=${admin.id}`, { jwt: await session(u) });
  assert.equal(r.body.data.id, u.id);
  await db.user.update({ where: { id: admin.id }, data: { role: 'SUPER_ADMIN' } });
  await db.authSession.update({ where: { id: admin.sessionId }, data: { role: 'SUPER_ADMIN' } });
  try {
    const jwt = token({ ...admin, role: 'SUPER_ADMIN' });
    assert.equal((await request('/api/v1/users', { jwt })).status, 200);
    assert.equal(
      (
        await request(`/api/v1/users/${u.id}`, {
          jwt,
          method: 'PATCH',
          body: { position: 'Supervisor' },
        })
      ).status,
      200,
    );
  } finally {
    await db.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
    await db.authSession.update({ where: { id: admin.sessionId }, data: { role: 'ADMIN' } });
  }
});
