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
  JWT_ACCESS_SECRET: 'test-f006-access-secret',
  PORT: '33448',
});
const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
const base = 'http://127.0.0.1:33448';
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
  const client = await db.client.create({ data: { name: `F006 ${randomUUID()}` } });
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
      lastName: 'F006',
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

const ROOT = '/api/v1/records';
async function api(path = '', options = {}) {
  return request(ROOT + path, { user: admin, ...options });
}
async function apiError(path, code, status = 422, options = {}) {
  const r = await api(path, options);
  assert.equal(r.status, status, JSON.stringify(r.body));
  assert.equal(r.body.error.code, code);
  assert.equal(r.body.error.retryable, false);
}
function interval(
  type = 'WORK',
  start = '2024-02-01T12:00:00Z',
  end = '2024-02-01T13:00:00Z',
  overrides = {},
) {
  return {
    type,
    startTime: start,
    endTime: end,
    absenceReason: null,
    observations: null,
    ...overrides,
  };
}
function manual(overrides = {}) {
  return {
    userId: employee.id,
    workplaceId: workplace.id,
    date: '2024-02-01',
    observations: null,
    intervals: [interval()],
    ...overrides,
  };
}
async function create(body = manual()) {
  const r = await api('', { body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data;
}
async function detail(id) {
  const r = await api('/' + id);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data;
}
async function patch(id, body) {
  return api('/' + id, { method: 'PATCH', body });
}
async function monthly(query = {}) {
  return api('/monthly?' + new URLSearchParams({ month: 2, year: 2024, ...query }));
}
function keys(obj, expected) {
  assert.deepEqual(Object.keys(obj).sort(), expected.sort());
}

test('admin routes enforce JWT/session/roles, fixed paths, malformed DTO errors and no extra write routes', async () => {
  assert.equal((await api('/monthly?month=2&year=2024', { user: null })).status, 401);
  for (const user of [employee, other]) {
    await apiError('/monthly?month=2&year=2024', 'ROLE_NOT_ALLOWED', 403, { user });
    await apiError('', 'ROLE_NOT_ALLOWED', 403, { user, body: manual() });
    assert.equal(
      (await request('/api/v1/attendance-events/' + randomUUID(), { user })).status,
      403,
    );
  }
  assert.equal((await api()).status, 404);
  await apiError('/' + randomUUID(), 'NOT_FOUND', 404);
  for (const method of ['DELETE', 'PUT'])
    assert.equal((await api('/' + randomUUID(), { method, body: {} })).status, 404);
  await apiError('/bad', 'VALIDATION_ERROR');
  await apiError('', 'VALIDATION_ERROR', 422, { body: manual({ date: '2024-02-30' }) });
});
test('manual create/detail publish exact DTOs, nullable absence and server derived minutes/version', async () => {
  const who = await person();
  const row = await create(
    manual({
      userId: who.id,
      intervals: [interval(), interval('ABSENCE', null, null, { absenceReason: 'ILLNESS' })],
      observations: 'Nota',
    }),
  );
  keys(row, [
    'id',
    'date',
    'employee',
    'workplace',
    'client',
    'site',
    'totalWorkMinutes',
    'recordStatus',
    'reviewStatus',
    'origin',
    'hasAbsence',
    'observations',
    'version',
    'intervals',
    'createdAt',
    'updatedAt',
  ]);
  keys(row.employee, ['id', 'firstName', 'lastName', 'employeeId']);
  keys(row.workplace, ['id', 'name']);
  keys(row.client, ['id', 'name']);
  keys(row.site, ['id', 'name']);
  assert.equal(row.date, '2024-02-01');
  assert.equal(row.totalWorkMinutes, 60);
  assert.equal(row.recordStatus, 'COMPLETE');
  assert.equal(row.reviewStatus, 'MANUAL_LOADED');
  assert.equal(row.origin, 'MANUAL');
  assert.equal(row.version, 1);
  assert.equal(row.hasAbsence, true);
  assert.equal(row.observations, 'Nota');
  keys(row.intervals[0], [
    'id',
    'type',
    'status',
    'startTime',
    'endTime',
    'absenceReason',
    'observations',
    'origin',
    'reviewStatus',
    'attendanceEvents',
  ]);
  assert.equal(row.intervals[0].status, 'CLOSED');
  assert.equal(row.intervals[0].reviewStatus, 'NONE');
  assert.equal(row.intervals[0].origin, 'MANUAL');
  assert.deepEqual(row.intervals[0].attendanceEvents, []);
  assert.equal(row.intervals[1].startTime, null);
  assert.equal(row.intervals[1].endTime, null);
  assert.deepEqual(await detail(row.id.toUpperCase()), row);
  assert.equal(await db.attendanceEvent.count({ where: { recordId: row.id } }), 0);
});
test('manual validation enforces calendar, identity, interval day/WORK completeness and overlap for both types', async () => {
  const who = await person();
  const base = manual({ userId: who.id });
  for (const change of [
    { date: '0000-01-01' },
    { date: '2023-02-29' },
    { userId: 'bad' },
    { intervals: [] },
    { totalWorkMinutes: 999 },
    { intervals: [interval('WORK', null, null)] },
    { intervals: [interval('WORK', '2024-02-01T02:59:59Z', '2024-02-01T12:00:00Z')] },
    { intervals: [interval('WORK', '2024-02-01T12:00:00Z', '2024-02-02T03:00:00.001Z')] },
    { intervals: [interval('WORK', '2024-02-01T13:00:00Z', '2024-02-01T12:00:00Z')] },
    {
      intervals: [interval(), interval('ABSENCE', '2024-02-01T12:30:00Z', '2024-02-01T13:30:00Z')],
    },
    { intervals: [interval('WORK', undefined, undefined, { reviewStatus: 'APPROVED' })] },
  ])
    await apiError('', 'VALIDATION_ERROR', 422, { body: { ...base, ...change } });
  await apiError('', 'USER_NOT_FOUND', 404, { body: { ...base, userId: randomUUID() } });
  await apiError('', 'WORKPLACE_NOT_FOUND', 404, { body: { ...base, workplaceId: randomUUID() } });
  const end = await create({
    ...base,
    intervals: [interval('WORK', '2024-02-01T23:00:00Z', '2024-02-02T03:00:00Z')],
  });
  assert.equal(end.totalWorkMinutes, 240);
  const adjacent = await create({
    ...base,
    date: '2024-02-02',
    intervals: [
      interval('ABSENCE', '2024-02-02T12:00:00Z', '2024-02-02T13:00:00Z'),
      interval('WORK', '2024-02-02T13:00:00Z', '2024-02-02T14:00:00Z'),
    ],
  });
  assert.equal(adjacent.totalWorkMinutes, 60);
});
test('manual duplicates race without overwrite; active relations revalidated while historical correction remains allowed', async () => {
  const who = await person();
  const p = await place();
  const body = manual({ userId: who.id.toUpperCase(), workplaceId: p.id.toUpperCase() });
  const results = await Promise.all([api('', { body }), api('', { body })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(results.find((r) => r.status === 409).body.error.code, 'RECORD_ALREADY_EXISTS');
  const id = results.find((r) => r.status === 201).body.data.id;
  await db.user.update({ where: { id: who.id }, data: { accountStatus: 'INACTIVE' } });
  await db.client.update({ where: { id: p.clientId }, data: { status: 'INACTIVE' } });
  await db.workplace.update({ where: { id: p.id }, data: { status: 'INACTIVE' } });
  assert.equal((await patch(id, { expectedVersion: 1, observations: 'Histórico' })).status, 200);
  await apiError('', 'ACCOUNT_INACTIVE', 403, {
    body: {
      ...body,
      date: '2024-02-02',
      intervals: [interval('WORK', '2024-02-02T12:00:00Z', '2024-02-02T13:00:00Z')],
    },
  });
  assert.equal((await detail(id)).observations, 'Histórico');
});
test('PATCH applies omission/null, ownership and deletion rules atomically, preserving identity and sequence', async () => {
  const row = await create(
    manual({
      userId: (await person()).id,
      intervals: [interval(), interval('ABSENCE', null, null)],
    }),
  );
  await apiError('/' + row.id, 'RECORD_INTERVALS_REQUIRED', 422, {
    method: 'PATCH',
    body: {
      expectedVersion: 1,
      intervalChanges: row.intervals.map((i) => ({ operation: 'DELETE', id: i.id })),
    },
  });
  await apiError('/' + row.id, 'VALIDATION_ERROR', 422, {
    method: 'PATCH',
    body: { expectedVersion: 1, userId: other.id },
  });
  await apiError('/' + row.id, 'VALIDATION_ERROR', 422, {
    method: 'PATCH',
    body: { expectedVersion: 1, intervalChanges: [{ operation: 'DELETE', id: randomUUID() }] },
  });
  const update = await patch(row.id, {
    expectedVersion: 1,
    observations: 'Editada',
    intervalChanges: [
      {
        operation: 'UPDATE',
        id: row.intervals[0].id.toUpperCase(),
        interval: interval('WORK', '2024-02-01T12:00:00Z', '2024-02-01T14:00:00Z', {
          observations: 'Tramo',
        }),
      },
    ],
  });
  assert.equal(update.status, 200, JSON.stringify(update.body));
  assert.equal(update.body.data.totalWorkMinutes, 120);
  assert.equal(update.body.data.version, 2);
  assert.equal(update.body.data.intervals[1].id, row.intervals[1].id);
  const clear = await patch(row.id, {
    expectedVersion: 2,
    observations: null,
    intervalChanges: [
      { operation: 'DELETE', id: row.intervals[1].id },
      { operation: 'ADD', interval: interval('ABSENCE', null, null) },
    ],
  });
  assert.equal(clear.status, 200, JSON.stringify(clear.body));
  assert.equal(clear.body.data.observations, null);
  assert.equal(clear.body.data.intervals[0].observations, 'Tramo');
  assert.equal(clear.body.data.version, 3);
  await apiError('/' + row.id, 'RECORD_VERSION_CONFLICT', 409, {
    method: 'PATCH',
    body: { expectedVersion: 1, observations: 'Stale' },
  });
  const seq = await db.interval.findMany({
    where: { recordId: row.id },
    orderBy: { sequence: 'asc' },
  });
  assert.deepEqual(
    seq.map((i) => i.sequence),
    [1, 3],
  );
});
test('monthly snapshot provides all leap-month days, empty dataset and un-nested metadata', async () => {
  const r = await monthly({ employeeId: randomUUID() });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  keys(r.body, ['data', 'pagination', 'meta']);
  assert.deepEqual(r.body.data, []);
  assert.deepEqual(r.body.pagination, { page: 1, pageSize: 50, totalItems: 0, totalPages: 0 });
  assert.equal(r.body.meta.timeZone, '-03:00');
  assert.deepEqual(r.body.meta.totals, { monthWorkMinutes: 0, matchingWorkMinutes: 0 });
  const who = await person();
  await create(
    manual({ userId: who.id, date: '2024-02-29', intervals: [interval('ABSENCE', null, null)] }),
  );
  const leap = await monthly({ employeeId: who.id });
  assert.equal(leap.status, 200, JSON.stringify(leap.body));
  assert.equal(leap.body.data[0].days.length, 29);
  assert.equal(leap.body.data[0].days[28].date, '2024-02-29');
  assert.equal(leap.body.data[0].days[28].state, 'PRESENT');
  assert.equal(leap.body.data[0].days[0].state, 'EMPTY');
  keys(leap.body.data[0].days[28].record, [
    'id',
    'totalWorkMinutes',
    'recordStatus',
    'reviewStatus',
    'origin',
    'hasAbsence',
    'intervalCount',
  ]);
});

async function eventDetail(id) {
  const r = await request('/api/v1/attendance-events/' + id, { user: admin });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data;
}
test('event audit metadata is scalar and server-owned, and references survive UPDATE then DELETE without event mutations', async () => {
  const who = await person();
  const sent = new Date().toISOString();
  const at = projectionBase();
  const original = input({
    occurredAt: new Date(at).toISOString(),
    clientSentAt: sent,
    deviceInfo: {
      platform: 'android',
      version: 3,
      test: true,
      unknown: null,
      nested: { a: 1 },
      clientSentAt: 'spoof',
      receivedAt: 'spoof',
      recordId: 'spoof',
      deviceInfoJson: 'spoof',
    },
  });
  const acceptedEvent = await accepted(original, who);
  let row = await detail(acceptedEvent.recordId);
  assert.equal(row.origin, 'AUTOMATIC');
  assert.equal(row.intervals[0].attendanceEvents[0].id, acceptedEvent.eventId);
  assert.equal(row.intervals[0].status, 'OPEN');
  const persisted = await db.attendanceEvent.findUniqueOrThrow({
    where: { id: acceptedEvent.eventId },
  });
  let event = await eventDetail(acceptedEvent.eventId.toUpperCase());
  keys(event, [
    'id',
    'recordId',
    'intervalId',
    'type',
    'occurredAt',
    'receivedAt',
    'origin',
    'observation',
    'location',
    'metadata',
  ]);
  keys(event.location, ['latitude', 'longitude', 'accuracyMeters', 'capturedAt']);
  assert.equal(event.intervalId, row.intervals[0].id);
  assert.equal(event.metadata.platform, 'android');
  assert.equal(event.metadata.clientSentAt, sent);
  assert.equal(event.metadata.receivedAt, undefined);
  assert.equal(event.metadata.recordId, undefined);
  assert.deepEqual(JSON.parse(event.metadata.deviceInfoJson), original.deviceInfo);
  assert.equal(event.location.capturedAt, original.locationTimestamp);
  assert.equal(event.occurredAt, new Date(at).toISOString());
  assert.ok(
    Object.values(event.metadata).every(
      (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v),
    ),
  );
  const body = interval(
    'WORK',
    new Date(at + 1000).toISOString(),
    new Date(at + 61000).toISOString(),
  );
  let changed = await patch(row.id, {
    expectedVersion: 1,
    intervalChanges: [{ operation: 'UPDATE', id: row.intervals[0].id, interval: body }],
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(
    changed.body.data.intervals[0].attendanceEvents[0].occurredAt,
    persisted.occurredAt.toISOString(),
  );
  changed = await patch(row.id, {
    expectedVersion: 2,
    intervalChanges: [
      { operation: 'DELETE', id: row.intervals[0].id },
      { operation: 'ADD', interval: interval('ABSENCE', null, null) },
    ],
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  event = await eventDetail(acceptedEvent.eventId);
  assert.equal(event.intervalId, null);
  assert.equal(event.recordId, row.id);
  assert.deepEqual(
    await db.attendanceEvent.findUniqueOrThrow({ where: { id: acceptedEvent.eventId } }),
    persisted,
  );
  const replay = await post(original, who);
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body.data, acceptedEvent);
});
test('ABSENCE events appear in interval references and pure approval preserves inherited PENDING interval and every derived datum', async () => {
  const who = await person();
  const p = await place({ gpsAccuracyThreshold: 1 });
  const event = await accepted(
    input({ workplaceId: p.id, type: 'ABSENCE', accuracy: 2, absenceReason: 'LEAVE' }),
    who,
  );
  const before = await detail(event.recordId);
  assert.equal(before.reviewStatus, 'PENDING');
  assert.equal(before.intervals[0].reviewStatus, 'PENDING');
  assert.equal(before.intervals[0].attendanceEvents[0].id, event.eventId);
  assert.equal((await eventDetail(event.eventId)).intervalId, before.intervals[0].id);
  const originalIntervals = await db.interval.findMany({ where: { recordId: before.id } });
  const result = await api('/' + before.id + '/review', {
    method: 'PATCH',
    body: { expectedVersion: 1, reviewStatus: 'APPROVED' },
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const after = result.body.data;
  assert.equal(after.version, 2);
  assert.equal(after.reviewStatus, 'APPROVED');
  for (const key of Object.keys(before).filter(
    (k) => !['version', 'reviewStatus', 'updatedAt'].includes(k),
  ))
    assert.deepEqual(after[key], before[key]);
  assert.deepEqual(
    await db.interval.findMany({ where: { recordId: before.id } }),
    originalIntervals,
  );
  await apiError('/' + before.id + '/review', 'RECORD_VERSION_CONFLICT', 409, {
    method: 'PATCH',
    body: { expectedVersion: 1, reviewStatus: 'APPROVED' },
  });
  for (const reviewStatus of ['REJECTED', 'MANUAL_LOADED', 'PENDING', null])
    await apiError('/' + before.id + '/review', 'VALIDATION_ERROR', 422, {
      method: 'PATCH',
      body: { expectedVersion: 2, reviewStatus },
    });
});
test('historical overlap correction compares pair/range, allowing preservation/reduction but rejecting translated or new intersections', async () => {
  const who = await person();
  const p = await place();
  const day = '2024-03-01';
  const record = await db.attendanceRecord.create({
    data: {
      userId: who.id,
      workplaceId: p.id,
      clientId: p.clientId,
      siteId: p.siteId,
      date: new Date(day),
      recordStatus: 'COMPLETE',
      reviewStatus: 'PENDING',
      origin: 'AUTOMATIC',
      totalWorkMinutes: 300,
    },
  });
  const a = await db.interval.create({
    data: {
      recordId: record.id,
      sequence: 1,
      type: 'WORK',
      startTime: new Date(day + 'T12:00:00Z'),
      endTime: new Date(day + 'T15:00:00Z'),
      intervalStatus: 'CLOSED',
      origin: 'AUTOMATIC',
    },
  });
  const b = await db.interval.create({
    data: {
      recordId: record.id,
      sequence: 2,
      type: 'ABSENCE',
      startTime: new Date(day + 'T14:00:00Z'),
      endTime: new Date(day + 'T16:00:00Z'),
      intervalStatus: 'CLOSED',
      origin: 'AUTOMATIC',
    },
  });
  assert.equal(
    (await patch(record.id, { expectedVersion: 1, observations: 'Conservar legado' })).status,
    200,
  );
  let result = await patch(record.id, {
    expectedVersion: 2,
    intervalChanges: [
      {
        operation: 'UPDATE',
        id: b.id,
        interval: interval('ABSENCE', day + 'T14:30:00Z', day + 'T16:00:00Z'),
      },
    ],
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  // Same duration moved outside the old range is an expansion, despite unchanged total overlap duration.
  await apiError('/' + record.id, 'VALIDATION_ERROR', 422, {
    method: 'PATCH',
    body: {
      expectedVersion: 3,
      intervalChanges: [
        {
          operation: 'UPDATE',
          id: b.id,
          interval: interval('ABSENCE', day + 'T13:30:00Z', day + 'T14:00:00Z'),
        },
      ],
    },
  });
  await apiError('/' + record.id, 'VALIDATION_ERROR', 422, {
    method: 'PATCH',
    body: {
      expectedVersion: 3,
      intervalChanges: [
        { operation: 'DELETE', id: b.id },
        { operation: 'ADD', interval: interval('ABSENCE', day + 'T14:30:00Z', day + 'T15:00:00Z') },
      ],
    },
  });
  result = await patch(record.id, {
    expectedVersion: 3,
    intervalChanges: [
      {
        operation: 'UPDATE',
        id: b.id,
        interval: interval('ABSENCE', day + 'T15:00:00Z', day + 'T16:00:00Z'),
      },
    ],
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.data.totalWorkMinutes, 180);
  assert.equal(result.body.data.intervals[0].id, a.id);
});
test('complete IntervalInput is required for ADD/UPDATE and malformed optional fields never bypass validation', async () => {
  const who = await person();
  const row = await create(manual({ userId: who.id }));
  const base = manual({
    userId: who.id,
    date: '2024-02-02',
    intervals: [interval('ABSENCE', null, null)],
  });
  const missingObservation = { ...base };
  delete missingObservation.observations;
  await apiError('', 'VALIDATION_ERROR', 422, { body: missingObservation });
  for (const field of ['type', 'startTime', 'endTime', 'absenceReason', 'observations']) {
    const missing = { ...interval() };
    delete missing[field];
    await apiError('/' + row.id, 'VALIDATION_ERROR', 422, {
      method: 'PATCH',
      body: {
        expectedVersion: 1,
        intervalChanges: [{ operation: 'UPDATE', id: row.intervals[0].id, interval: missing }],
      },
    });
  }
  await apiError('/' + row.id, 'VALIDATION_ERROR', 422, {
    method: 'PATCH',
    body: {
      expectedVersion: 1,
      intervalChanges: [
        { operation: 'DELETE', id: row.intervals[0].id },
        { operation: 'UPDATE', id: row.intervals[0].id.toUpperCase(), interval: interval() },
      ],
    },
  });
  for (const expectedVersion of [undefined, null, 0, 1.2, '1', Number.MAX_SAFE_INTEGER + 1])
    await apiError('/' + row.id, 'VALIDATION_ERROR', 422, {
      method: 'PATCH',
      body: { expectedVersion, observations: 'x' },
    });
  assert.equal((await detail(row.id)).version, 1);
});
test('monthly filters select same-day conjunctions and return all days with row/global totals beyond the page', async () => {
  const p = await place();
  const a = await person(),
    b = await person();
  await db.user.update({ where: { id: a.id }, data: { lastName: 'A' } });
  await db.user.update({ where: { id: b.id }, data: { lastName: 'B' } });
  const a1 = await create(manual({ userId: a.id, workplaceId: p.id }));
  const a2 = await create(
    manual({
      userId: a.id,
      workplaceId: p.id,
      date: '2024-02-02',
      intervals: [
        interval('WORK', '2024-02-02T12:00:00Z', '2024-02-02T14:00:00Z'),
        interval('ABSENCE', null, null),
      ],
    }),
  );
  const b1 = await create(
    manual({
      userId: b.id,
      workplaceId: p.id,
      intervals: [
        interval('WORK', '2024-02-01T12:00:00Z', '2024-02-01T15:00:00Z'),
        interval('ABSENCE', null, null),
      ],
    }),
  );
  await api('/' + a1.id + '/review', {
    method: 'PATCH',
    body: { expectedVersion: 1, reviewStatus: 'APPROVED' },
  });
  const none = await monthly({
    workplaceId: p.id,
    employeeId: a.id,
    reviewStatus: 'APPROVED',
    hasAbsence: 'true',
  });
  assert.equal(none.status, 200);
  assert.equal(none.body.data.length, 0, 'filters split across different days must not select row');
  const first = await monthly({ workplaceId: p.id, pageSize: 1, hasAbsence: 'true' });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.pagination.totalItems, 2);
  assert.equal(first.body.data[0].employee.id, a.id);
  assert.deepEqual(first.body.data[0].totals, { monthWorkMinutes: 180, matchingWorkMinutes: 120 });
  assert.deepEqual(first.body.meta.totals, { monthWorkMinutes: 360, matchingWorkMinutes: 300 });
  assert.equal(first.body.data[0].days[0].matchesFilters, false);
  assert.equal(first.body.data[0].days[0].record.id, a1.id);
  assert.equal(first.body.data[0].days[1].record.id, a2.id);
  const second = await monthly({
    workplaceId: p.id,
    pageSize: 1,
    hasAbsence: 'true',
    page: 2,
    snapshotToken: first.body.meta.snapshotToken,
  });
  assert.equal(second.status, 200);
  assert.equal(second.body.data[0].employee.id, b.id);
  assert.equal(second.body.data[0].days[0].record.id, b1.id);
  assert.deepEqual(second.body.meta, first.body.meta);
});
test('snapshot freezes payload across names, revision and new writes; context/owner/pageSize/expiry are enforced without sliding TTL', async () => {
  const p = await place();
  const who = await person();
  const row = await create(manual({ userId: who.id, workplaceId: p.id }));
  const first = await monthly({ workplaceId: p.id, pageSize: 1 });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const snapshotToken = first.body.meta.snapshotToken;
  await Promise.all([
    db.user.update({ where: { id: who.id }, data: { lastName: 'Cambiado' } }),
    db.workplace.update({ where: { id: p.id }, data: { name: 'Nombre nuevo' } }),
    api('/' + row.id + '/review', {
      method: 'PATCH',
      body: { expectedVersion: 1, reviewStatus: 'APPROVED' },
    }),
  ]);
  await create(
    manual({
      userId: who.id,
      workplaceId: p.id,
      date: '2024-02-02',
      intervals: [interval('ABSENCE', null, null)],
    }),
  );
  const frozen = await monthly({
    workplaceId: p.id.toUpperCase(),
    pageSize: 1,
    snapshotToken: snapshotToken.toUpperCase(),
  });
  assert.equal(frozen.status, 200);
  assert.deepEqual(frozen.body, first.body);
  const fresh = await monthly({ workplaceId: p.id, pageSize: 1 });
  assert.equal(fresh.body.data[0].workplace.name, 'Nombre nuevo');
  assert.equal(fresh.body.data[0].days[0].record.reviewStatus, 'APPROVED');
  assert.equal(fresh.body.data[0].days[1].state, 'PRESENT');
  for (const query of [{ pageSize: 2 }, { month: 3 }, { status: 'INCOMPLETE' }])
    await apiError(
      '/monthly?' +
        new URLSearchParams({
          month: 2,
          year: 2024,
          workplaceId: p.id,
          pageSize: 1,
          snapshotToken,
          ...query,
        }),
      'MONTHLY_SNAPSHOT_MISMATCH',
      400,
    );
  const admin2 = await person('ADMIN');
  await apiError(
    '/monthly?' +
      new URLSearchParams({ month: 2, year: 2024, workplaceId: p.id, pageSize: 1, snapshotToken }),
    'MONTHLY_SNAPSHOT_MISMATCH',
    400,
    { user: admin2 },
  );
  await apiError('/monthly?month=2&year=2024&page=2', 'MONTHLY_SNAPSHOT_MISMATCH', 400);
  await apiError(
    '/monthly?month=2&year=2024&snapshotToken=' + randomUUID(),
    'MONTHLY_SNAPSHOT_EXPIRED',
    410,
  );
  await db.monthlySnapshot.update({
    where: { id: snapshotToken },
    data: { expiresAt: new Date(Date.now() - 1) },
  });
  await apiError(
    '/monthly?' +
      new URLSearchParams({ month: 2, year: 2024, workplaceId: p.id, pageSize: 1, snapshotToken }),
    'MONTHLY_SNAPSHOT_EXPIRED',
    410,
  );
  await monthly({ workplaceId: p.id });
  assert.equal(await db.monthlySnapshot.count({ where: { id: snapshotToken } }), 0);
});
test('monthly handles 31 and 28-day calendars, historical inactive entities, strict filters and canonical UUIDs', async () => {
  const who = await person();
  const p = await place();
  await create(
    manual({
      userId: who.id,
      workplaceId: p.id,
      date: '2023-02-01',
      intervals: [interval('ABSENCE', null, null)],
    }),
  );
  await create(
    manual({
      userId: who.id,
      workplaceId: p.id,
      date: '2024-01-31',
      intervals: [interval('ABSENCE', null, null)],
    }),
  );
  await db.user.update({ where: { id: who.id }, data: { accountStatus: 'INACTIVE' } });
  await db.workplace.update({ where: { id: p.id }, data: { status: 'INACTIVE' } });
  await db.client.update({ where: { id: p.clientId }, data: { status: 'INACTIVE' } });
  for (const [year, month, days] of [
    [2023, 2, 28],
    [2024, 1, 31],
  ]) {
    const r = await monthly({
      year,
      month,
      employeeId: who.id.toUpperCase(),
      workplaceId: p.id.toUpperCase(),
      clientId: p.clientId.toUpperCase(),
      siteId: p.siteId.toUpperCase(),
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data[0].days.length, days);
  }
  for (const query of [
    '',
    'month=2',
    'year=2024',
    'month=13&year=2024',
    'month=2&year=0000',
    'month=2&year=2024&pageSize=101',
    'month=2&year=2024&hasAbsence=false',
    'month=2&year=2024&status=OTHER',
    'month=2&year=2024&sortBy=date',
    'month=2&month=3&year=2024',
    'month=2&year=2024&siteId=bad',
  ])
    await apiError('/monthly?' + query, 'VALIDATION_ERROR');
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
test('concurrent page-one snapshots with an expired row never fail during technical cleanup', async () => {
  const p = await place();
  const expired = await db.monthlySnapshot.create({
    data: {
      ownerId: admin.id,
      context: 'expired-fixture',
      payload: { rows: [], totals: { monthWorkMinutes: 0, matchingWorkMinutes: 0 } },
      expiresAt: new Date(Date.now() - 10000),
    },
  });
  let first, second;
  await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "MonthlySnapshot" WHERE id=${expired.id}::uuid FOR UPDATE`;
      first = monthly({ workplaceId: p.id });
      second = monthly({ workplaceId: p.id });
      await until(async () => {
        const rows =
          await db.$queryRaw`SELECT query FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%DELETE FROM%MonthlySnapshot%'`;
        return rows.length >= 2;
      });
    },
    { timeout: 10000 },
  );
  for (const result of await Promise.all([first, second]))
    assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(await db.monthlySnapshot.count({ where: { id: expired.id } }), 0);
});

test('concurrent corrections and approval use the current locked version without losing data', async () => {
  for (const review of [false, true]) {
    const row = await create(manual({ userId: (await person()).id }));
    let first, second;
    await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${row.employee.id}::uuid FOR UPDATE`;
        first = patch(row.id, { expectedVersion: 1, observations: 'Ganador' });
        second = review
          ? api('/' + row.id + '/review', {
              method: 'PATCH',
              body: { expectedVersion: 1, reviewStatus: 'APPROVED' },
            })
          : patch(row.id, { expectedVersion: 1, observations: 'Segundo' });
        await until(async () => {
          const rows =
            await db.$queryRaw`SELECT query FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%User%FOR UPDATE%'`;
          return rows.length >= 2;
        });
      },
      { timeout: 10000 },
    );
    const results = await Promise.all([first, second]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(results.find((r) => r.status === 409).body.error.code, 'RECORD_VERSION_CONFLICT');
    const final = await detail(row.id);
    assert.equal(final.version, 2);
    assert.deepEqual(final, results.find((r) => r.status === 200).body.data);
  }
});
test('manual edits race ingestion without losing version and manual origin persists on later mobile events', async () => {
  const who = await person();
  const at = projectionBase();
  const original = await accepted(offline(at, { type: 'ABSENCE' }), who);
  let edit, ingest;
  await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${who.id}::uuid FOR UPDATE`;
      edit = patch(original.recordId, { expectedVersion: 1, observations: 'Manual' });
      ingest = post(offline(at, { type: 'ABSENCE' }), who);
      await until(async () => {
        const rows =
          await db.$queryRaw`SELECT query FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%User%FOR UPDATE%'`;
        return rows.length >= 2;
      });
    },
    { timeout: 10000 },
  );
  const [correction, event] = await Promise.all([edit, ingest]);
  assert.equal(event.status, 201, JSON.stringify(event.body));
  assert.ok([200, 409].includes(correction.status));
  let row = await detail(original.recordId);
  assert.equal(row.version, correction.status === 200 ? 3 : 2);
  if (correction.status === 409) {
    const result = await patch(row.id, { expectedVersion: row.version, observations: 'Manual' });
    assert.equal(result.status, 200);
    row = result.body.data;
  }
  assert.equal(row.origin, 'MANUAL');
  const after = await accepted(offline(at, { type: 'ABSENCE' }), who);
  row = await detail(after.recordId);
  assert.equal(row.origin, 'MANUAL');
  assert.equal(row.intervals.length, 3);
  assert.equal(row.observations, 'Manual');
});
test('manual create revalidates concurrent user/workplace/client deactivation after waiting on actual locks', async () => {
  for (const resource of ['User', 'Workplace', 'Client']) {
    const who = await person(),
      p = await place();
    let creating;
    await db.$transaction(
      async (tx) => {
        if (resource === 'User')
          await tx.user.update({ where: { id: who.id }, data: { accountStatus: 'INACTIVE' } });
        if (resource === 'Workplace')
          await tx.workplace.update({ where: { id: p.id }, data: { status: 'INACTIVE' } });
        if (resource === 'Client')
          await tx.client.update({ where: { id: p.clientId }, data: { status: 'INACTIVE' } });
        creating = api('', { body: manual({ userId: who.id, workplaceId: p.id }) });
        await until(() => waitingOn(resource));
      },
      { timeout: 10000 },
    );
    const result = await creating;
    assert.equal(
      result.body.error.code,
      { User: 'ACCOUNT_INACTIVE', Workplace: 'WORKPLACE_NOT_FOUND', Client: 'CLIENT_INACTIVE' }[
        resource
      ],
      JSON.stringify(result.body),
    );
    assert.equal(await db.attendanceRecord.count({ where: { userId: who.id } }), 0);
  }
});
test('snapshot page two keeps rows and totals immutable after renames and corrections between pages', async () => {
  const p = await place();
  const a = await person(),
    b = await person();
  await db.user.update({ where: { id: a.id }, data: { lastName: 'A' } });
  await db.user.update({ where: { id: b.id }, data: { lastName: 'B' } });
  const ar = await create(manual({ userId: a.id, workplaceId: p.id }));
  const br = await create(manual({ userId: b.id, workplaceId: p.id }));
  const first = await monthly({ workplaceId: p.id, pageSize: 1 });
  assert.equal(first.status, 200);
  const persisted = await db.monthlySnapshot.findUniqueOrThrow({
    where: { id: first.body.meta.snapshotToken },
  });
  const expected = persisted.payload.rows[1];
  await Promise.all([
    patch(br.id, {
      expectedVersion: 1,
      intervalChanges: [
        {
          operation: 'UPDATE',
          id: br.intervals[0].id,
          interval: interval('WORK', '2024-02-01T12:00:00Z', '2024-02-01T15:00:00Z'),
        },
      ],
    }),
    db.user.update({ where: { id: b.id }, data: { lastName: '0 reordered' } }),
    db.workplace.update({ where: { id: p.id }, data: { name: 'Nuevo' } }),
  ]);
  const second = await monthly({
    workplaceId: p.id,
    pageSize: 1,
    page: 2,
    snapshotToken: first.body.meta.snapshotToken,
  });
  assert.equal(second.status, 200);
  assert.deepEqual(second.body.data[0], expected);
  assert.deepEqual(second.body.meta, first.body.meta);
  assert.equal(second.body.data[0].totals.monthWorkMinutes, 60);
  const fresh = await monthly({ workplaceId: p.id, pageSize: 1 });
  assert.equal(fresh.body.data[0].employee.id, b.id);
  assert.equal(fresh.body.data[0].totals.monthWorkMinutes, 180);
  assert.equal(fresh.body.meta.totals.monthWorkMinutes, 240);
  assert.equal((await detail(ar.id)).version, 1);
});
test('PostgreSQL C collation orders text stably and snapshots survive an API process restart', async () => {
  const p = await place();
  const ids = [];
  for (const lastName of ['á', 'a', 'Z']) {
    const who = await person();
    await db.user.update({ where: { id: who.id }, data: { lastName } });
    ids.push(who.id);
    await create(manual({ userId: who.id, workplaceId: p.id }));
  }
  const result = await monthly({ workplaceId: p.id, pageSize: 1 });
  assert.equal(result.status, 200);
  assert.equal(result.body.data[0].employee.id, ids[2]);
  const stored = await db.monthlySnapshot.findUniqueOrThrow({
    where: { id: result.body.meta.snapshotToken },
  });
  assert.deepEqual(
    stored.payload.rows.map((r) => r.employee.lastName),
    ['Z', 'a', 'á'],
  );
  server.kill('SIGTERM');
  await new Promise((resolve) => server.once('exit', resolve));
  server = spawn(process.execPath, ['dist/main.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  server.stdout.on('data', (x) => (output += x));
  server.stderr.on('data', (x) => (output += x));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + '/health')).ok) break;
    } catch {}
    if (server.exitCode !== null) throw Error(output);
    await new Promise((r) => setTimeout(r, 50));
  }
  const page = await monthly({
    workplaceId: p.id,
    pageSize: 1,
    page: 2,
    snapshotToken: result.body.meta.snapshotToken,
  });
  assert.equal(page.status, 200, JSON.stringify(page.body));
  assert.equal(page.body.data[0].employee.id, ids[1]);
  assert.deepEqual(page.body.meta, result.body.meta);
});

test('RepeatableRead freezes record data, relation names and interval counts while a concurrent commit crosses capture', async () => {
  const who = await person(),
    p = await place();
  const row = await create(manual({ userId: who.id, workplaceId: p.id }));
  let capturing;
  await db.$transaction(
    async (tx) => {
      // Pause a real relation query after the snapshot's initial record selection.
      await tx.$executeRawUnsafe('LOCK TABLE "Interval" IN ACCESS EXCLUSIVE MODE');
      capturing = monthly({ workplaceId: p.id });
      await until(async () => {
        const rows =
          await db.$queryRaw`SELECT query FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%Interval%'`;
        return rows.length > 0;
      });
      await tx.attendanceRecord.update({
        where: { id: row.id },
        data: { totalWorkMinutes: 999, reviewStatus: 'APPROVED' },
      });
      await tx.workplace.update({
        where: { id: p.id },
        data: { name: 'Renombrado durante captura' },
      });
      await tx.interval.create({
        data: {
          recordId: row.id,
          sequence: 2,
          type: 'ABSENCE',
          intervalStatus: 'CLOSED',
          origin: 'MANUAL',
        },
      });
    },
    { timeout: 10000 },
  );
  const snapshot = await capturing;
  assert.equal(snapshot.status, 200, JSON.stringify(snapshot.body));
  assert.equal(snapshot.body.data[0].workplace.name, p.name);
  assert.equal(snapshot.body.data[0].days[0].record.totalWorkMinutes, 60);
  assert.equal(snapshot.body.data[0].days[0].record.reviewStatus, 'MANUAL_LOADED');
  assert.equal(snapshot.body.data[0].days[0].record.intervalCount, 1);
  assert.equal(snapshot.body.data[0].days[0].record.hasAbsence, false);
  const fresh = await monthly({ workplaceId: p.id });
  assert.equal(fresh.body.data[0].workplace.name, 'Renombrado durante captura');
  assert.equal(fresh.body.data[0].days[0].record.totalWorkMinutes, 999);
  assert.equal(fresh.body.data[0].days[0].record.intervalCount, 2);
  assert.equal(fresh.body.data[0].days[0].record.hasAbsence, true);
});
test('manual ABSENCE endpoint completeness and sum-floor semantics do not synthesize events', async () => {
  const who = await person();
  const row = await create(
    manual({
      userId: who.id,
      intervals: [
        interval('ABSENCE', '2024-02-01T11:00:00Z', null),
        interval('ABSENCE', null, '2024-02-01T11:30:00Z'),
        interval('WORK', '2024-02-01T12:00:00Z', '2024-02-01T12:00:40Z'),
        interval('WORK', '2024-02-01T12:01:00Z', '2024-02-01T12:01:40Z'),
      ],
    }),
  );
  assert.equal(row.totalWorkMinutes, 1);
  assert.equal(row.recordStatus, 'INCOMPLETE');
  assert.equal(row.hasAbsence, true);
  assert.deepEqual(
    row.intervals.map((i) => i.status),
    ['OPEN', 'SEMI_CLOSED', 'CLOSED', 'CLOSED'],
  );
  assert.ok(row.intervals.every((i) => i.attendanceEvents.length === 0));
});
test('SUPER_ADMIN has the same exact records/metadata access and no mutation can accept snapshot authorization', async () => {
  const root = await person('SUPER_ADMIN');
  const who = await person();
  const r = await api('', { user: root, body: manual({ userId: who.id }) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await api('/' + r.body.data.id, { user: root })).status, 200);
  const list = await api('/monthly?month=2&year=2024&employeeId=' + who.id, { user: root });
  assert.equal(list.status, 200);
  const snapshotToken = list.body.meta.snapshotToken;
  await apiError('/' + r.body.data.id, 'VALIDATION_ERROR', 422, {
    method: 'PATCH',
    user: root,
    body: { expectedVersion: 1, observations: 'x', snapshotToken },
  });
  await apiError('', 'VALIDATION_ERROR', 422, {
    user: root,
    body: { ...manual({ userId: who.id }), snapshotToken },
  });
});

test('GET record detail captures one coherent version with its intervals across a concurrent atomic commit', async () => {
  const who = await person();
  const row = await create(manual({ userId: who.id }));
  let reading;
  await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('LOCK TABLE "Interval" IN ACCESS EXCLUSIVE MODE');
      reading = api('/' + row.id);
      await until(async () => {
        const rows =
          await db.$queryRaw`SELECT query FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%Interval%'`;
        return rows.length > 0;
      });
      await tx.attendanceRecord.update({
        where: { id: row.id },
        data: { version: 2, totalWorkMinutes: 120 },
      });
      await tx.interval.update({
        where: { id: row.intervals[0].id },
        data: { endTime: new Date('2024-02-01T14:00:00Z') },
      });
    },
    { timeout: 10000 },
  );
  const result = await reading;
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const captured = result.body.data;
  assert.ok(
    (captured.version === 1 &&
      captured.totalWorkMinutes === 60 &&
      captured.intervals[0].endTime === '2024-02-01T13:00:00.000Z') ||
      (captured.version === 2 &&
        captured.totalWorkMinutes === 120 &&
        captured.intervals[0].endTime === '2024-02-01T14:00:00.000Z'),
    `Detail must reflect an integral state before or after commit: ${JSON.stringify(captured)}`,
  );
  // The read began before the blocked relation query; RepeatableRead captures
  // that earlier version. A subsequent GET must expose the entire new version.
  assert.deepEqual(captured, row);
  const fresh = await detail(row.id);
  assert.equal(fresh.version, 2);
  assert.equal(fresh.totalWorkMinutes, 120);
  assert.equal(fresh.intervals[0].endTime, '2024-02-01T14:00:00.000Z');
});
