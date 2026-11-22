// Opt-in Docker integration. Creates a NEW project/volumes and never resets a user DB.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { randomUUID, createHmac } = require('node:crypto');
const { createServer } = require('node:net');
const { PrismaClient } = require('@prisma/client');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const project = 'gdes-f010-' + randomUUID().slice(0, 8);
const directory = mkdtempSync(join(tmpdir(), project));
const file = join(directory, 'compose.json');
let db;
function docker(args, options = {}) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}
function compose(...args) {
  return docker(['compose', '-p', project, '-f', file, ...args]);
}
async function port() {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const p = server.address().port;
  await new Promise((r) => server.close(r));
  return p;
}
async function main() {
  const [apiPort, storagePort, databasePort] = await Promise.all([port(), port(), port()]);
  const config = JSON.parse(
    docker([
      'compose',
      '--env-file',
      '/dev/null',
      '-f',
      resolve('docker-compose.yml'),
      'config',
      '--format',
      'json',
    ]),
  );
  delete config.name;
  // Storage smoke uses log providers: do not start Mailpit or inherit its host
  // port/configuration from an operator's development environment.
  delete config.services.mailpit;
  delete config.services.api.depends_on.mailpit;
  delete config.volumes.mailpit_data;
  for (const service of Object.values(config.services)) delete service.container_name;
  config.services.postgres.ports = [`127.0.0.1:${databasePort}:5432`];
  config.services.postgres.environment.POSTGRES_DB = 'gdes_f003_test';
  config.services.postgres.healthcheck.test = ['CMD-SHELL', 'pg_isready -U gdes -d gdes_f003_test'];
  config.services.storage.ports = [`127.0.0.1:${storagePort}:8333`];
  config.services.api.ports = [`127.0.0.1:${apiPort}:3000`];
  // Use an independently built artifact; no source bind mounts or inherited node_modules.
  config.services.api.image = process.env.RUNTIME_TEST_IMAGE || 'gdes-f010-build:local';
  delete config.services.api.build;
  Object.assign(config.services.api.environment, {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://gdes:gdes@postgres:5432/gdes_f003_test',
    API_PUBLIC_URL: `http://127.0.0.1:${apiPort}`,
    ADMIN_FRONTEND_URL: 'http://localhost:5173',
    STORAGE_PUBLIC_ENDPOINT: `http://127.0.0.1:${storagePort}`,
    EMAIL_PROVIDER: 'log',
    WHATSAPP_PROVIDER: 'log',
  });
  // Compose normalizes names to the original project; remove them to isolate volumes/networks.
  for (const value of Object.values(config.volumes || {})) delete value.name;
  for (const value of Object.values(config.networks || {})) delete value.name;
  writeFileSync(file, JSON.stringify(config));
  console.log(`Starting isolated ${project}; postgres port ${databasePort}`);
  console.log(compose('up', '-d', '--wait', '--wait-timeout', '180'));
  console.log(
    compose('exec', '-T', 'api', 'env', 'NODE_ENV=production', 'npm', 'run', 'prisma:seed'),
  );
  db = new PrismaClient({
    datasources: { db: { url: `postgresql://gdes:gdes@127.0.0.1:${databasePort}/gdes_f003_test` } },
  });
  const base = `http://127.0.0.1:${apiPort}`;
  assert.equal((await fetch(base + '/health')).status, 200);
  const catalogs = await fetch(base + '/api/v1/catalogs');
  assert.equal(catalogs.status, 200);
  assert.equal((await catalogs.json()).data.sites.length, 6);
  assert.equal((await fetch(base + '/api/v1/sites')).status, 401);
  for (const origin of ['http://localhost:5173', 'https://evil.example']) {
    const response = await fetch(base + '/api/v1/sites', {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'X-CSRF-Token,Content-Type',
      },
    });
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    if (origin === 'http://localhost:5173') {
      assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
      assert.match(response.headers.get('access-control-allow-headers'), /X-CSRF-Token/i);
    } else assert.notEqual(response.headers.get('access-control-allow-origin'), origin);
  }
  const csrf = await fetch(base + '/api/v1/auth/web/csrf');
  assert.equal(csrf.status, 200);
  assert.match(csrf.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/i);
  const noCsrf = await fetch(base + '/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ client: 'ADMIN', identifier: 'test@example.com', password: 'unused' }),
  });
  assert.equal(noCsrf.status, 400);
  assert.equal(await db.user.count(), 0);
  const site = await db.site.findFirstOrThrow();
  const user = await db.user.create({
    data: {
      firstName: 'Runtime',
      lastName: 'Smoke',
      email: 'smoke@example.test',
      employeeId: 'smoke',
      dni: 'smoke',
      phone: '5491100000000',
      address: 'Test',
      birthDate: new Date('1990-01-01'),
      passwordHash: 'must-survive-restart',
      role: 'ADMIN',
      emailVerifiedAt: new Date(),
      siteId: site.id,
    },
  });
  const {
    id: ignoredId,
    createdAt: ignoredCreated,
    updatedAt: ignoredUpdated,
    ...employeeData
  } = user;
  const employee = await db.user.create({
    data: {
      ...employeeData,
      role: 'EMPLOYEE',
      email: 'employee@example.test',
      employeeId: 'smoke-employee',
      dni: 'smoke-employee',
    },
  });
  const session = await db.authSession.create({
    data: {
      userId: user.id,
      role: 'ADMIN',
      client: 'ADMIN',
      csrfSecret: randomUUID(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.id,
      role: user.role,
      type: 'access',
      sid: session.id,
      exp: Math.floor(Date.now() / 1000) + 1800,
    }),
  ).toString('base64url');
  const jwt = `${head}.${payload}.${createHmac('sha256', config.services.api.environment.JWT_ACCESS_SECRET).update(`${head}.${payload}`).digest('base64url')}`;
  const headers = { Authorization: 'Bearer ' + jwt };
  const customer = await db.client.create({ data: { name: 'Runtime customer' } });
  const workplace = await db.workplace.create({
    data: {
      name: 'Runtime workplace',
      clientId: customer.id,
      siteId: site.id,
      latitude: 0,
      longitude: 0,
      radiusMeters: 100,
    },
  });
  const bytes = Buffer.from('Archivo de integración S3 real.\n');
  function form(replace = false, contingency = false) {
    const f = new FormData();
    if (!replace) {
      f.set('employeeId', employee.id);
      f.set('workplaceId', contingency ? 'null' : workplace.id);
      f.set('month', '11');
      f.set('year', '2026');
    } else f.set('expectedVersion', '1');
    f.set(replace ? 'file' : 'files', new Blob([bytes]), 'smoke.txt');
    return f;
  }
  const upload = await fetch(base + '/api/v1/timesheets', {
    method: 'POST',
    headers,
    body: form(),
  });
  const uploaded = await upload.json();
  assert.equal(upload.status, 201, JSON.stringify(uploaded));
  const row = uploaded.data.created[0];
  const contingencyUpload = await fetch(base + '/api/v1/timesheets', {
    method: 'POST',
    headers,
    body: form(false, true),
  });
  const contingencyBody = await contingencyUpload.json();
  assert.equal(contingencyUpload.status, 201, JSON.stringify(contingencyBody));
  const contingency = contingencyBody.data.created[0];
  for (const key of ['workplace', 'client', 'site']) assert.equal(contingency[key], null);
  assert.equal(contingency.sequence, 1);
  assert.equal(row.sequence, 1);
  const targets = [row, contingency];
  const metrics = (
    await (await fetch(base + '/api/v1/dashboard/metrics?month=11&year=2026', { headers })).json()
  ).data;
  assert.equal(metrics.pendingTimesheets, 2);
  assert.equal(
    metrics.byProvince.reduce((sum, p) => sum + p.pendingTimesheets, 0),
    1,
  );
  async function download(target = row) {
    const detail = await fetch(base + '/api/v1/timesheets/' + target.id, { headers });
    assert.equal(detail.status, 200);
    assert.deepEqual((await detail.json()).data, target);
    const r = await fetch(base + '/api/v1/timesheets/' + target.id + '/file', { headers });
    assert.equal(r.status, 200);
    const data = (await r.json()).data;
    const url = new URL(data.downloadUrl);
    assert.equal(url.origin, `http://127.0.0.1:${storagePort}`);
    assert.equal(url.searchParams.get('X-Amz-Expires'), '900');
    const get = await fetch(url);
    assert.equal(get.status, 200);
    assert.deepEqual(Buffer.from(await get.arrayBuffer()), bytes);
    url.search = '';
    assert.equal((await fetch(url)).status, 403);
    return url;
  }
  const url = await download();
  await download(contingency);
  const client = new S3Client({
    endpoint: url.origin,
    forcePathStyle: true,
    region: 'us-east-1',
    credentials: {
      accessKeyId: 'dev-storage-access',
      secretAccessKey: 'dev-storage-secret-change-me',
    },
  });
  try {
    const expired = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: 'gdes-dev',
        Key: decodeURIComponent(url.pathname.slice('/gdes-dev/'.length)),
      }),
      { expiresIn: 1, signingDate: new Date(Date.now() - 60000) },
    );
    assert.equal((await fetch(expired)).status, 403);
  } finally {
    client.destroy();
  }
  const metadata = await Promise.all(
    targets.map((target) => db.timesheet.findUniqueOrThrow({ where: { id: target.id } })),
  );
  console.log(
    compose('up', '-d', '--force-recreate', '--wait', '--wait-timeout', '180', 'storage', 'api'),
  );
  for (const [index, target] of targets.entries()) {
    await download(target);
    assert.deepEqual(
      await db.timesheet.findUniqueOrThrow({ where: { id: target.id } }),
      metadata[index],
    );
  }
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash,
    'must-survive-restart',
  );
  console.log(compose('stop', 'storage'));
  for (const [index, target] of targets.entries()) {
    const replacement = await fetch(base + '/api/v1/timesheets/' + target.id + '/file', {
      method: 'PUT',
      headers,
      body: form(true),
    });
    const error = await replacement.json();
    assert.equal(replacement.status, 503, JSON.stringify(error));
    assert.equal(error.error.code, 'STORAGE_UNAVAILABLE');
    assert.equal(error.error.retryable, true);
    assert.deepEqual(
      await db.timesheet.findUniqueOrThrow({ where: { id: target.id } }),
      metadata[index],
    );
  }
  console.log(compose('up', '-d', 'storage'));
  console.log(compose('exec', '-T', 'api', 'node', 'scripts/storage-ready.cjs'));
  for (const target of targets) await download(target);
  console.log(
    'PASS: health/catalog/guard/CORS/cookies/CSRF, real SDK upload+signed bytes, anonymous+expired403, ordinary+contingency null/global metrics, recreation persistence, failed replacement503 preserves both originals. HTTP only; browser/Android pending.',
  );
  if (process.env.RUNTIME_RUN_REGRESSIONS === 'true') {
    console.log(compose('stop', 'api'));
    console.log(
      compose(
        'run',
        '--rm',
        '--no-deps',
        'api',
        'env',
        'NODE_ENV=test',
        'LOCAL_SEED_PASSWORD=f013-test-fixture',
        'npm',
        'run',
        'prisma:seed',
      ),
    );
    console.log('Running full serial regression suite against this exclusive database');
    execFileSync(
      process.execPath,
      [
        '--test',
        '--test-concurrency=1',
        ...require('node:fs')
          .readdirSync('test')
          .filter((n) => n.endsWith('.e2e.cjs'))
          .map((n) => 'test/' + n),
      ],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          TEST_DATABASE_URL: `postgresql://gdes:gdes@127.0.0.1:${databasePort}/gdes_f003_test`,
        },
      },
    );
  }
}
main()
  .catch((error) => {
    console.error(error.stack || error);
    if (error.stderr) console.error(String(error.stderr));
    try {
      console.error(compose('logs', '--tail', '60'));
    } catch {}
    process.exitCode = 1;
  })
  .finally(async () => {
    await db?.$disconnect();
    try {
      console.log(compose('down', '-v', '--remove-orphans'));
    } catch (error) {
      console.error('Cleanup failed:', error.message);
      process.exitCode = 1;
    }
    rmSync(directory, { recursive: true, force: true });
  });
