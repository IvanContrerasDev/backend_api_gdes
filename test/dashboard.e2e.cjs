const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { PrismaClient } = require('@prisma/client');
assert.match(process.env.TEST_DATABASE_URL || '', /\/gdes_f003_test(?:\?|$)/);
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
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  JWT_ACCESS_SECRET: 'test-f009-access-secret',
  PORT: '33449',
});
const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
const base = 'http://127.0.0.1:33449';
const suffix = randomUUID();
const users = [],
  clients = [];
let server, site, employee, other, admin, workplace;
function token(user) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.id,
      role: user.role,
      type: 'access',
      sid: user.sessionId,
      exp: Math.floor(Date.now() / 1000) + 1800,
    }),
  ).toString('base64url');
  return `${header}.${payload}.${createHmac('sha256', env.JWT_ACCESS_SECRET).update(`${header}.${payload}`).digest('base64url')}`;
}
async function request(
  path,
  {
    body,
    method = body === undefined ? 'GET' : 'POST',
    user = employee,
    jwt = user ? token(user) : null,
  } = {},
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
async function place(overrides = {}) {
  const client = await db.client.create({ data: { name: `F009 ${randomUUID()}` } });
  clients.push(client.id);
  return db.workplace.create({
    data: {
      clientId: client.id,
      siteId: site.id,
      name: `Lugar ${randomUUID()}`,
      latitude: 0,
      longitude: 0,
      radiusMeters: 100,
      gpsAccuracyThreshold: null,
      ...overrides,
    },
  });
}
async function person(role = 'EMPLOYEE') {
  const key = randomUUID();
  const user = await db.user.create({
    data: {
      firstName: 'Test',
      lastName: 'F009',
      email: `${key}@test.local`,
      dni: key,
      employeeId: key,
      passwordHash: 'unused',
      phone: '1234567890',
      address: 'Test',
      birthDate: new Date('1990-01-01'),
      siteId: site.id,
      role,
      emailVerifiedAt: new Date(),
    },
  });
  users.push(user.id);
  const session = await db.authSession.create({
    data: {
      userId: user.id,
      client: role === 'EMPLOYEE' ? 'MOBILE' : 'ADMIN',
      role,
      csrfSecret: randomUUID(),
      expiresAt: new Date(Date.now() + 604800000),
    },
  });
  return { ...user, sessionId: session.id };
}
before(async () => {
  site = await db.site.findFirstOrThrow();
  employee = await person();
  other = await person();
  admin = await person('ADMIN');
  workplace = await place();
  server = spawn(process.execPath, ['dist/main.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  server.stdout.on('data', (x) => (output += x));
  server.stderr.on('data', (x) => (output += x));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + '/health')).ok) return;
    } catch {}
    if (server.exitCode !== null) throw Error(output);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error(output);
});
after(async () => {
  server?.kill('SIGTERM');
  if (db.timesheet) await db.timesheet.deleteMany({ where: { employeeId: { in: users } } });
  if (db.interval) await db.interval.deleteMany({ where: { record: { userId: { in: users } } } });
  if (db.attendanceEvent) await db.attendanceEvent.deleteMany({ where: { userId: { in: users } } });
  if (db.attendanceRecord)
    await db.attendanceRecord.deleteMany({ where: { userId: { in: users } } });
  await db.workplace.deleteMany({ where: { clientId: { in: clients } } });
  await db.client.deleteMany({ where: { id: { in: clients } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});

const fields = [
  'pendingTimesheets',
  'incompleteRecords',
  'pendingReviewRecords',
  'recordsWithAbsence',
];
const zero = {
  pendingTimesheets: 0,
  incompleteRecords: 0,
  pendingReviewRecords: 0,
  recordsWithAbsence: 0,
};
async function metrics(query = 'month=10&year=2038', options = {}) {
  return request('/api/v1/dashboard/metrics?' + query, { user: admin, ...options });
}
function counts(row) {
  return Object.fromEntries(fields.map((field) => [field, row[field]]));
}
function assertShape(data) {
  assert.deepEqual(Object.keys(data).sort(), [...fields, 'byProvince'].sort());
  for (const province of data.byProvince) {
    assert.deepEqual(Object.keys(province).sort(), [...fields, 'id', 'name'].sort());
    for (const field of fields)
      assert.ok(Number.isSafeInteger(province[field]) && province[field] >= 0);
  }
  for (const field of fields) {
    assert.ok(Number.isSafeInteger(data[field]) && data[field] >= 0);
    assert.equal(
      data[field],
      data.byProvince.reduce((total, row) => total + row[field], 0),
    );
  }
}
async function daily(
  who,
  p,
  date,
  { incomplete = false, reviewStatus = 'NONE', absences = 0, siteId = p.siteId } = {},
) {
  return db.attendanceRecord.create({
    data: {
      userId: who.id,
      workplaceId: p.id,
      clientId: p.clientId,
      siteId,
      date: new Date(date + 'T00:00:00Z'),
      recordStatus: incomplete ? 'INCOMPLETE' : 'COMPLETE',
      reviewStatus,
      origin: 'AUTOMATIC',
      intervals: {
        create: Array.from({ length: absences }, (_, i) => ({
          sequence: i + 1,
          type: 'ABSENCE',
          intervalStatus: 'CLOSED',
          origin: 'AUTOMATIC',
        })),
      },
    },
  });
}
async function sheet(who, p, month, year, status = 'PENDING', overrides = {}) {
  return db.timesheet.create({
    data: {
      employeeId: who.id,
      workplaceId: p.id,
      month,
      year,
      status,
      sequenceNumber: 1,
      fileKey: randomUUID(),
      fileName: 'planilla.pdf',
      fileExtension: 'pdf',
      fileSizeBytes: 50,
      uploadedById: admin.id,
      ...overrides,
    },
  });
}

test('empty dashboard returns exact counters and every province in deterministic order including zeroes', async () => {
  const r = await metrics('month=1&year=2199');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body), ['data']);
  assertShape(r.body.data);
  assert.deepEqual(counts(r.body.data), zero);
  assert.equal(r.body.data.byProvince.length, 6);
  assert.deepEqual(
    r.body.data.byProvince.map((s) => s.name),
    ['Catamarca', 'La Rioja', 'Mendoza', 'Salta', 'San Juan', 'San Luis'],
  );
  assert.ok(r.body.data.byProvince.every((s) => fields.every((field) => s[field] === 0)));
});

test('monthly counts are independent, include inactive historical data and use historical workplace province instead of employee', async () => {
  const sites = await db.site.findMany({ orderBy: { name: 'asc' } });
  const who = await person();
  const p = await place({ siteId: sites.find((s) => s.id !== who.siteId).id });
  const historicalSite = sites.find((s) => s.id !== p.siteId && s.id !== who.siteId);
  await daily(who, p, '2038-10-01', { incomplete: true, reviewStatus: 'PENDING', absences: 3 });
  await daily(who, p, '2038-10-02', { incomplete: true, reviewStatus: 'APPROVED' });
  await daily(who, p, '2038-10-03', { reviewStatus: 'MANUAL_LOADED', absences: 2 });
  await daily(who, p, '2038-10-04');
  await daily(who, p, '2038-10-05', { reviewStatus: 'PENDING', siteId: historicalSite.id });
  await sheet(who, p, 10, 2038, 'PENDING', { createdAt: new Date('2020-01-01') });
  await sheet(who, p, 10, 2038, 'PENDING', { sequenceNumber: 2 });
  await sheet(who, p, 10, 2038, 'LOADED', { sequenceNumber: 3 });
  await sheet(who, p, 10, 2038, 'ERROR', { sequenceNumber: 4 });
  await sheet(who, p, 9, 2038, 'PENDING', { createdAt: new Date('2038-10-02') });
  await db.user.update({ where: { id: who.id }, data: { accountStatus: 'INACTIVE' } });
  await db.workplace.update({ where: { id: p.id }, data: { status: 'INACTIVE' } });
  await db.client.update({ where: { id: p.clientId }, data: { status: 'INACTIVE' } });
  const r = await metrics();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assertShape(r.body.data);
  assert.deepEqual(counts(r.body.data), {
    pendingTimesheets: 2,
    incompleteRecords: 2,
    pendingReviewRecords: 2,
    recordsWithAbsence: 2,
  });
  assert.deepEqual(counts(r.body.data.byProvince.find((s) => s.id === p.siteId)), {
    pendingTimesheets: 2,
    incompleteRecords: 2,
    pendingReviewRecords: 1,
    recordsWithAbsence: 2,
  });
  assert.deepEqual(counts(r.body.data.byProvince.find((s) => s.id === historicalSite.id)), {
    ...zero,
    pendingReviewRecords: 1,
  });
  assert.deepEqual(counts(r.body.data.byProvince.find((s) => s.id === who.siteId)), zero);
});

test('month ranges include civil boundary days, leap day and December year rollover', async () => {
  const who = await person();
  const p = await place();
  for (const date of [
    '2040-01-31',
    '2040-02-01',
    '2040-02-29',
    '2040-03-01',
    '2040-12-01',
    '2040-12-31',
    '2041-01-01',
  ])
    await daily(who, p, date, { incomplete: true, reviewStatus: 'PENDING', absences: 1 });
  for (const [month, year, expected] of [
    [1, 2040, 1],
    [2, 2040, 2],
    [3, 2040, 1],
    [12, 2040, 2],
    [1, 2041, 1],
  ]) {
    await sheet(who, p, month, year);
    const r = await metrics(`month=${month}&year=${year}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assertShape(r.body.data);
    assert.deepEqual(counts(r.body.data), {
      pendingTimesheets: 1,
      incompleteRecords: expected,
      pendingReviewRecords: expected,
      recordsWithAbsence: expected,
    });
  }
});

test('metrics requires exact decimal month/year and rejects unknown or repeated parameters', async () => {
  for (const q of [
    '',
    'month=1',
    'year=2038',
    'month=0&year=2038',
    'month=13&year=2038',
    'month=-1&year=2038',
    'month=1.0&year=2038',
    'month=1e0&year=2038',
    'month=%2B1&year=2038',
    'month=%201&year=2038',
    'month=1&year=1999',
    'month=1&year=10000',
    'month=1&year=2038.5',
    'month=1&year=2038&siteId=' + site.id,
    'month=1&month=2&year=2038',
    'month=1&year=2038&year=2038',
    'month[]=1&year=2038',
    'month=1&year=',
  ]) {
    const r = await metrics(q);
    assert.equal(r.status, 422, q + ': ' + JSON.stringify(r.body));
    assert.equal(r.body.error.code, 'VALIDATION_ERROR');
    assert.equal(r.body.error.retryable, false);
  }
  for (const q of ['month=1&year=2000', 'month=12&year=9999'])
    assert.equal((await metrics(q)).status, 200);
  assert.equal(
    (await request('/api/v1/dashboard/summary?month=1&year=2038', { user: admin })).status,
    404,
  );
});

test('dashboard uses real JWT, sessions, account state and admin roles', async () => {
  const r = await metrics(undefined, { user: null });
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, 'INVALID_TOKEN');
  const denied = await metrics(undefined, { user: employee });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, 'ROLE_NOT_ALLOWED');
  const pending = await person('TO_BE_ADMIN');
  assert.equal((await metrics(undefined, { user: pending })).status, 401);
  assert.equal((await metrics(undefined, { user: await person('SUPER_ADMIN') })).status, 200);
  const revoked = await person('ADMIN');
  await db.authSession.update({
    where: { id: revoked.sessionId },
    data: { revokedAt: new Date() },
  });
  assert.equal((await metrics(undefined, { user: revoked })).status, 401);
  const expired = await person('ADMIN');
  await db.authSession.update({
    where: { id: expired.sessionId },
    data: { expiresAt: new Date(0) },
  });
  assert.equal((await metrics(undefined, { user: expired })).status, 401);
  const inactive = await person('ADMIN');
  await db.user.update({ where: { id: inactive.id }, data: { accountStatus: 'INACTIVE' } });
  const blocked = await metrics(undefined, { user: inactive });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'ACCOUNT_INACTIVE');
});

async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail('Expected dashboard read waiting on Timesheet');
}
test('a concurrent atomic commit cannot mix provinces, record metrics and pending timesheets', async () => {
  const who = await person();
  const p = await place();
  const row = await daily(who, p, '2042-06-01', {
    incomplete: true,
    reviewStatus: 'PENDING',
    absences: 1,
  });
  const timesheet = await sheet(who, p, 6, 2042);
  let reading;
  await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('LOCK TABLE "Timesheet" IN ACCESS EXCLUSIVE MODE');
      reading = metrics('month=6&year=2042');
      await until(async () => {
        const rows =
          await db.$queryRaw`SELECT query FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%Timesheet%'`;
        return rows.length > 0;
      });
      await tx.attendanceRecord.update({
        where: { id: row.id },
        data: { recordStatus: 'COMPLETE', reviewStatus: 'APPROVED' },
      });
      await tx.interval.deleteMany({ where: { recordId: row.id } });
      await tx.timesheet.update({ where: { id: timesheet.id }, data: { status: 'LOADED' } });
    },
    { timeout: 10000 },
  );
  const r = await reading;
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assertShape(r.body.data);
  assert.deepEqual(counts(r.body.data), {
    pendingTimesheets: 1,
    incompleteRecords: 1,
    pendingReviewRecords: 1,
    recordsWithAbsence: 1,
  });
  const fresh = await metrics('month=6&year=2042');
  assert.deepEqual(counts(fresh.body.data), zero);
});

test('Timesheet persistence enforces period, positive size/sequence and scoped sequence uniqueness', async () => {
  const who = await person();
  const p = await place();
  const original = await sheet(who, p, 1, 2043);
  assert.equal(original.version, 1);
  assert.equal(original.replacedById, null);
  for (const overrides of [
    { month: 0 },
    { month: 13 },
    { year: 1999 },
    { year: 10000 },
    { sequenceNumber: 0 },
    { fileSizeBytes: 0 },
    { fileSizeBytes: -1 },
  ]) {
    await assert.rejects(sheet(who, p, 2, 2043, 'PENDING', overrides));
  }
  await assert.rejects(sheet(who, p, 1, 2043), (error) => error.code === 'P2002');
  await sheet(who, p, 1, 2043, 'PENDING', { sequenceNumber: 2 });
  const r = await metrics('month=1&year=2043');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(counts(r.body.data), { ...zero, pendingTimesheets: 2 });
});
