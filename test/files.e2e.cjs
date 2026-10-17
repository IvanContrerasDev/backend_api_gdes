const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac, createHash, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { createServer } = require('node:http');
const { once } = require('node:events');
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
  JWT_ACCESS_SECRET: 'test-f007-access-secret',
  PORT: '33450',
});
const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
const base = 'http://127.0.0.1:33450';
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
  const client = await db.client.create({ data: { name: `F007 ${randomUUID()}` } });
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
      lastName: 'F007',
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

const objects = new Map();
const uploads = [];
let s3,
  failPut = [],
  failDelete = false,
  crashUpload = false;
let holdPut = false,
  pendingPutResponses = [],
  ambiguousDelete = false;
async function startApi() {
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
}
async function stopApi(signal = 'SIGTERM') {
  if (server && server.exitCode === null) {
    const closed = once(server, 'exit');
    server.kill(signal);
    await closed;
  }
}
before(async () => {
  site = await db.site.findFirstOrThrow();
  employee = await person();
  other = await person();
  admin = await person('ADMIN');
  workplace = await place();
  s3 = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const key = decodeURIComponent(url.pathname.replace(/^\/gdes-files-test\//, ''));
    if (req.method === 'PUT') {
      const mode = failPut.shift();
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      if (mode !== 'before') {
        const row = {
          key,
          body: Buffer.concat(chunks),
          contentType: req.headers['content-type'],
          authorization: req.headers.authorization,
        };
        objects.set(key, row);
        uploads.push(row);
      }
      if (crashUpload || mode === 'after') {
        res.destroy();
        return;
      }
      if (mode === 'before') {
        res.writeHead(503).end('<Error><Code>ServiceUnavailable</Code></Error>');
        return;
      }
      if (holdPut) {
        pendingPutResponses.push(res);
        return;
      }
      res.writeHead(200, { ETag: '"fake-etag"' }).end();
    } else if (req.method === 'DELETE') {
      if (failDelete) res.writeHead(503).end('<Error><Code>ServiceUnavailable</Code></Error>');
      else {
        objects.delete(key);
        if (ambiguousDelete) res.destroy();
        else res.writeHead(204).end();
      }
    } else if (req.method === 'GET') {
      const row = objects.get(key);
      if (row) res.writeHead(200, { 'content-type': row.contentType }).end(row.body);
      else res.writeHead(404).end();
    } else res.writeHead(400).end();
  });
  s3.listen(0, '127.0.0.1');
  await once(s3, 'listening');
  Object.assign(env, {
    STORAGE_ENDPOINT: `http://127.0.0.1:${s3.address().port}`,
    STORAGE_BUCKET: 'gdes-files-test',
    STORAGE_ACCESS_KEY_ID: 'local-test-access',
    STORAGE_SECRET_ACCESS_KEY: 'local-test-secret',
    STORAGE_REGION: 'auto',
  });
  await startApi();
});
after(async () => {
  await stopApi();
  if (db.document) await db.document.deleteMany({ where: { employeeId: { in: users } } });
  await db.timesheet.deleteMany({ where: { employeeId: { in: users } } });
  if (db.storageCleanupJob)
    await db.storageCleanupJob.deleteMany({
      where: { key: { in: uploads.map((row) => row.key) } },
    });
  await db.workplace.deleteMany({ where: { clientId: { in: clients } } });
  await db.client.deleteMany({ where: { id: { in: clients } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
  s3?.closeAllConnections();
  if (s3?.listening) await new Promise((r) => s3.close(r));
});
const txt = Buffer.from('Planilla UTF-8 válida.\n');
function form(fields, files = [{ name: 'archivo.txt', body: txt }], fileField = 'files') {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, String(value));
  for (const file of files)
    body.append(
      fileField,
      new Blob([file.body], { type: file.mime || 'application/octet-stream' }),
      file.name,
    );
  return body;
}
async function fileRequest(
  path,
  { user = admin, body, method = body === undefined ? 'GET' : 'POST' } = {},
) {
  const r = await fetch(base + '/api/v1' + path, {
    method,
    headers: user ? { Authorization: `Bearer ${token(user)}` } : {},
    body,
  });
  return { status: r.status, headers: r.headers, body: r.status === 204 ? null : await r.json() };
}
function tsFields(who = employee, p = workplace, overrides = {}) {
  return { employeeId: who.id, workplaceId: p.id, month: 10, year: 2046, ...overrides };
}
async function uploadTimesheets(who = employee, p = workplace, files, overrides = {}) {
  return fileRequest('/timesheets', { body: form(tsFields(who, p, overrides), files) });
}
async function uploadDocuments(who = employee, fields = {}, files) {
  return fileRequest('/documents', {
    body: form({ employeeId: who.id, type: 'OTHER', ...fields }, files),
  });
}
function keys(row, expected) {
  assert.deepEqual(Object.keys(row).sort(), expected.sort());
}
async function until(predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail('Expected asynchronous cleanup/lock condition');
}

test('public catalogs publish only fixed Spanish enums and province references before login', async () => {
  const r = await fileRequest('/catalogs', { user: null });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  keys(r.body.data, ['absenceReasons', 'documentTypes', 'sites']);
  assert.equal(r.body.data.documentTypes.length, 9);
  assert.deepEqual(
    r.body.data.documentTypes.find((x) => x.value === 'INTERNAL_RULES'),
    { value: 'INTERNAL_RULES', label: 'Normas internas' },
  );
  assert.ok(!r.body.data.documentTypes.some((x) => x.value === 'INTERNAL_POLICIES'));
  assert.equal(r.body.data.sites.length, 6);
  assert.equal((await fileRequest('/catalogs', { user: employee })).status, 200);
  assert.equal((await fileRequest('/catalogs', { user: null })).status, 200);
  for (const row of [
    ...r.body.data.absenceReasons,
    ...r.body.data.documentTypes,
    ...r.body.data.sites,
  ])
    keys(row, ['value', 'label']);
});

test('admin batch uploads real bytes atomically and exact public DTOs do not expose keys or credentials', async () => {
  const who = await person();
  const p = await place();
  const r = await uploadTimesheets(who, p, [
    { name: 'Árbol.txt', body: txt },
    { name: 'otro.txt', body: txt },
  ]);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  keys(r.body.data, ['created']);
  assert.equal(r.body.data.created.length, 2);
  for (const [index, row] of r.body.data.created.entries()) {
    keys(row, [
      'id',
      'employee',
      'workplace',
      'client',
      'site',
      'month',
      'year',
      'sequence',
      'status',
      'fileName',
      'fileExtension',
      'fileSizeBytes',
      'uploadedBy',
      'createdAt',
      'updatedAt',
      'version',
      'replacedBy',
    ]);
    assert.equal(row.sequence, index + 1);
    assert.equal(row.status, 'PENDING');
    assert.equal(row.version, 1);
    assert.equal(row.replacedBy, null);
    assert.equal(row.employee.id, who.id);
    assert.equal(row.workplace.id, p.id);
    const persisted = await db.timesheet.findUniqueOrThrow({ where: { id: row.id } });
    assert.deepEqual(objects.get(persisted.fileKey).body, txt);
    assert.match(objects.get(persisted.fileKey).authorization, /^AWS4-HMAC-SHA256 /);
    assert.equal(objects.get(persisted.fileKey).contentType, 'text/plain');
  }
  const docs = await uploadDocuments(who, { workplaceId: 'null', type: 'INTERNAL_RULES' });
  assert.equal(docs.status, 201, JSON.stringify(docs.body));
  const row = docs.body.data.created[0];
  keys(row, [
    'id',
    'employee',
    'workplace',
    'type',
    'fileName',
    'fileExtension',
    'fileSizeBytes',
    'uploadedBy',
    'createdAt',
    'updatedAt',
  ]);
  assert.equal(row.workplace, null);
  assert.equal(row.type, 'INTERNAL_RULES');
});

test('mobile derives employee identity, cannot list or manage files and cannot learn another owner exists', async () => {
  const fields = { workplaceId: workplace.id, month: 11, year: 2046 };
  const r = await fileRequest('/timesheets', { user: employee, body: form(fields) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  keys(r.body.data, ['timesheetIds', 'message']);
  const id = r.body.data.timesheetIds[0];
  assert.equal((await fileRequest('/timesheets/' + id, { user: employee })).status, 200);
  assert.equal((await fileRequest('/timesheets/' + id, { user: other })).status, 404);
  assert.equal((await fileRequest('/timesheets/' + id + '/file', { user: other })).status, 404);
  assert.equal((await fileRequest('/timesheets', { user: employee })).status, 403);
  assert.equal(
    (
      await fileRequest('/timesheets', {
        user: employee,
        body: form({ ...fields, employeeId: other.id }),
      })
    ).status,
    422,
  );
  const doc = await fileRequest('/documents', { user: employee, body: form({ type: 'DNI' }) });
  assert.equal(doc.status, 201, JSON.stringify(doc.body));
  keys(doc.body.data, ['documentIds', 'message']);
  const docId = doc.body.data.documentIds[0];
  assert.equal((await fileRequest('/documents/' + docId, { user: other })).status, 404);
  assert.equal(
    (await fileRequest('/documents/' + docId, { method: 'DELETE', user: employee })).status,
    403,
  );
  assert.equal((await fileRequest('/timesheets/' + id, { method: 'DELETE' })).status, 404);
});

test('downloads sign a fresh private URL with exact fifteen minute expiry and no-store', async () => {
  const r = await uploadDocuments();
  const id = r.body.data.created[0].id;
  const before = Date.now();
  const signed = await fileRequest('/documents/' + id + '/file', { user: employee });
  const after = Date.now();
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  assert.equal(signed.headers.get('cache-control'), 'no-store');
  keys(signed.body.data, ['downloadUrl', 'expiresAt']);
  const url = new URL(signed.body.data.downloadUrl);
  assert.equal(url.searchParams.get('X-Amz-Expires'), '900');
  assert.ok(
    Date.parse(signed.body.data.expiresAt) >= before + 900000 &&
      Date.parse(signed.body.data.expiresAt) <= after + 900000,
  );
  assert.deepEqual(Buffer.from(await (await fetch(url)).arrayBuffer()), txt);
});

test('concurrent timesheet batches allocate consecutive sequence numbers without collisions', async () => {
  const who = await person();
  const p = await place();
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      uploadTimesheets(who, p, [
        { name: 'a.txt', body: txt },
        { name: 'b.txt', body: txt },
      ]),
    ),
  );
  assert.ok(
    results.every((r) => r.status === 201),
    JSON.stringify(results),
  );
  assert.deepEqual(
    results.flatMap((r) => r.body.data.created.map((row) => row.sequence)).sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
});

test('replacement CAS resets PENDING, retains original audit identity and stale requests never delete winner', async () => {
  const created = await uploadTimesheets(await person(), await place());
  const original = created.body.data.created[0];
  const status = await request('/api/v1/timesheets/' + original.id + '/status', {
    user: admin,
    method: 'PATCH',
    body: { status: 'LOADED' },
  });
  assert.equal(status.status, 200, JSON.stringify(status.body));
  assert.equal(status.body.data.version, 2);
  const replacements = await Promise.all(
    ['ganador.txt', 'otro.txt'].map((name) =>
      fileRequest('/timesheets/' + original.id + '/file', {
        method: 'PUT',
        body: form({ expectedVersion: 2 }, [{ name, body: Buffer.from(name) }], 'file'),
      }),
    ),
  );
  assert.deepEqual(replacements.map((r) => r.status).sort(), [200, 409]);
  const winner = replacements.find((r) => r.status === 200).body.data;
  assert.equal(winner.status, 'PENDING');
  assert.equal(winner.version, 3);
  assert.equal(winner.id, original.id);
  assert.equal(winner.sequence, original.sequence);
  assert.equal(winner.createdAt, original.createdAt);
  assert.deepEqual(winner.uploadedBy, original.uploadedBy);
  assert.equal(winner.replacedBy.id, admin.id);
  const current = await db.timesheet.findUniqueOrThrow({ where: { id: winner.id } });
  assert.ok(objects.has(current.fileKey));
  const metric = await request('/api/v1/dashboard/metrics?month=10&year=2046', { user: admin });
  assert.ok(metric.body.data.pendingTimesheets >= 1);
});

test('file validation rejects entire batches before upload for extension/content, empty bytes and malformed multipart', async () => {
  const who = await person();
  const p = await place();
  const before = uploads.length;
  for (const file of [
    { name: 'zero.txt', body: Buffer.alloc(0) },
    { name: 'binary.txt', body: Buffer.from([0, 1, 2]) },
    { name: 'utf8.txt', body: Buffer.from([0xc0, 0x80]) },
    { name: 'spoof.pdf', body: txt },
    { name: 'bad.exe', body: txt },
    { name: '../traversal.txt', body: txt },
    { name: 'a\\b.txt', body: txt },
  ]) {
    const r = await uploadTimesheets(who, p, [{ name: 'valid.txt', body: txt }, file]);
    assert.equal(r.status, 422, JSON.stringify(r.body));
  }
  assert.equal(uploads.length, before);
  assert.equal(await db.timesheet.count({ where: { employeeId: who.id } }), 0);
  const repeated = form(tsFields(who, p));
  repeated.append('month', '11');
  assert.equal((await fileRequest('/timesheets', { body: repeated })).status, 422);
  assert.equal((await uploadDocuments(who, { type: 'INTERNAL_POLICIES' })).status, 422);
});

test('transport accepts exact 20MiB and ten files but rejects one byte/one file above the bound', async () => {
  const who = await person();
  const p = await place();
  const large = Buffer.alloc(20 * 1024 * 1024, 0x61);
  const accepted = await uploadTimesheets(who, p, [{ name: 'limit.txt', body: large }]);
  assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
  const tooLarge = await uploadTimesheets(who, p, [
    { name: 'too-big.txt', body: Buffer.alloc(large.length + 1, 0x61) },
  ]);
  assert.equal(tooLarge.status, 422);
  assert.equal(tooLarge.body.error.code, 'FILE_TOO_LARGE');
  assert.equal(
    (
      await uploadTimesheets(
        who,
        p,
        Array.from({ length: 10 }, (_, i) => ({ name: i + '.txt', body: txt })),
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await uploadTimesheets(
        who,
        p,
        Array.from({ length: 11 }, (_, i) => ({ name: i + '.txt', body: txt })),
      )
    ).status,
    422,
  );
});

test('ambiguous PUT with failing compensation remains durable and is cleaned after process restart', async () => {
  const who = await person();
  const p = await place();
  const before = uploads.length;
  failPut = [undefined, 'after'];
  failDelete = true;
  const r = await uploadTimesheets(who, p, [
    { name: 'first.txt', body: txt },
    { name: 'second.txt', body: txt },
  ]);
  assert.equal(r.status, 503, JSON.stringify(r.body));
  assert.equal(r.body.error.code, 'STORAGE_UNAVAILABLE');
  assert.equal(await db.timesheet.count({ where: { employeeId: who.id } }), 0);
  const keys = uploads.slice(before).map((r) => r.key);
  assert.equal(keys.length, 2);
  assert.equal(await db.storageCleanupJob.count({ where: { key: { in: keys } } }), 2);
  await stopApi();
  failDelete = false;
  await db.storageCleanupJob.updateMany({
    where: { key: { in: keys } },
    data: { nextAttemptAt: new Date(0) },
  });
  await startApi();
  await until(async () => keys.every((key) => !objects.has(key)));
});

test('cleanup after ambiguous database publication preserves currently referenced keys', async () => {
  const r = await uploadTimesheets(await person(), await place());
  const row = await db.timesheet.findUniqueOrThrow({ where: { id: r.body.data.created[0].id } });
  await stopApi();
  await db.storageCleanupJob.upsert({
    where: { key: row.fileKey },
    create: {
      key: row.fileKey,
      namespace: createHash('sha256')
        .update(JSON.stringify([new URL(env.STORAGE_ENDPOINT).toString(), env.STORAGE_BUCKET]))
        .digest('hex'),
      nextAttemptAt: new Date(0),
    },
    update: { nextAttemptAt: new Date(0) },
  });
  await startApi();
  await until(
    async () => !(await db.storageCleanupJob.findUnique({ where: { key: row.fileKey } })),
  );
  assert.ok(objects.has(row.fileKey));
  assert.equal((await fileRequest('/timesheets/' + row.id + '/file')).status, 200);
});

test('R2 adapter rejects invalid production transport before any credentials can be sent', () => {
  const { R2StorageService } = require('../dist/modules/storage/r2-storage.service');
  const { ConfigService } = require('@nestjs/config');
  for (const endpoint of [
    'http://external.example',
    'http://127.0.0.1:19999',
    'https://user:password@example.org',
    'https://example.org?secret=x',
    'not-a-url',
    'ftp://example.org',
  ]) {
    assert.throws(
      () =>
        new R2StorageService(
          new ConfigService({ ...env, NODE_ENV: 'production', STORAGE_ENDPOINT: endpoint }),
        ),
    );
  }
  const adapter = new R2StorageService(
    new ConfigService({ ...env, NODE_ENV: 'production', STORAGE_ENDPOINT: 'https://example.org' }),
  );
  adapter.onModuleDestroy();
});

async function leasePublicationRace(rollback) {
  const who = await person();
  const p = await place();
  const before = uploads.length;
  holdPut = true;
  const uploading = uploadTimesheets(who, p);
  await until(async () => uploads.length > before && pendingPutResponses.length > 0);
  const key = uploads[before].key;
  const trigger = 'f007_rollback_' + randomUUID().replaceAll('-', '');
  try {
    if (rollback) {
      await db.$executeRawUnsafe(
        `CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.key='${key.replaceAll("'", "''")}' THEN RAISE EXCEPTION 'F007 cleanup rollback'; END IF; RETURN OLD; END $$`,
      );
      await db.$executeRawUnsafe(
        `CREATE TRIGGER "${trigger}" BEFORE DELETE ON "StorageCleanupJob" FOR EACH ROW EXECUTE FUNCTION "${trigger}"()`,
      );
    } else ambiguousDelete = true;
    await db.storageCleanupJob.update({ where: { key }, data: { nextAttemptAt: new Date(0) } });
    await until(async () => !objects.has(key));
    await until(async () => {
      const job = await db.storageCleanupJob.findUnique({ where: { key } });
      return job && (rollback ? job.attempts === 0 : job.attempts > 0);
    });
    holdPut = false;
    for (const res of pendingPutResponses.splice(0))
      res.writeHead(200, { ETag: '"fake-etag"' }).end();
    const result = await uploading;
    assert.equal(result.status, 503, JSON.stringify(result.body));
    assert.equal(await db.timesheet.count({ where: { employeeId: who.id } }), 0);
  } finally {
    holdPut = false;
    ambiguousDelete = false;
    for (const res of pendingPutResponses.splice(0)) res.destroy();
    if (rollback) {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}" ON "StorageCleanupJob"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${trigger}"()`);
    }
  }
}
test('a publisher cannot resume after expired lease and an ambiguous cleanup DELETE', async () => {
  await leasePublicationRace(false);
});
test('a publisher cannot resume after cleanup deleted bytes but its database transaction rolled back', async () => {
  await leasePublicationRace(true);
});

test('a cleanup worker for a different storage target cannot consume another target journal', async () => {
  const who = await person();
  const p = await place();
  const before = uploads.length;
  holdPut = true;
  const uploading = uploadTimesheets(who, p).catch(() => null);
  await until(async () => uploads.length > before && pendingPutResponses.length > 0);
  const key = uploads[before].key;
  await stopApi('SIGKILL');
  holdPut = false;
  for (const res of pendingPutResponses.splice(0)) res.destroy();
  await uploading;
  await db.storageCleanupJob.update({ where: { key }, data: { nextAttemptAt: new Date(0) } });
  const { ConfigService } = require('@nestjs/config');
  const { R2StorageService } = require('../dist/modules/storage/r2-storage.service');
  const { StorageCleanupService } = require('../dist/modules/storage/storage-cleanup.service');
  const adapter = new R2StorageService(
    new ConfigService({ ...env, STORAGE_BUCKET: 'different-test-bucket' }),
  );
  try {
    await new StorageCleanupService(db, adapter).tick();
    assert.ok(
      await db.storageCleanupJob.findUnique({ where: { key } }),
      'Different storage target must not consume this cleanup journal',
    );
    assert.ok(objects.has(key));
  } finally {
    adapter.onModuleDestroy();
    await startApi();
  }
  await until(async () => !objects.has(key));
});

const jpegFixture = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDzWiiivSOA/9k=',
  'base64',
);
function zipFixture(entries) {
  const { crc32, deflateRawSync } = require('node:zlib');
  const local = [],
    central = [];
  let offset = 0;
  for (const item of entries) {
    const name = Buffer.from(item.name),
      data = Buffer.from(item.body),
      encoded = item.deflate ? deflateRawSync(data) : data;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(item.deflate ? 8 : 0, 8);
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(encoded.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, encoded);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(item.deflate ? 8 : 0, 10);
    record.writeUInt32LE(crc32(data), 16);
    record.writeUInt32LE(encoded.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + encoded.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
function docxEntries() {
  return [
    {
      name: '[Content_Types].xml',
      body: '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    },
    {
      name: '_rels/.rels',
      body: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    },
    {
      name: 'word/document.xml',
      body: '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>',
    },
  ];
}
function oleWordFixture() {
  const file = Buffer.alloc(19 * 512),
    header = file.subarray(0, 512);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(header);
  header.writeUInt16LE(0x3e, 24);
  header.writeUInt16LE(3, 26);
  header.writeUInt16LE(0xfffe, 28);
  header.writeUInt16LE(9, 30);
  header.writeUInt16LE(6, 32);
  header.writeUInt32LE(1, 44);
  header.writeUInt32LE(1, 48);
  header.writeUInt32LE(4096, 56);
  header.writeInt32LE(-2, 60);
  header.writeInt32LE(-2, 68);
  for (let i = 76; i < 512; i += 4) header.writeInt32LE(-1, i);
  header.writeInt32LE(0, 76);
  const fat = file.subarray(512, 1024);
  for (let i = 0; i < 512; i += 4) fat.writeInt32LE(-1, i);
  fat.writeInt32LE(-3, 0);
  fat.writeInt32LE(-2, 4);
  for (let i = 2; i < 18; i++) fat.writeInt32LE(i === 9 || i === 17 ? -2 : i + 1, i * 4);
  function entry(index, name, type, start, size, child = -1, left = -1) {
    const row = file.subarray(1024 + index * 128, 1024 + (index + 1) * 128);
    Buffer.from(name + '\0', 'utf16le').copy(row);
    row.writeUInt16LE((name.length + 1) * 2, 64);
    row[66] = type;
    row[67] = 1;
    row.writeInt32LE(left, 68);
    row.writeInt32LE(-1, 72);
    row.writeInt32LE(child, 76);
    row.writeInt32LE(start, 116);
    row.writeBigUInt64LE(BigInt(size), 120);
  }
  entry(0, 'Root Entry', 5, -2, 0, 1);
  entry(1, 'WordDocument', 2, 2, 4096, -1, 2);
  entry(2, '0Table', 2, 10, 4096);
  const word = file.subarray(1536, 1536 + 4096);
  word.writeUInt16LE(0xa5ec);
  word.writeUInt16LE(0xc1, 2);
  word.writeUInt32LE(32, 24);
  word.writeUInt32LE(32, 28);
  return file;
}
test('seven allowed extensions inspect actual contents and derive MIME independently of client headers', async () => {
  const files = [
    { name: 'a.pdf', body: Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n') },
    { name: 'b.jpg', body: jpegFixture },
    { name: 'c.JPEG', body: jpegFixture },
    {
      name: 'd.png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6rJkAAAAASUVORK5CYII=',
        'base64',
      ),
    },
    { name: 'e.doc', body: oleWordFixture() },
    { name: 'f.docx', body: zipFixture(docxEntries()) },
    { name: 'g.txt', body: txt },
  ];
  const r = await uploadDocuments(await person(), {}, files);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(
    r.body.data.created.map((x) => x.fileExtension),
    ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'txt'],
  );
});
test('ZIP XLSX, broken Word relationships, macro content, excessive inflation and non-Word OLE cannot masquerade as Word', async () => {
  const entries = docxEntries();
  const badRelationships = docxEntries();
  badRelationships[1].body = badRelationships[1].body.replace(
    'Target="word/document.xml"',
    'Target="xl/workbook.xml"',
  );
  const macro = docxEntries();
  macro[0].body = macro[0].body.replace(
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    'application/vnd.ms-word.document.macroEnabled.main+xml',
  );
  const dtd = docxEntries();
  dtd[2].body = '<!DOCTYPE x [<!ENTITY x "boom">]>' + dtd[2].body;
  const ole = oleWordFixture();
  Buffer.from('Workbook\0', 'utf16le').copy(ole, 1024 + 128);
  ole.writeUInt16LE(18, 1024 + 128 + 64);
  const cycle = oleWordFixture();
  cycle.writeInt32LE(2, 512 + 2 * 4);
  for (const file of [
    { name: 'xlsx.docx', body: zipFixture([{ name: 'xl/workbook.xml', body: '<workbook/>' }]) },
    { name: 'wrong-target.docx', body: zipFixture(badRelationships) },
    { name: 'macro.docx', body: zipFixture(macro) },
    { name: 'dtd.docx', body: zipFixture(dtd) },
    {
      name: 'bomb.docx',
      body: zipFixture([
        ...entries,
        { name: 'huge.xml', body: Buffer.alloc(20 * 1024 * 1024 + 1, 0x61), deflate: true },
      ]),
    },
    { name: 'traversal.docx', body: zipFixture([...entries, { name: '../evil', body: 'x' }]) },
    { name: 'excel.doc', body: ole },
    { name: 'cycle.doc', body: cycle },
  ]) {
    const r = await uploadDocuments(await person(), {}, [file]);
    assert.equal(r.status, 422, file.name + ': ' + JSON.stringify(r.body));
    assert.equal(r.body.error.code, 'FILE_TYPE_NOT_ALLOWED');
  }
});

test('document edits preserve storage identity and physical deletion failure is durably retried', async () => {
  const who = await person();
  const p = await place();
  const r = await uploadDocuments(who, { workplaceId: p.id });
  const original = r.body.data.created[0];
  const stored = await db.document.findUniqueOrThrow({ where: { id: original.id } });
  await db.user.update({ where: { id: who.id }, data: { accountStatus: 'INACTIVE' } });
  await db.workplace.update({ where: { id: p.id }, data: { status: 'INACTIVE' } });
  await db.client.update({ where: { id: p.clientId }, data: { status: 'INACTIVE' } });
  const edited = await request('/api/v1/documents/' + original.id, {
    user: admin,
    method: 'PATCH',
    body: { fileName: 'Nombre visible.pdf', type: 'DNI' },
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.data.fileExtension, 'txt');
  assert.equal(edited.body.data.fileName, 'Nombre visible.pdf');
  const after = await db.document.findUniqueOrThrow({ where: { id: original.id } });
  assert.equal(after.fileKey, stored.fileKey);
  assert.equal(after.contentType, 'text/plain');
  assert.equal((await fileRequest('/documents/' + original.id + '/file')).status, 200);
  failDelete = true;
  const deleted = await fileRequest('/documents/' + original.id, { method: 'DELETE' });
  assert.equal(deleted.status, 204);
  assert.equal(deleted.body, null);
  assert.equal((await fileRequest('/documents/' + original.id)).status, 404);
  assert.ok(await db.storageCleanupJob.findUnique({ where: { key: stored.fileKey } }));
  assert.ok(objects.has(stored.fileKey));
  await stopApi();
  failDelete = false;
  await db.storageCleanupJob.update({
    where: { key: stored.fileKey },
    data: { nextAttemptAt: new Date(0) },
  });
  await startApi();
  await until(async () => !objects.has(stored.fileKey));
});
test('failed replacement preserves the original file and audit, while postcommit cleanup failure preserves the new reference', async () => {
  const r = await uploadTimesheets(await person(), await place());
  const original = r.body.data.created[0];
  const stored = await db.timesheet.findUniqueOrThrow({ where: { id: original.id } });
  failPut = ['before'];
  const failed = await fileRequest('/timesheets/' + original.id + '/file', {
    method: 'PUT',
    body: form({ expectedVersion: 1 }, undefined, 'file'),
  });
  assert.equal(failed.status, 503, JSON.stringify(failed.body));
  assert.deepEqual(await db.timesheet.findUniqueOrThrow({ where: { id: original.id } }), stored);
  assert.ok(objects.has(stored.fileKey));
  failDelete = true;
  const replaced = await fileRequest('/timesheets/' + original.id + '/file', {
    method: 'PUT',
    body: form({ expectedVersion: 1 }, [{ name: 'replaced.txt', body: txt }], 'file'),
  });
  assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
  const current = await db.timesheet.findUniqueOrThrow({ where: { id: original.id } });
  assert.notEqual(current.fileKey, stored.fileKey);
  assert.ok(objects.has(current.fileKey));
  assert.ok(await db.storageCleanupJob.findUnique({ where: { key: stored.fileKey } }));
  failDelete = false;
  await db.storageCleanupJob.update({
    where: { key: stored.fileKey },
    data: { nextAttemptAt: new Date(0) },
  });
  await until(async () => !objects.has(stored.fileKey));
  assert.ok(objects.has(current.fileKey));
});
test('file lists apply literal accent-insensitive full-name searches, AND filters, stable paging and GMT-3 civil upload ranges', async () => {
  const who = await person();
  const p = await place();
  const uploader = await person('ADMIN');
  await db.user.update({
    where: { id: who.id },
    data: { firstName: 'Rocío', lastName: 'Pérez', employeeId: 'F007-' + suffix },
  });
  await db.user.update({
    where: { id: uploader.id },
    data: { firstName: 'Ángela', lastName: 'Díaz' },
  });
  const docs = await fileRequest('/documents', {
    user: uploader,
    body: form({ employeeId: who.id, type: 'DNI' }, [
      { name: 'Árbol%.txt', body: txt },
      { name: 'segundo.txt', body: txt },
      { name: 'tercero.txt', body: txt },
    ]),
  });
  assert.equal(docs.status, 201, JSON.stringify(docs.body));
  const ids = docs.body.data.created.map((row) => row.id);
  for (const [i, time] of [
    '2047-05-01T02:59:59.999Z',
    '2047-05-01T03:00:00Z',
    '2047-05-02T02:59:59.999Z',
  ].entries())
    await db.document.update({ where: { id: ids[i] }, data: { createdAt: new Date(time) } });
  const query = (q) =>
    fileRequest('/documents?' + new URLSearchParams({ employeeId: who.id, ...q }));
  const exactDay = await query({
    uploadedFrom: '2047-05-01',
    uploadedTo: '2047-05-01',
    uploadedBy: 'angela diaz',
    search: 'rocio perez',
    type: 'DNI',
    pageSize: 1,
  });
  assert.equal(exactDay.status, 200, JSON.stringify(exactDay.body));
  assert.equal(exactDay.body.pagination.totalItems, 2);
  assert.equal(exactDay.body.data[0].id, ids[2]);
  const second = await query({
    uploadedFrom: '2047-05-01',
    uploadedTo: '2047-05-01',
    uploadedBy: 'angela diaz',
    search: 'rocio perez',
    type: 'DNI',
    pageSize: 1,
    page: 2,
  });
  assert.equal(second.body.data[0].id, ids[1]);
  assert.equal((await query({ search: 'arbol%' })).body.data[0].id, ids[0]);
  assert.equal((await query({ uploadedBy: uploader.id })).body.pagination.totalItems, 0);
  const sheets = await uploadTimesheets(
    who,
    p,
    [
      { name: 'Planilla.txt', body: txt },
      { name: 'otra.txt', body: txt },
    ],
    { month: 2, year: 2047 },
  );
  const ts = await fileRequest(
    '/timesheets?' +
      new URLSearchParams({
        employeeId: who.id,
        clientId: p.clientId,
        workplaceId: p.id,
        siteId: p.siteId,
        month: 2,
        status: 'PENDING',
        search: 'rocio perez',
        pageSize: 1,
      }),
  );
  assert.equal(ts.status, 200, JSON.stringify(ts.body));
  assert.equal(ts.body.pagination.totalItems, 2);
  assert.equal(ts.body.data[0].sequence, 2);
  assert.equal(
    (await fileRequest('/timesheets?employeeId=' + who.id + '&year=2046')).body.pagination
      .totalItems,
    0,
  );
  assert.equal(sheets.body.data.created.length, 2);
  for (const q of [
    'from=2047-05-01',
    'uploadedFrom=2047-02-29',
    'uploadedFrom=0000-01-01',
    'uploadedFrom=2047-05-02&uploadedTo=2047-05-01',
    'page=0',
    'pageSize=101',
    'page=1&page=2',
    'employeeId=bad',
  ])
    assert.equal((await fileRequest('/documents?' + q)).status, 422, q);
  for (const body of [{}, { fileName: null }, { type: 'INTERNAL_POLICIES' }, { fileKey: 'x' }])
    assert.equal(
      (await request('/api/v1/documents/' + ids[0], { user: admin, method: 'PATCH', body })).status,
      422,
    );
});
function placeInput(p, changes = {}) {
  return {
    clientId: p.clientId,
    siteId: p.siteId,
    name: p.name,
    latitude: p.latitude,
    longitude: p.longitude,
    radiusMeters: p.radiusMeters,
    gpsAccuracyThreshold: p.gpsAccuracyThreshold,
    ...changes,
  };
}
function editPlace(p, changes) {
  return request('/api/v1/workplaces/' + p.id, {
    user: admin,
    method: 'PUT',
    body: placeInput(p, changes),
  });
}
async function waitingOn(table) {
  const rows =
    await db.$queryRaw`SELECT query FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE%'`;
  return rows.some((row) => row.query.includes('"' + table + '"'));
}
test('timesheet history freezes workplace client/province but permits equivalent UUIDs and ordinary edits', async () => {
  const p = await place();
  const who = await person();
  const destination = await place();
  await uploadTimesheets(who, p);
  const site2 = await db.site.findFirstOrThrow({ where: { id: { not: p.siteId } } });
  for (const change of [{ clientId: destination.clientId }, { siteId: site2.id }]) {
    const r = await editPlace(p, change);
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal(r.body.error.code, 'INVALID_WORKPLACE_DATA');
  }
  assert.equal(
    (
      await editPlace(p, {
        clientId: p.clientId.toUpperCase(),
        siteId: p.siteId.toUpperCase(),
        name: 'Nuevo ' + randomUUID(),
        radiusMeters: 200,
      })
    ).status,
    200,
  );
});
test('first upload holding Workplace prevents queued reassignment after its timesheet commits', async () => {
  const who = await person(),
    p = await place(),
    destination = await place();
  const before = uploads.length;
  holdPut = true;
  const uploading = uploadTimesheets(who, p);
  await until(async () => uploads.length > before && pendingPutResponses.length > 0);
  let moving;
  await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Client" WHERE id=${p.clientId}::uuid FOR UPDATE`;
      holdPut = false;
      for (const res of pendingPutResponses.splice(0))
        res.writeHead(200, { ETag: '"fake-etag"' }).end();
      await until(() => waitingOn('Client'));
      moving = editPlace(p, { clientId: destination.clientId });
      await until(() => waitingOn('Workplace'));
    },
    { timeout: 15000 },
  );
  assert.equal((await uploading).status, 201);
  assert.equal((await moving).status, 400);
});
test('reassignment holding Workplace commits before queued first upload and determines its provincial context', async () => {
  const who = await person(),
    p = await place(),
    destination = await place();
  const site2 = await db.site.findFirstOrThrow({ where: { id: { not: p.siteId } } });
  let moving, uploading;
  await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Client" WHERE id=${destination.clientId}::uuid FOR UPDATE`;
      moving = editPlace(p, { clientId: destination.clientId, siteId: site2.id });
      await until(() => waitingOn('Client'));
      uploading = uploadTimesheets(who, p);
      await until(() => waitingOn('Workplace'));
    },
    { timeout: 15000 },
  );
  assert.equal((await moving).status, 200);
  const uploaded = await uploading;
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  assert.equal(uploaded.body.data.created[0].site.id, site2.id);
  assert.equal(uploaded.body.data.created[0].client.id, destination.clientId);
});
test('uploads revalidate deactivation after bytes arrive and compensate without publishing metadata', async () => {
  for (const target of ['user', 'workplace', 'client']) {
    const who = await person(),
      p = await place(),
      before = uploads.length;
    holdPut = true;
    const uploading = uploadTimesheets(who, p);
    await until(async () => uploads.length > before && pendingPutResponses.length > 0);
    if (target === 'user')
      await db.user.update({ where: { id: who.id }, data: { accountStatus: 'INACTIVE' } });
    if (target === 'workplace')
      await db.workplace.update({ where: { id: p.id }, data: { status: 'INACTIVE' } });
    if (target === 'client')
      await db.client.update({ where: { id: p.clientId }, data: { status: 'INACTIVE' } });
    holdPut = false;
    for (const res of pendingPutResponses.splice(0))
      res.writeHead(200, { ETag: '"fake-etag"' }).end();
    const r = await uploading;
    assert.equal(
      r.status,
      target === 'user' ? 403 : target === 'client' ? 409 : 404,
      JSON.stringify(r.body),
    );
    assert.equal(await db.timesheet.count({ where: { employeeId: who.id } }), 0);
    await until(async () => !objects.has(uploads[before].key));
  }
});
test('late database failure rolls back the entire metadata batch and compensates every uploaded object', async () => {
  const who = await person(),
    p = await place(),
    before = uploads.length;
  const trigger = 'f007_atomic_' + randomUUID().replaceAll('-', '');
  await db.$executeRawUnsafe(
    `CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."employeeId"='${who.id}'::uuid THEN RAISE EXCEPTION 'F007 metadata failure'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER "${trigger}" AFTER INSERT ON "Timesheet" FOR EACH ROW EXECUTE FUNCTION "${trigger}"()`,
  );
  try {
    const r = await uploadTimesheets(who, p, [
      { name: 'one.txt', body: txt },
      { name: 'two.txt', body: txt },
    ]);
    assert.equal(r.status, 500);
    assert.equal(await db.timesheet.count({ where: { employeeId: who.id } }), 0);
    const attempted = uploads.slice(before).map((row) => row.key);
    assert.equal(attempted.length, 2);
    await until(async () => attempted.every((key) => !objects.has(key)));
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER "${trigger}" ON "Timesheet"`);
    await db.$executeRawUnsafe(`DROP FUNCTION "${trigger}"()`);
  }
});

test('publication checks lease against fresh time after waiting behind a cleanup lock and rollback', async () => {
  await stopApi();
  const { ConfigService } = require('@nestjs/config');
  const { R2StorageService } = require('../dist/modules/storage/r2-storage.service');
  const { StorageCleanupService } = require('../dist/modules/storage/storage-cleanup.service');
  const adapter = new R2StorageService(new ConfigService(env));
  const cleanup = new StorageCleanupService(db, adapter);
  const key = 'documents/lease-lock-' + randomUUID();
  const expiry = Date.now() + 500;
  uploads.push({ key });
  objects.set(key, { body: txt, contentType: 'text/plain' });
  await db.storageCleanupJob.create({
    data: { key, namespace: adapter.namespace, nextAttemptAt: new Date(expiry) },
  });
  let publication;
  try {
    await assert.rejects(
      db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "StorageCleanupJob" WHERE key=${key} FOR UPDATE`;
          publication = db
            .$transaction((pub) => cleanup.claimPublication(pub, [key]))
            .then(
              () => null,
              (error) => error,
            );
          await until(() => waitingOn('StorageCleanupJob'));
          await until(async () => Date.now() > expiry);
          await adapter.delete(key);
          throw new Error('deliberate worker rollback');
        },
        { timeout: 10000 },
      ),
      /deliberate worker rollback/,
    );
    const error = await publication;
    assert.equal(
      error?.getStatus(),
      503,
      'A transaction-start timestamp must not authorize an expired lease after lock wait',
    );
    assert.ok(!objects.has(key));
  } finally {
    adapter.onModuleDestroy();
    await startApi();
  }
});
test('filenames reject control characters even when trimming would otherwise remove them', async () => {
  for (const name of ['\nsecret.txt', 'secret.txt\n', 'a\u0085b.txt']) {
    const r = await uploadDocuments(await person(), {}, [{ name, body: txt }]);
    assert.equal(r.status, 422, JSON.stringify(r.body));
  }
});

test('malformed or aborted multipart requests leave no temporary directories or published files', async () => {
  const { readdir } = require('node:fs/promises');
  const { tmpdir } = require('node:os');
  const http = require('node:http');
  const folders = async () =>
    (await readdir(tmpdir())).filter((name) => name.startsWith('gdes-upload-'));
  const before = await folders();
  const uploadsBefore = uploads.length;
  const malformed = await fetch(base + '/api/v1/documents', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token(admin)}`,
      'Content-Type': 'multipart/form-data; boundary=broken',
    },
    body: '--broken\r\nContent-Disposition: form-data; name="files"; filename="x.txt"\r\n\r\nincomplete',
  });
  assert.equal(malformed.status, 422);
  await until(async () => (await folders()).length === before.length);
  const req = http.request(base + '/api/v1/documents', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token(admin)}`,
      'Content-Type': 'multipart/form-data; boundary=aborted',
      'Content-Length': 1000000,
    },
  });
  req.on('error', () => undefined);
  req.write(
    '--aborted\r\nContent-Disposition: form-data; name="files"; filename="x.txt"\r\nContent-Type: text/plain\r\n\r\n',
  );
  req.write(Buffer.alloc(10000, 0x61));
  await until(async () => (await folders()).length > before.length);
  req.destroy();
  await until(async () => (await folders()).length === before.length);
  assert.equal(uploads.length, uploadsBefore);
});

test('dashboard reflects timesheet status transitions and replacement while concurrent status invalidates stale replacement', async () => {
  const who = await person(),
    p = await place();
  const created = await uploadTimesheets(who, p, undefined, { month: 6, year: 2048 });
  const original = created.body.data.created[0];
  const metric = async () =>
    (await request('/api/v1/dashboard/metrics?month=6&year=2048', { user: admin })).body.data
      .pendingTimesheets;
  assert.equal(await metric(), 1);
  const before = uploads.length;
  holdPut = true;
  const pending = fileRequest('/timesheets/' + original.id + '/file', {
    method: 'PUT',
    body: form({ expectedVersion: 1 }, [{ name: 'stale.txt', body: txt }], 'file'),
  });
  await until(async () => uploads.length > before && pendingPutResponses.length > 0);
  const status = await request('/api/v1/timesheets/' + original.id + '/status', {
    user: admin,
    method: 'PATCH',
    body: { status: 'LOADED' },
  });
  assert.equal(status.status, 200);
  assert.equal(status.body.data.version, 2);
  assert.equal(await metric(), 0);
  holdPut = false;
  for (const res of pendingPutResponses.splice(0))
    res.writeHead(200, { ETag: '"fake-etag"' }).end();
  const stale = await pending;
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'FILE_VERSION_CONFLICT');
  assert.equal(await metric(), 0);
  const replaced = await fileRequest('/timesheets/' + original.id + '/file', {
    method: 'PUT',
    body: form({ expectedVersion: 2 }, undefined, 'file'),
  });
  assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
  assert.equal(replaced.body.data.version, 3);
  assert.equal(await metric(), 1);
});

test('SUPER_ADMIN manages files while unauthenticated and pending identities cannot access protected file routes', async () => {
  const root = await person('SUPER_ADMIN');
  const r = await fileRequest('/documents', {
    user: root,
    body: form({ employeeId: employee.id, type: 'DNI' }),
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.data.created[0].id;
  assert.equal((await fileRequest('/documents/' + id, { user: root })).status, 200);
  assert.equal((await fileRequest('/documents/' + id + '/file', { user: null })).status, 401);
  assert.equal(
    (await fileRequest('/documents/' + id, { user: await person('TO_BE_ADMIN') })).status,
    401,
  );
  assert.equal(
    (await fileRequest('/documents/' + id, { user: root, method: 'DELETE' })).status,
    204,
  );
});

test('Word XML parts accept valid UTF-16 encoding without relaxing TXT UTF-8 rules', async () => {
  const entries = docxEntries();
  entries[2].body = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(entries[2].body, 'utf16le'),
  ]);
  const r = await uploadDocuments(await person(), {}, [
    { name: 'utf16.docx', body: zipFixture(entries) },
  ]);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const text = await uploadDocuments(await person(), {}, [
    { name: 'utf16.txt', body: entries[2].body },
  ]);
  assert.equal(text.status, 422);
  assert.equal(text.body.error.code, 'FILE_TYPE_NOT_ALLOWED');
});
