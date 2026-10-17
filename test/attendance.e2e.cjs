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
  NODE_ENV: 'test',
  EMAIL_PROVIDER: 'log',
  WHATSAPP_PROVIDER: 'log',
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  JWT_ACCESS_SECRET: 'test-f005-access-secret',
  PORT: '33447',
});
const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
const base = 'http://127.0.0.1:33447';
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
function input(overrides = {}) {
  return {
    workplaceId: workplace.id,
    type: 'CHECK_IN',
    latitude: 0,
    longitude: 0,
    accuracy: 5,
    locationTimestamp: new Date().toISOString(),
    clientRequestId: randomUUID(),
    ...overrides,
  };
}
async function post(body, user = employee) {
  return request('/api/v1/attendance/events', { body, user });
}
async function accepted(body, user = employee) {
  const r = await post(body, user);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data;
}
async function error(body, code, status = 422, user = employee) {
  const r = await post(body, user);
  assert.equal(r.status, status, JSON.stringify(r.body));
  assert.equal(r.body.error.code, code);
  assert.equal(r.body.error.retryable, false);
  assert.equal(typeof r.body.error.message, 'string');
}
async function place(overrides = {}) {
  const client = await db.client.create({ data: { name: `F005 ${randomUUID()}` } });
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
      lastName: 'F005',
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
function offline(at, overrides = {}) {
  return input({
    occurredAt: new Date(at).toISOString(),
    clientSentAt: new Date().toISOString(),
    ...overrides,
  });
}
function businessDay(now = new Date()) {
  return new Date(now.getTime() - 10800000).toISOString().slice(0, 10);
}
// Keep projection examples within one business day even when the suite runs
// immediately after GMT-3 midnight; all original times remain in the 24h window.
function projectionBase(span = 600000) {
  const now = Date.now();
  const midnight = new Date(`${businessDay()}T03:00:00.000Z`).getTime();
  return now - midnight >= span + 60000 ? now - span : midnight - span - 60000;
}
async function record(id) {
  return db.attendanceRecord.findUniqueOrThrow({
    where: { id },
    include: { intervals: { orderBy: { sequence: 'asc' } } },
  });
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
  if (db.interval) await db.interval.deleteMany({ where: { record: { userId: { in: users } } } });
  if (db.attendanceEvent) await db.attendanceEvent.deleteMany({ where: { userId: { in: users } } });
  if (db.attendanceRecord)
    await db.attendanceRecord.deleteMany({ where: { userId: { in: users } } });
  await db.workplace.deleteMany({ where: { clientId: { in: clients } } });
  await db.client.deleteMany({ where: { id: { in: clients } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});

test('time helper enforces exact inclusive offline boundaries and online server provenance', () => {
  const { effectiveTime, attendanceDate } = require('../dist/modules/attendance/attendance-time');
  const receivedAt = new Date('2026-10-16T12:00:00.000Z');
  const source = {
    occurredAt: '2026-10-15T12:00:00.000Z',
    clientSentAt: '2026-10-16T12:02:00.000Z',
  };
  assert.equal(effectiveTime(source, receivedAt).occurredAt.toISOString(), source.occurredAt);
  assert.throws(
    () => effectiveTime({ ...source, occurredAt: '2026-10-15T11:59:59.999Z' }, receivedAt),
    (e) => e.code === 'ATTENDANCE_EVENT_TOO_OLD',
  );
  assert.throws(
    () => effectiveTime({ ...source, clientSentAt: '2026-10-16T12:02:00.001Z' }, receivedAt),
    (e) => e.code === 'INVALID_TIMESTAMP',
  );
  assert.throws(
    () => effectiveTime({ clientSentAt: source.clientSentAt }, receivedAt),
    (e) => e.code === 'INVALID_TIMESTAMP',
  );
  assert.throws(
    () => effectiveTime({ ...source, occurredAt: '2026-10-16T12:02:00.001Z' }, receivedAt),
    (e) => e.code === 'INVALID_TIMESTAMP',
  );
  assert.equal(
    effectiveTime({ occurredAt: '2000-01-01T00:00:00Z' }, receivedAt).occurredAt.getTime(),
    receivedAt.getTime(),
  );
  assert.equal(
    effectiveTime(
      { ...source, clientSentAt: '2026-10-15T12:00:00Z' },
      receivedAt,
    ).occurredAt.toISOString(),
    source.occurredAt,
  );
  assert.equal(
    attendanceDate(new Date('2026-10-16T02:59:59.999Z')).toISOString(),
    '2026-10-15T00:00:00.000Z',
  );
  assert.equal(
    attendanceDate(new Date('2026-10-16T03:00:00.000Z')).toISOString(),
    '2026-10-16T00:00:00.000Z',
  );
});
test('GPS helper uses Haversine and inclusive radius/tolerance/accuracy boundaries', () => {
  const { haversineMeters, geofenceReview } = require('../dist/modules/attendance/geofence');
  assert.equal(haversineMeters(0, 0, 0, 0), 0);
  assert.ok(Math.abs(haversineMeters(0, 0, 0, 1) - 111194.92664455874) < 0.000001);
  const p = { latitude: 0, longitude: 0.001, radiusMeters: 100, gpsAccuracyThreshold: 10 };
  const exact = haversineMeters(0, 0, p.latitude, p.longitude);
  assert.equal(geofenceReview({ ...p, radiusMeters: exact }, 0, 0, 10, 100), false);
  assert.equal(geofenceReview({ ...p, radiusMeters: exact - 100 }, 0, 0, 10, 100), true);
  assert.throws(
    () => geofenceReview({ ...p, radiusMeters: exact - 100.000001 }, 0, 0, 10, 100),
    (e) => e.code === 'OUT_OF_WORKPLACE_AREA',
  );
  assert.equal(geofenceReview({ ...p, longitude: 0 }, 0, 0, 10.000001, 100), true);
  assert.equal(
    geofenceReview({ ...p, longitude: 0, gpsAccuracyThreshold: null }, 0, 0, 999999, 100),
    false,
  );
});
test('HTTP attendance requires current JWT/session and EMPLOYEE, with no public mutation routes', async () => {
  assert.equal((await request('/api/v1/attendance/status', { user: null })).status, 401);
  await error(input(), 'ROLE_NOT_ALLOWED', 403, admin);
  for (const method of ['DELETE', 'PUT', 'PATCH'])
    assert.equal(
      (await request('/api/v1/attendance/events', { method, body: input() })).status,
      404,
    );
});
test('online persists server time and metadata; status derives from today and replay preserves result', async () => {
  const who = await person();
  const before = Date.now();
  const body = input({
    occurredAt: '2000-01-01T00:00:00.000Z',
    deviceInfo: { platform: 'android' },
    observation: 'Entrada',
  });
  const result = await accepted(body, who);
  const event = await db.attendanceEvent.findUniqueOrThrow({ where: { id: result.eventId } });
  assert.ok(event.receivedAt.getTime() >= before && event.receivedAt.getTime() <= Date.now());
  assert.equal(event.occurredAt.getTime(), event.receivedAt.getTime());
  assert.equal(event.clientSentAt, null);
  assert.deepEqual(event.deviceInfo, body.deviceInfo);
  assert.equal(event.locationTimestamp.toISOString(), body.locationTimestamp);
  const row = await record(result.recordId);
  assert.equal(row.date.toISOString().slice(0, 10), businessDay(event.receivedAt));
  assert.equal(row.version, 1);
  assert.equal(row.recordStatus, 'INCOMPLETE');
  assert.equal(row.origin, 'AUTOMATIC');
  assert.equal(row.intervals[0].intervalStatus, 'OPEN');
  const status = await request('/api/v1/attendance/status', { user: who });
  assert.deepEqual(status.body.data, {
    isWorking: true,
    since: event.occurredAt.toISOString(),
    workplaceId: workplace.id,
  });
  const replay = await post(
    {
      ...body,
      workplaceId: randomUUID(),
      type: 'WRONG',
      occurredAt: 'invalid',
      clientSentAt: 'invalid',
    },
    who,
  );
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body.data, result);
  await error(body, 'ROLE_NOT_ALLOWED', 403, other);
  assert.equal((await record(row.id)).version, 1);
});
test('HTTP DTO, GPS, timestamps and inactive structure reject atomically without events', async () => {
  const before = await db.attendanceEvent.count({ where: { userId: employee.id } });
  for (const patch of [
    { userId: other.id },
    { receivedAt: new Date().toISOString() },
    { latitude: 91 },
    { longitude: -181 },
    { latitude: '0' },
    { accuracy: -1 },
    { accuracy: '3' },
    { type: 'OTHER' },
    { clientRequestId: '' },
    { clientRequestId: 7 },
    { locationTimestamp: 'bad' },
    { occurredAt: 'bad' },
    { absenceReason: 'ILLNESS' },
    { deviceInfo: 'bad' },
  ])
    await error(input(patch), 'VALIDATION_ERROR');
  await error(input({ clientSentAt: new Date().toISOString() }), 'INVALID_TIMESTAMP');
  await error(offline(Date.now() - 86400001), 'ATTENDANCE_EVENT_TOO_OLD');
  await error(
    offline(Date.now(), { clientSentAt: new Date(Date.now() + 130000).toISOString() }),
    'INVALID_TIMESTAMP',
  );
  await error(
    offline(Date.now(), { clientSentAt: new Date(Date.now() - 10000).toISOString() }),
    'INVALID_TIMESTAMP',
  );
  await error(input({ workplaceId: randomUUID() }), 'WORKPLACE_NOT_FOUND', 404);
  await error(input({ longitude: 1 }), 'OUT_OF_WORKPLACE_AREA', 403);
  const inactive = await place({ status: 'INACTIVE' });
  await error(input({ workplaceId: inactive.id }), 'WORKPLACE_NOT_FOUND', 404);
  const closedClient = await place();
  await db.client.update({ where: { id: closedClient.clientId }, data: { status: 'INACTIVE' } });
  await error(input({ workplaceId: closedClient.id }), 'CLIENT_INACTIVE', 409);
  assert.equal(await db.attendanceEvent.count({ where: { userId: employee.id } }), before);
  assert.equal(await db.attendanceRecord.count({ where: { userId: employee.id } }), 0);
});

test('receipt projection preserves approved overlapping 600 minutes and increments version per event', async () => {
  const who = await person();
  const midnight = new Date(`${businessDay()}T03:00:00.000Z`).getTime();
  const elapsed = Date.now() - midnight;
  const day = elapsed >= 9 * 3600000 ? midnight : midnight - 86400000;
  const hours = elapsed >= 9 * 3600000 ? [0, 2, 3, 9] : [9, 11, 12, 18];
  let result;
  for (let i = 0; i < 4; i++)
    result = await accepted(
      offline(day + hours[i] * 3600000, { type: i < 2 ? 'CHECK_IN' : 'CHECK_OUT' }),
      who,
    );
  const row = await record(result.recordId);
  assert.equal(row.totalWorkMinutes, 600);
  assert.equal(row.version, 4);
  assert.equal(row.recordStatus, 'COMPLETE');
  assert.equal(row.reviewStatus, 'NONE');
  assert.deepEqual(
    row.intervals.map((i) => i.intervalStatus),
    ['CLOSED', 'CLOSED'],
  );
  assert.equal(row.intervals[0].endTime.getTime(), day + hours[3] * 3600000);
  assert.equal(row.intervals[1].endTime.getTime(), day + hours[2] * 3600000);
});
test('fractional minutes are floored once after summing closed WORK; absences retain event links and add zero', async () => {
  const who = await person();
  const at = projectionBase(300000);
  let result;
  for (const [offset, type] of [
    [0, 'CHECK_IN'],
    [40000, 'CHECK_OUT'],
    [50000, 'CHECK_IN'],
    [90000, 'CHECK_OUT'],
  ])
    result = await accepted(offline(at + offset, { type }), who);
  const absence = await accepted(
    offline(at + 100000, { type: 'ABSENCE', absenceReason: 'ILLNESS', observation: 'Reposo' }),
    who,
  );
  const noReason = await accepted(offline(at + 110000, { type: 'ABSENCE' }), who);
  assert.equal(absence.recordId, result.recordId);
  assert.equal(noReason.recordId, result.recordId);
  const row = await record(result.recordId);
  assert.equal(row.totalWorkMinutes, 1);
  assert.equal(row.recordStatus, 'COMPLETE');
  assert.equal(row.version, 6);
  assert.equal(row.intervals[2].type, 'ABSENCE');
  assert.equal(row.intervals[2].startTime, null);
  assert.equal(row.intervals[2].endTime, null);
  assert.equal(row.intervals[2].absenceEventId, absence.eventId);
  assert.equal(row.intervals[2].absenceReason, 'ILLNESS');
  assert.equal(row.intervals[2].observations, 'Reposo');
  assert.equal(row.intervals[3].absenceReason, null);
});
test('out-of-order offline opens close by receipt sequence and earlier exit remains SEMI_CLOSED/PENDING', async () => {
  const who = await person();
  const at = projectionBase();
  const a = await accepted(offline(at + 300000), who);
  const b = await accepted(offline(at), who);
  const c = await accepted(offline(at + 60000, { type: 'CHECK_OUT' }), who);
  let row = await record(c.recordId);
  assert.equal(row.intervals[0].entryEventId, a.eventId);
  assert.equal(row.intervals[0].intervalStatus, 'OPEN');
  assert.equal(row.intervals[1].entryEventId, b.eventId);
  assert.equal(row.intervals[1].exitEventId, c.eventId);
  assert.equal(row.totalWorkMinutes, 1);
  const d = await accepted(offline(at + 120000, { type: 'CHECK_OUT' }), who);
  row = await record(d.recordId);
  assert.equal(row.totalWorkMinutes, 1);
  assert.equal(row.recordStatus, 'INCOMPLETE');
  assert.equal(row.reviewStatus, 'PENDING');
  assert.equal(row.intervals[0].intervalStatus, 'OPEN');
  assert.equal(row.intervals[2].intervalStatus, 'SEMI_CLOSED');
  assert.equal(row.intervals[2].startTime, null);
  assert.equal(row.intervals[2].exitEventId, d.eventId);
});
test('timestamp ties keep explicit receipt sequence, not SQL order; exiting never looks for another open', async () => {
  const who = await person();
  const at = projectionBase();
  const first = await accepted(offline(at), who);
  const second = await accepted(offline(at + 300000), who);
  await db.interval.updateMany({
    where: { recordId: first.recordId },
    data: { createdAt: new Date('2026-01-01T00:00:00Z') },
  });
  const out = await accepted(offline(at + 60000, { type: 'CHECK_OUT' }), who);
  const row = await record(out.recordId);
  assert.equal(row.reviewStatus, 'PENDING');
  assert.equal(row.totalWorkMinutes, 0);
  assert.equal(row.intervals[0].entryEventId, first.eventId);
  assert.equal(row.intervals[0].intervalStatus, 'OPEN');
  assert.equal(row.intervals[1].entryEventId, second.eventId);
  assert.equal(row.intervals[1].intervalStatus, 'OPEN');
  assert.equal(row.intervals[2].intervalStatus, 'SEMI_CLOSED');
});
test('midnight GMT-3 creates two incomplete records without closing prior day; status only uses today', async () => {
  const who = await person();
  const midnight = new Date(`${businessDay()}T03:00:00.000Z`).getTime();
  // Both sides are accepted original offline times within the 24h ingestion window.
  // At the very end of a business day, use exactly midnight rather than before it.
  const early = midnight - 1;
  if (Date.now() - early > 86400000)
    throw Error('Run requires more than 1ms before business midnight');
  const a = await accepted(offline(early), who);
  const b = await accepted(offline(midnight, { type: 'CHECK_OUT' }), who);
  assert.notEqual(a.recordId, b.recordId);
  const before = await record(a.recordId);
  const after = await record(b.recordId);
  assert.equal(before.intervals[0].intervalStatus, 'OPEN');
  assert.equal(after.intervals[0].intervalStatus, 'SEMI_CLOSED');
  for (const row of [before, after]) {
    assert.equal(row.recordStatus, 'INCOMPLETE');
    assert.equal(row.totalWorkMinutes, 0);
  }
  assert.deepEqual((await request('/api/v1/attendance/status', { user: who })).body.data, {
    isWorking: false,
    since: null,
    workplaceId: null,
  });
});
test('GPS tolerance and low accuracy accept PENDING and keep it after later good events', async () => {
  const who = await person();
  const p = await place({ gpsAccuracyThreshold: 10 });
  const a = await accepted(input({ workplaceId: p.id, longitude: 0.001 }), who);
  let row = await record(a.recordId);
  assert.equal(row.reviewStatus, 'PENDING');
  assert.equal(row.intervals[0].reviewStatus, 'PENDING');
  const b = await accepted(input({ workplaceId: p.id, type: 'CHECK_OUT' }), who);
  row = await record(b.recordId);
  assert.equal(row.reviewStatus, 'PENDING');
  assert.equal(row.intervals[0].reviewStatus, 'PENDING');
  assert.equal(row.recordStatus, 'COMPLETE');
  const c = await accepted(input({ workplaceId: p.id, accuracy: 11, type: 'ABSENCE' }), who);
  row = await record(c.recordId);
  assert.equal(row.intervals[1].reviewStatus, 'PENDING');
  const exact = await place({ gpsAccuracyThreshold: 10 });
  const d = await accepted(input({ workplaceId: exact.id, accuracy: 10, type: 'ABSENCE' }), who);
  assert.equal((await record(d.recordId)).reviewStatus, 'NONE');
});
test('concurrent equal keys replay once, distinct keys preserve all projection, and cross-user key races cannot leak', async () => {
  const who = await person();
  const body = input();
  const duplicates = await Promise.all(Array.from({ length: 8 }, () => post(body, who)));
  assert.deepEqual(
    duplicates.map((r) => r.status).sort(),
    [200, 200, 200, 200, 200, 200, 200, 201],
  );
  for (const r of duplicates) assert.deepEqual(r.body.data, duplicates[0].body.data);
  const id = duplicates[0].body.data.recordId;
  assert.equal((await record(id)).version, 1);
  assert.equal(
    await db.attendanceEvent.count({ where: { clientRequestId: body.clientRequestId } }),
    1,
  );
  const unique = await Promise.all(Array.from({ length: 6 }, () => post(input(), who)));
  assert.ok(
    unique.every((r) => r.status === 201),
    JSON.stringify(unique),
  );
  let row = await record(id);
  assert.equal(row.version, 7);
  assert.equal(row.intervals.length, 7);
  const closes = await Promise.all(
    Array.from({ length: 7 }, () => post(input({ type: 'CHECK_OUT' }), who)),
  );
  assert.ok(closes.every((r) => r.status === 201));
  row = await record(id);
  assert.equal(row.recordStatus, 'COMPLETE');
  assert.equal(row.version, 14);
  const one = await person(),
    two = await person();
  const p1 = await place(),
    p2 = await place();
  const key = randomUUID();
  const races = await Promise.all([
    post(input({ workplaceId: p1.id, clientRequestId: key }), one),
    post(input({ workplaceId: p2.id, clientRequestId: key }), two),
  ]);
  assert.deepEqual(races.map((r) => r.status).sort(), [201, 403]);
  const loser = races[0].status === 403 ? one : two;
  assert.equal(await db.attendanceRecord.count({ where: { userId: loser.id } }), 0);
  assert.equal(await db.attendanceEvent.count({ where: { clientRequestId: key } }), 1);
  const denied = races.find((r) => r.status === 403);
  assert.equal(denied.body.error.code, 'ROLE_NOT_ALLOWED');
  assert.equal(denied.body.data, undefined);
});
function placeInput(p, overrides = {}) {
  return {
    clientId: p.clientId,
    siteId: p.siteId,
    name: p.name,
    latitude: p.latitude,
    longitude: p.longitude,
    radiusMeters: p.radiusMeters,
    gpsAccuracyThreshold: p.gpsAccuracyThreshold,
    ...overrides,
  };
}
function editPlace(p, overrides = {}) {
  return request(`/api/v1/workplaces/${p.id}`, {
    method: 'PUT',
    user: admin,
    body: placeInput(p, overrides),
  });
}
test('workplace history freezes client/site while allowing unchanged relations, name and geography edits', async () => {
  const who = await person();
  const p = await place();
  const first = await accepted(input({ workplaceId: p.id }), who);
  const original = await record(first.recordId);
  const destination = await place();
  const sites = await db.site.findMany();
  const target = sites.find((s) => s.id !== site.id);
  for (const change of [{ clientId: destination.clientId }, { siteId: target.id }]) {
    const denied = await editPlace(p, change);
    assert.equal(denied.status, 400, JSON.stringify(denied.body));
    assert.equal(denied.body.error.code, 'INVALID_WORKPLACE_DATA');
    assert.equal(denied.body.error.retryable, false);
  }
  assert.equal(
    (await editPlace(p, { name: `Renombrado ${randomUUID()}`, radiusMeters: 200 })).status,
    200,
  );
  const second = await accepted(input({ workplaceId: p.id, type: 'CHECK_OUT' }), who);
  assert.equal(second.recordId, first.recordId);
  const row = await record(second.recordId);
  assert.equal(row.clientId, original.clientId);
  assert.equal(row.siteId, original.siteId);
  assert.equal(row.version, 2);
  const replay = await post(
    {
      clientRequestId: (
        await db.attendanceEvent.findUniqueOrThrow({ where: { id: first.eventId } })
      ).clientRequestId,
    },
    who,
  );
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body.data, first);
});
test('workplace reassignment remains allowed before the first record and first ingestion snapshots new context', async () => {
  const who = await person();
  const p = await place();
  const destination = await place();
  const sites = await db.site.findMany();
  const target = sites.find((s) => s.id !== site.id);
  const moved = await editPlace(p, { clientId: destination.clientId, siteId: target.id });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  const event = await accepted(input({ workplaceId: p.id }), who);
  const row = await record(event.recordId);
  assert.equal(row.clientId, destination.clientId);
  assert.equal(row.siteId, target.id);
});
test('status selects latest start then id deterministically across places and never closes another workplace', async () => {
  const who = await person();
  const p1 = await place(),
    p2 = await place();
  const at = projectionBase(60000);
  const a = await accepted(offline(at, { workplaceId: p1.id }), who);
  const b = await accepted(offline(at, { workplaceId: p2.id }), who);
  const rows = await db.interval.findMany({
    where: { recordId: { in: [a.recordId, b.recordId] } },
    orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
    include: { record: true },
  });
  assert.deepEqual((await request('/api/v1/attendance/status', { user: who })).body.data, {
    isWorking: true,
    since: rows[0].startTime.toISOString(),
    workplaceId: rows[0].record.workplaceId,
  });
  await accepted(input({ workplaceId: rows[0].record.workplaceId, type: 'CHECK_OUT' }), who);
  assert.equal(
    (await request('/api/v1/attendance/status', { user: who })).body.data.workplaceId,
    rows[1].record.workplaceId,
  );
});

async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail('Expected PostgreSQL lock wait');
}
async function waitingOn(table) {
  const rows =
    await db.$queryRaw`SELECT query FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE%'`;
  return rows.some((r) => r.query.includes(`"${table}"`));
}
test('replay remains stable beyond 24h, even after workplace becomes inactive, and another identity learns nothing', async () => {
  const who = await person();
  const p = await place();
  const at = new Date(Date.now() - 3 * 86400000);
  const historic = await db.attendanceRecord.create({
    data: {
      userId: who.id,
      workplaceId: p.id,
      clientId: p.clientId,
      siteId: p.siteId,
      date: new Date(`${businessDay(at)}T00:00:00Z`),
      recordStatus: 'COMPLETE',
      origin: 'AUTOMATIC',
    },
  });
  const event = await db.attendanceEvent.create({
    data: {
      userId: who.id,
      workplaceId: p.id,
      recordId: historic.id,
      type: 'ABSENCE',
      occurredAt: at,
      receivedAt: at,
      clientSentAt: at,
      latitude: 0,
      longitude: 0,
      accuracy: 1,
      locationTimestamp: at,
      clientRequestId: randomUUID(),
      origin: 'MOBILE',
      responseMessage: 'Registro realizado correctamente',
    },
  });
  await db.workplace.update({ where: { id: p.id }, data: { status: 'INACTIVE' } });
  const body = offline(at, {
    workplaceId: p.id,
    type: 'ABSENCE',
    clientRequestId: event.clientRequestId,
  });
  const r = await post(body, who);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data, {
    eventId: event.id,
    recordId: historic.id,
    message: 'Registro realizado correctamente',
  });
  await error(body, 'ROLE_NOT_ALLOWED', 403, other);
});
test('event and new record roll back together when interval persistence fails after event insertion', async () => {
  const who = await person();
  const body = input({ type: 'ABSENCE' });
  // A database failure after event insertion proves actual transaction rollback,
  // without changing guards, request clock or production configuration.
  const trigger = `f005_atomic_${suffix.replaceAll('-', '')}`;
  await db.$executeRawUnsafe(
    `CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS (SELECT 1 FROM "AttendanceRecord" WHERE id=NEW."recordId" AND "userId"='${who.id}'::uuid) THEN RAISE EXCEPTION 'F005 test persistence failure'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER "${trigger}" BEFORE INSERT ON "Interval" FOR EACH ROW EXECUTE FUNCTION "${trigger}"()`,
  );
  try {
    const r = await post(body, who);
    assert.equal(r.status, 500);
    assert.equal(r.body.error.code, 'INTERNAL_ERROR');
    assert.equal(r.body.error.retryable, true);
    assert.equal(
      await db.attendanceEvent.count({ where: { clientRequestId: body.clientRequestId } }),
      0,
    );
    assert.equal(await db.attendanceRecord.count({ where: { userId: who.id } }), 0);
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER "${trigger}" ON "Interval"`);
    await db.$executeRawUnsafe(`DROP FUNCTION "${trigger}"()`);
  }
  await accepted(body, who);
});
test('ingestion rechecks account after a concurrent deactivation holding User, including replays', async () => {
  for (const replaying of [false, true]) {
    const who = await person();
    const body = input();
    if (replaying) await accepted(body, who);
    let pending;
    await db.$transaction(
      async (tx) => {
        await tx.user.update({ where: { id: who.id }, data: { accountStatus: 'INACTIVE' } });
        pending = post(body, who);
        await until(() => waitingOn('User'));
      },
      { timeout: 10000 },
    );
    const r = await pending;
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.equal(r.body.error.code, 'ACCOUNT_INACTIVE');
    assert.equal(await db.attendanceEvent.count({ where: { userId: who.id } }), replaying ? 1 : 0);
    assert.equal(
      (await request('/api/v1/attendance/status', { user: who })).body.error.code,
      'ACCOUNT_INACTIVE',
    );
  }
});
test('ingestion rechecks workplace status and current geographic config after waiting on Workplace', async () => {
  for (const change of [{ status: 'INACTIVE' }, { radiusMeters: 10 }]) {
    const who = await person();
    const p = await place();
    let pending;
    await db.$transaction(
      async (tx) => {
        await tx.workplace.update({ where: { id: p.id }, data: change });
        pending = post(input({ workplaceId: p.id, longitude: 0.001 }), who);
        await until(() => waitingOn('Workplace'));
      },
      { timeout: 10000 },
    );
    const r = await pending;
    assert.equal(r.status, change.status ? 404 : 403, JSON.stringify(r.body));
    assert.equal(
      r.body.error.code,
      change.status ? 'WORKPLACE_NOT_FOUND' : 'OUT_OF_WORKPLACE_AREA',
    );
    assert.equal(await db.attendanceEvent.count({ where: { userId: who.id } }), 0);
  }
});
test('ingestion locks Client after Workplace and rechecks concurrent client deactivation', async () => {
  const who = await person();
  const p = await place();
  let pending;
  await db.$transaction(
    async (tx) => {
      await tx.client.update({ where: { id: p.clientId }, data: { status: 'INACTIVE' } });
      pending = post(input({ workplaceId: p.id }), who);
      await until(() => waitingOn('Client'));
    },
    { timeout: 10000 },
  );
  const r = await pending;
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error.code, 'CLIENT_INACTIVE');
  assert.equal(await db.attendanceEvent.count({ where: { userId: who.id } }), 0);
});
test('status and ingestion revalidate sessions revoked while waiting on User', async () => {
  for (const status of [false, true]) {
    const who = await person();
    let pending;
    await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${who.id}::uuid FOR UPDATE`;
        pending = status ? request('/api/v1/attendance/status', { user: who }) : post(input(), who);
        await until(() => waitingOn('User'));
        await tx.authSession.update({
          where: { id: who.sessionId },
          data: { revokedAt: new Date() },
        });
      },
      { timeout: 10000 },
    );
    const r = await pending;
    assert.equal(r.status, 401, JSON.stringify(r.body));
    assert.equal(r.body.error.code, 'INVALID_TOKEN');
    assert.equal(await db.attendanceEvent.count({ where: { userId: who.id } }), 0);
  }
});

test('interval sequence is independent from record version and follows the highest existing sequence', async () => {
  const who = await person();
  const first = await accepted(input(), who);
  // A stored record can have several intervals at one version (future manual
  // edits). This fixture tests ingestion only; no admin route is introduced.
  await db.interval.create({
    data: {
      recordId: first.recordId,
      sequence: 2,
      type: 'ABSENCE',
      intervalStatus: 'CLOSED',
      origin: 'MANUAL',
    },
  });
  const second = await post(input(), who);
  assert.equal(second.status, 201, JSON.stringify(second.body));
  const row = await record(first.recordId);
  assert.equal(row.version, 2);
  assert.deepEqual(
    row.intervals.map((i) => i.sequence),
    [1, 2, 3],
  );
});

test('first ingestion holding Workplace prevents a queued reassignment once its record commits', async () => {
  const who = await person();
  const p = await place();
  const destination = await place();
  let ingest, moving;
  await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Client" WHERE id=${p.clientId}::uuid FOR UPDATE`;
      ingest = post(input({ workplaceId: p.id }), who);
      await until(() => waitingOn('Client'));
      moving = editPlace(p, { clientId: destination.clientId });
      await until(() => waitingOn('Workplace'));
    },
    { timeout: 10000 },
  );
  const event = await ingest;
  assert.equal(event.status, 201, JSON.stringify(event.body));
  const edit = await moving;
  assert.equal(edit.status, 400, JSON.stringify(edit.body));
  assert.equal(edit.body.error.code, 'INVALID_WORKPLACE_DATA');
  assert.equal((await record(event.body.data.recordId)).clientId, p.clientId);
});
test('reassignment holding Workplace commits before queued first ingestion and its snapshot uses new context', async () => {
  const who = await person();
  const p = await place();
  const destination = await place();
  const sites = await db.site.findMany();
  const target = sites.find((s) => s.id !== site.id);
  let ingest, moving;
  await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Client" WHERE id=${destination.clientId}::uuid FOR UPDATE`;
      moving = editPlace(p, { clientId: destination.clientId, siteId: target.id });
      await until(() => waitingOn('Client'));
      ingest = post(input({ workplaceId: p.id }), who);
      await until(() => waitingOn('Workplace'));
    },
    { timeout: 10000 },
  );
  assert.equal((await moving).status, 200);
  const event = await ingest;
  assert.equal(event.status, 201, JSON.stringify(event.body));
  const row = await record(event.body.data.recordId);
  assert.equal(row.clientId, destination.clientId);
  assert.equal(row.siteId, target.id);
});

test('historical workplace PUT accepts equivalent client and site UUIDs regardless of letter case', async () => {
  const who = await person();
  const p = await place();
  const first = await accepted(input({ workplaceId: p.id }), who);
  for (const relations of [
    { clientId: p.clientId.toUpperCase() },
    { siteId: p.siteId.toUpperCase() },
    { clientId: p.clientId.toUpperCase(), siteId: p.siteId.toUpperCase() },
  ]) {
    const result = await editPlace(p, relations);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.data.client.id, p.clientId);
    assert.equal(result.body.data.site.id, p.siteId);
  }
  const row = await record(first.recordId);
  assert.equal(row.clientId, p.clientId);
  assert.equal(row.siteId, p.siteId);
  assert.equal(row.version, 1);
});

test('inactive same-client workplace edits accept equivalent uppercase UUIDs with or without attendance history', async () => {
  for (const historic of [false, true]) {
    const p = await place();
    if (historic) await accepted(input({ workplaceId: p.id }), await person());
    await db.client.update({ where: { id: p.clientId }, data: { status: 'INACTIVE' } });
    const result = await editPlace(p, {
      clientId: p.clientId.toUpperCase(),
      siteId: p.siteId.toUpperCase(),
      name: `Corrección ${randomUUID()}`,
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.data.client.id, p.clientId);
    assert.equal(result.body.data.client.status, 'INACTIVE');
    assert.equal(result.body.data.site.id, p.siteId);
  }
});
