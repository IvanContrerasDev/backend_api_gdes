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
  NODE_ENV: 'test',
  EMAIL_PROVIDER: 'log',
  WHATSAPP_PROVIDER: 'log',
  DATABASE_URL: databaseUrl,
  JWT_ACCESS_SECRET: 'test-f003-access-secret',
  PORT: '33443',
});
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const base = 'http://127.0.0.1:33443';
const suffix = randomUUID();
let server, site, admin, employee, pending;
const users = [];
const clients = [];
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
  return { status: response.status, body: await response.json() };
}
async function error(path, code, status, options) {
  const result = await request(path, options);
  assert.equal(result.status, status, JSON.stringify(result.body));
  assert.equal(result.body.error.code, code);
  assert.equal(result.body.error.retryable, false);
}
async function client(name) {
  const r = await request('/api/v1/clients', { method: 'POST', body: { name } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  clients.push(r.body.data.id);
  return r.body.data;
}
function workplace(clientId, name = `Lugar ${suffix}`) {
  return {
    clientId,
    siteId: site.id,
    name,
    latitude: -31.4,
    longitude: -64.2,
    radiusMeters: 100,
    gpsAccuracyThreshold: null,
  };
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
  server.stdout.on('data', (x) => (output += x));
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
  if (db.workplace) await db.workplace.deleteMany({ where: { clientId: { in: clients } } });
  if (db.client) await db.client.deleteMany({ where: { id: { in: clients } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});
test('health stays unprefixed; sites are protected and seeded', async () => {
  assert.deepEqual((await request('/health')).body, { data: { status: 'ok' } });
  const r = await request('/api/v1/sites');
  assert.equal(r.status, 200);
  assert.equal(r.body.data.length, 6);
  await error('/api/v1/sites', 'INVALID_TOKEN', 401, { jwt: null });
  await error('/api/v1/sites', 'ROLE_NOT_ALLOWED', 403, { jwt: token(employee) });
});
test('JWT rejects forged, expired, wrong type/algorithm/claims and current inactive accounts', async () => {
  for (const jwt of [
    token(admin, {}, 'wrong'),
    token(admin, { exp: 1 }),
    token(admin, { type: 'refresh' }),
    token(admin, {}, undefined, 'HS512'),
    token(admin, { sub: 'invalid' }),
    token(admin, { role: 'BAD' }),
    token(admin, { sub: randomUUID() }),
  ])
    await error('/api/v1/sites', 'INVALID_TOKEN', 401, { jwt });
  await db.user.update({ where: { id: admin.id }, data: { accountStatus: 'INACTIVE' } });
  try {
    await error('/api/v1/sites', 'ACCOUNT_INACTIVE', 403);
  } finally {
    await db.user.update({ where: { id: admin.id }, data: { accountStatus: 'ACTIVE' } });
  }
  await error('/api/v1/sites', 'INVALID_TOKEN', 401, { jwt: token(pending) });
  await db.user.update({ where: { id: admin.id }, data: { role: 'EMPLOYEE' } });
  try {
    await error('/api/v1/sites', 'INVALID_TOKEN', 401);
  } finally {
    await db.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
    await db.authSession.update({ where: { id: admin.sessionId }, data: { role: 'ADMIN' } });
  }
});
test('clients CRUD, normalization, accent search, pagination, concurrent uniqueness and no DELETE', async () => {
  const c = await client(`  Ácme ${suffix}  `);
  assert.equal(c.name, `Ácme ${suffix}`);
  assert.equal(c.status, 'ACTIVE');
  assert.equal((await request(`/api/v1/clients/${c.id}`)).body.data.id, c.id);
  await error('/api/v1/clients', 'CLIENT_NAME_ALREADY_EXISTS', 409, {
    method: 'POST',
    body: { name: `áCME   ${suffix}` },
  });
  const results = await Promise.all(
    [1, 2].map(() =>
      request('/api/v1/clients', { method: 'POST', body: { name: `Race ${suffix}` } }),
    ),
  );
  assert.deepEqual(results.map((x) => x.status).sort(), [201, 409]);
  clients.push(results.find((x) => x.status === 201).body.data.id);
  const list = await request(`/api/v1/clients?search=acme%20${suffix}&status=ACTIVE&pageSize=1`);
  assert.equal(list.body.data[0].id, c.id);
  assert.deepEqual(list.body.pagination, { page: 1, pageSize: 1, totalItems: 1, totalPages: 1 });
  assert.equal(
    (
      await request(`/api/v1/clients/${c.id}`, {
        method: 'PUT',
        body: { name: `Renamed ${suffix}` },
      })
    ).body.data.name,
    `Renamed ${suffix}`,
  );
  await error(`/api/v1/clients/${c.id}`, 'INVALID_CLIENT_DATA', 400, { method: 'PUT', body: {} });
  await error('/api/v1/clients', 'INVALID_CLIENT_DATA', 400, {
    method: 'POST',
    body: { name: ' ' },
  });
  await error(`/api/v1/clients/${randomUUID()}`, 'CLIENT_NOT_FOUND', 404);
  assert.equal((await request(`/api/v1/clients/${c.id}`, { method: 'DELETE' })).status, 404);
  await error('/api/v1/clients', 'ROLE_NOT_ALLOWED', 403, { jwt: token(employee) });
});
test('workplace CRUD, mobile projection, AND filters, geography, FK validation, full PUT, status without cascade', async () => {
  const c = await client(`Empresa ${suffix}`);
  const input = workplace(c.id, `Fábrica ${suffix}`);
  const created = await request('/api/v1/workplaces', { method: 'POST', body: input });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const w = created.body.data;
  assert.equal(w.client.id, c.id);
  assert.equal(w.site.name, site.name);
  assert.equal(w.shapeType, 'CIRCLE');
  assert.equal((await request(`/api/v1/workplaces/${w.id}`)).body.data.id, w.id);
  const list = await request(
    `/api/v1/workplaces?search=fabrica%20${suffix}&clientId=${c.id}&siteId=${site.id}&status=ACTIVE&page=1&pageSize=1`,
  );
  assert.equal(list.body.pagination.totalItems, 1);
  assert.equal(list.body.data[0].id, w.id);
  const mobile = await request('/api/v1/workplaces', { jwt: token(employee) });
  const item = mobile.body.data.find((x) => x.id === w.id);
  assert.deepEqual(item, {
    id: w.id,
    name: input.name,
    siteId: site.id,
    siteName: site.name,
    clientName: c.name,
    latitude: -31.4,
    longitude: -64.2,
    radiusMeters: 100,
  });
  assert.equal(mobile.body.pagination, undefined);
  const concurrent = await Promise.all(
    [1, 2].map(() =>
      request('/api/v1/workplaces', {
        method: 'POST',
        body: workplace(c.id, `Race place ${suffix}`),
      }),
    ),
  );
  assert.deepEqual(concurrent.map((x) => x.status).sort(), [201, 409]);
  for (const field of Object.keys(input)) {
    const body = { ...input };
    delete body[field];
    await error(
      `/api/v1/workplaces/${w.id}`,
      field === 'siteId'
        ? 'INVALID_SITE'
        : ['latitude', 'longitude', 'radiusMeters', 'gpsAccuracyThreshold'].includes(field)
          ? 'INVALID_GEO_CONFIGURATION'
          : 'INVALID_WORKPLACE_DATA',
      400,
      { method: 'PUT', body },
    );
  }
  for (const patch of [
    { latitude: 91 },
    { longitude: -181 },
    { radiusMeters: 9 },
    { radiusMeters: 10001 },
    { radiusMeters: 1.5 },
    { gpsAccuracyThreshold: 0 },
    { gpsAccuracyThreshold: 1001 },
    { latitude: '0' },
  ])
    await error('/api/v1/workplaces', 'INVALID_GEO_CONFIGURATION', 400, {
      method: 'POST',
      body: { ...input, ...patch },
    });
  await error('/api/v1/workplaces', 'INVALID_SITE', 400, {
    method: 'POST',
    body: { ...input, siteId: randomUUID() },
  });
  await error('/api/v1/workplaces', 'CLIENT_NOT_FOUND', 404, {
    method: 'POST',
    body: { ...input, clientId: randomUUID() },
  });
  for (const boundary of [
    { latitude: -90, longitude: -180, radiusMeters: 10, gpsAccuracyThreshold: 1 },
    { latitude: 90, longitude: 180, radiusMeters: 10000, gpsAccuracyThreshold: 1000 },
  ])
    assert.equal(
      (
        await request(`/api/v1/workplaces/${w.id}`, {
          method: 'PUT',
          body: { ...input, ...boundary },
        })
      ).status,
      200,
    );
  assert.equal(
    (
      await request(`/api/v1/clients/${c.id}/status`, {
        method: 'PATCH',
        body: { status: 'INACTIVE' },
      })
    ).body.data.status,
    'INACTIVE',
  );
  assert.equal((await request(`/api/v1/workplaces/${w.id}`)).body.data.status, 'ACTIVE');
  assert.equal(
    (await request('/api/v1/workplaces', { jwt: token(employee) })).body.data.some(
      (x) => x.id === w.id,
    ),
    false,
  );
  await error('/api/v1/workplaces', 'CLIENT_INACTIVE', 409, {
    method: 'POST',
    body: workplace(c.id, 'inactive'),
  });
  assert.equal(
    (await request(`/api/v1/workplaces/${w.id}`, { method: 'PUT', body: input })).status,
    200,
  ); // historic corrections retained
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await request(`/api/v1/workplaces/${w.id}/status`, {
          method: 'PATCH',
          body: { status: 'INACTIVE' },
        })
      ).body.data.status,
      'INACTIVE',
    );
  assert.equal((await db.workplace.findUniqueOrThrow({ where: { id: w.id } })).status, 'INACTIVE');
  for (const [path, method, body] of [
    [`/${w.id}`, 'GET'],
    ['', 'POST', input],
    [`/${w.id}`, 'PUT', input],
    [`/${w.id}/status`, 'PATCH', { status: 'ACTIVE' }],
  ])
    await error(`/api/v1/workplaces${path}`, 'ROLE_NOT_ALLOWED', 403, {
      jwt: token(employee),
      method,
      body,
    });
});

test('invalid filters, identifiers, payloads and pagination return domain 4xx', async () => {
  for (const query of [
    'page=0',
    'pageSize=101',
    'page=1.5',
    'status=OTHER',
    'search=a&search=b',
    'sortBy=name',
  ])
    await error(`/api/v1/clients?${query}`, 'INVALID_CLIENT_DATA', 400);
  await error('/api/v1/clients/no-uuid', 'INVALID_CLIENT_DATA', 400);
  await error('/api/v1/workplaces/no-uuid', 'INVALID_WORKPLACE_DATA', 400);
  await error('/api/v1/workplaces?siteId=bad', 'INVALID_SITE', 400);
  await error('/api/v1/workplaces?clientId=bad', 'INVALID_WORKPLACE_DATA', 400);
  await error('/api/v1/workplaces?clientId=a&clientId=b', 'INVALID_WORKPLACE_DATA', 400);
  await error('/api/v1/clients', 'INVALID_CLIENT_DATA', 400, { method: 'POST', body: [] });
  await error('/api/v1/clients', 'INVALID_CLIENT_DATA', 400, {
    method: 'POST',
    body: { name: 'x'.repeat(121) },
  });
  await error(`/api/v1/workplaces/${randomUUID()}`, 'WORKPLACE_NOT_FOUND', 404);
  await error('/api/v1/workplaces', 'INVALID_TOKEN', 401, { jwt: token(pending) });
  await db.user.update({ where: { id: admin.id }, data: { role: 'SUPER_ADMIN' } });
  await db.authSession.update({ where: { id: admin.sessionId }, data: { role: 'SUPER_ADMIN' } });
  try {
    assert.equal(
      (await request('/api/v1/sites', { jwt: token({ ...admin, role: 'SUPER_ADMIN' }) })).status,
      200,
    );
  } finally {
    await db.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
    await db.authSession.update({ where: { id: admin.sessionId }, data: { role: 'ADMIN' } });
  }
});

test('fixed ordering, multiple pages, literal search and scoped workplace uniqueness', async () => {
  const b = await client(`Paging ${suffix} B`);
  const a = await client(`Paging ${suffix} A`);
  const p1 = await request(`/api/v1/clients?search=Paging%20${suffix}&pageSize=1`);
  const p2 = await request(`/api/v1/clients?search=Paging%20${suffix}&pageSize=1&page=2`);
  assert.equal(p1.body.data[0].id, a.id);
  assert.equal(p2.body.data[0].id, b.id);
  assert.deepEqual(p2.body.pagination, { page: 2, pageSize: 1, totalItems: 2, totalPages: 2 });
  assert.equal(
    (await request(`/api/v1/clients?search=Paging%20${suffix}&page=3&pageSize=1`)).body.data.length,
    0,
  );
  assert.equal((await request('/api/v1/clients?search=%25')).body.pagination.totalItems, 0);
  const input = workplace(a.id, `Scoped ${suffix}`);
  assert.equal((await request('/api/v1/workplaces', { method: 'POST', body: input })).status, 201);
  await error('/api/v1/workplaces', 'WORKPLACE_NAME_ALREADY_EXISTS', 409, {
    method: 'POST',
    body: { ...input, name: ` scoped   ${suffix} ` },
  });
  const other = await request('/api/v1/workplaces', {
    method: 'POST',
    body: { ...input, clientId: b.id },
  });
  assert.equal(other.status, 201);
  await request(`/api/v1/clients/${a.id}/status`, {
    method: 'PATCH',
    body: { status: 'INACTIVE' },
  });
  await error(`/api/v1/workplaces/${other.body.data.id}`, 'CLIENT_INACTIVE', 409, {
    method: 'PUT',
    body: input,
  });
  assert.equal(
    (await request(`/api/v1/workplaces?clientId=${b.id}&status=INACTIVE`)).body.pagination
      .totalItems,
    0,
  );
});

test('creation waits for concurrent client deactivation before checking ACTIVE', async () => {
  const c = await client(`Locked ${suffix}`);
  let creating;
  await db.$transaction(async (tx) => {
    await tx.client.update({ where: { id: c.id }, data: { status: 'INACTIVE' } });
    creating = request('/api/v1/workplaces', {
      method: 'POST',
      body: workplace(c.id, `Locked workplace ${suffix}`),
    });
    // UPDATE holds the row lock through commit; the HTTP handler must check status after it.
  });
  const r = await creating;
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'CLIENT_INACTIVE');
  assert.equal(await db.workplace.count({ where: { clientId: c.id } }), 0);
});

test('concurrent historical edit and reassignment serialize the workplace relation before deciding inactive client eligibility', async () => {
  const a = await client(`Serial A ${suffix}`);
  const b = await client(`Serial B ${suffix}`);
  const input = workplace(a.id, `Serial workplace ${suffix}`);
  const created = await request('/api/v1/workplaces', { method: 'POST', body: input });
  assert.equal(created.status, 201);
  const id = created.body.data.id;
  let historicalEdit,
    reassignment,
    reassignmentFinished = false;
  async function until(predicate) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail('Expected PostgreSQL lock wait or completed concurrent request');
  }
  async function waitingOn(table) {
    const rows = await db.$queryRaw`
      SELECT query FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%'
    `;
    return rows.some((row) => row.query.includes(`"${table}"`));
  }
  await db.$transaction(
    async (tx) => {
      await tx.client.update({ where: { id: a.id }, data: { status: 'INACTIVE' } });
      historicalEdit = request(`/api/v1/workplaces/${id}`, { method: 'PUT', body: input });
      // First request is now suspended after attempting to lock its destination client.
      await until(() => waitingOn('Client'));
      reassignment = request(`/api/v1/workplaces/${id}`, {
        method: 'PUT',
        body: { ...input, clientId: b.id },
      }).finally(() => {
        reassignmentFinished = true;
      });
      // Old implementation completes the reassignment here; correct implementation
      // waits for the Workplace row lock. Both outcomes release the client blocker.
      await until(async () => reassignmentFinished || (await waitingOn('Workplace')));
    },
    { timeout: 10000 },
  );
  const [historical, moved] = await Promise.all([historicalEdit, reassignment]);
  assert.equal(historical.status, 200, JSON.stringify(historical.body));
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  const final = await request(`/api/v1/workplaces/${id}`);
  assert.equal(
    final.body.data.client.id,
    b.id,
    'a stale historical edit must never move the workplace back to INACTIVE client A',
  );
  assert.equal(final.body.data.client.status, 'ACTIVE');
});
