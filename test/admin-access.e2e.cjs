const { acquireAuthSuiteMutex } = require('./auth-suite-mutex.cjs');
require('reflect-metadata');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID, createHmac } = require('node:crypto');
const { NestFactory } = require('@nestjs/core');
const { PrismaClient, Prisma } = require('@prisma/client');
const argon2 = require('argon2');

assert.match(process.env.TEST_DATABASE_URL || '', /\/gdes_f003_test(?:\?|$)/);
const example = Object.fromEntries(readFileSync('.env.example', 'utf8').split('\n')
  .filter((line) => line && !line.startsWith('#')).map((line) => {
    const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];
  }));
Object.assign(process.env, example, {
  DATABASE_URL: process.env.TEST_DATABASE_URL, NODE_ENV: 'test',
  EMAIL_PROVIDER: 'log', WHATSAPP_PROVIDER: 'log', API_PUBLIC_URL: 'http://localhost:3000',
  JWT_ACCESS_SECRET: 'f008c-test-access', JWT_REFRESH_SECRET: 'f008c-test-refresh',
});
const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const run = randomUUID(), password = 'nubes de lapacho sobre la sierra';
const owned = [], profiles = [], emails = [], acceptedEmails = [], otps = [];
let serial = Math.floor(Math.random() * 100000), app, base, site, root;
let failEmail = () => false;
let releaseAuthTestLock;
function profile(overrides = {}) {
  serial++;
  const value = { firstName: 'Rocío', lastName: 'Pérez', email: `f008c-${run}-${serial}@example.com`,
    password, phone: '5493511234567', dni: String(20000000 + serial), employeeId: `f008c-${run}-${serial}`,
    address: 'Camino del monte 42', siteId: site.id, birthDate: '1990-01-01', ...overrides };
  profiles.push(value); return value;
}
async function fixture(overrides = {}, secret = password) {
  const input = profile(); const { password: ignored, ...data } = input;
  const user = await db.user.create({ data: { ...data, birthDate: new Date(data.birthDate),
    passwordHash: await argon2.hash(secret), role: 'EMPLOYEE', emailVerifiedAt: new Date(), ...overrides } });
  owned.push(user.id); return { user, input: { ...input, password: secret } };
}
async function session(user, client = user.role === 'EMPLOYEE' ? 'MOBILE' : 'ADMIN') {
  const row = await db.authSession.create({ data: { userId: user.id, role: user.role, client, csrfSecret: randomUUID(), expiresAt: new Date(Date.now() + 604800000) } });
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ sub: user.id, role: user.role, sid: row.id, type: 'access', exp: Math.floor(Date.now()/1000)+1800 })).toString('base64url');
  return { row, accessToken: `${h}.${p}.${createHmac('sha256', process.env.JWT_ACCESS_SECRET).update(`${h}.${p}`).digest('base64url')}` };
}
async function http(path, { body, method = body === undefined ? 'GET' : 'POST', jwt } = {}) {
  const response = await fetch(base + path, { method, redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, headers: response.headers,
    body: response.status === 204 ? null : await response.json() };
}
function keys(value, expected) { assert.deepEqual(Object.keys(value).sort(), expected.sort()); }
function error(response, status, code) {
  assert.equal(response.status, status, JSON.stringify(response.body));
  assert.equal(response.body.error.code, code);
  assert.equal(response.headers.get('cache-control'), 'no-store');
}
async function until(check) {
  const end = Date.now() + 5000;
  while (Date.now() < end) { if (await check()) return; await new Promise((r) => setTimeout(r, 10)); }
  assert.fail('Expected durable notification or PostgreSQL lock condition');
}
function codeFor(email) {
  const message = emails.findLast((item) => item.to.toLowerCase() === email.toLowerCase() && /(?<!\d)\d{6}(?!\d)/.test(item.html));
  assert.ok(message, 'fake EmailProvider captures an OTP');
  return /(?<!\d)\d{6}(?!\d)/.exec(message.html)[0];
}
function decisionLinks(email = root.email, applicantEmail, excludedToken) {
  const message = acceptedEmails.findLast((item) => item.to === email && item.html.includes('/admin-access/confirm') && (!applicantEmail || item.html.includes(applicantEmail)) && (!excludedToken || !item.html.includes(excludedToken)));
  assert.ok(message, 'active SuperAdmin receives explicit frontend decision links');
  const links = [...message.html.matchAll(/href=["']([^"']+)["']/g)].map((match) => new URL(match[1].replaceAll('&amp;', '&')))
    .filter((url) => url.pathname === '/admin-access/confirm');
  assert.equal(links.length, 2);
  for (const url of links) { assert.equal(url.origin, new URL(process.env.ADMIN_FRONTEND_URL).origin); assert.ok(url.searchParams.get('token')); }
  assert.deepEqual(links.map((url) => url.searchParams.get('decision')).sort(), ['APPROVE', 'REJECT']);
  assert.equal(links[0].searchParams.get('token'), links[1].searchParams.get('token'));
  return { links, token: links[0].searchParams.get('token'), message };
}
async function start(input = profile()) {
  const result = await http('/auth/admin-access-request', { body: input });
  assert.equal(result.status, 202, JSON.stringify(result.body)); keys(result.body, ['data']);
  keys(result.body.data, ['challengeId', 'expiresAt', 'resendAvailableAt', 'message']);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  return { ...result.body.data, code: codeFor(input.email), input };
}
async function verify(challenge, code = challenge.code) {
  return http('/auth/admin-access-request/verify', { body: { challengeId: challenge.challengeId, code } });
}
function submitted(result) {
  assert.equal(result.status, 202, JSON.stringify(result.body)); keys(result.body.data, ['status', 'message']);
  assert.equal(result.body.data.status, 'PENDING'); assert.equal(result.headers.get('cache-control'), 'no-store');
}
async function pending(input = profile()) {
  const challenge = await start(input); submitted(await verify(challenge));
  const user = await db.user.findUniqueOrThrow({ where: { email: input.email.toLowerCase() } });
  if (!owned.includes(user.id)) owned.push(user.id);
  const request = await db.adminAccessRequest.findFirstOrThrow({ where: { userId: user.id, cancelledAt: null } });
  await until(async () => acceptedEmails.some((item) => item.to === root.email && item.html.includes('/admin-access/confirm') && item.html.includes(input.email)));
  await until(async () => !await db.adminAccessNotification.count({where:{requestId:request.id,completedAt:null}}));
  return { challenge, user, request, ...decisionLinks(root.email,input.email) };
}
async function confirm(token, decision) { return http('/auth/admin-access/confirm', { body: { token, decision } }); }
function setOtpExpiry(id, time) { return db.adminAccessChallenge.update({ where: { id }, data: { expiresAt: time } }); }
function ageChallenge(id, time) { return db.adminAccessChallenge.update({ where: { id }, data: { createdAt: time } }); }
function expireDecision(id, time = new Date(0)) { return db.adminAccessRequest.update({ where: { id }, data: { decisionExpiresAt: time } }); }
async function waitingOn(table) {
  const rows = await db.$queryRaw`SELECT query FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE%'`;
  return rows.some((row) => row.query.includes('"' + table + '"'));
}
async function persistedAdminRows(match) {
  const models = Prisma.dmmf.datamodel.models.filter((model) => /AdminAccess|AdminNotification/.test(model.name));
  const values = [];
  for (const model of models) {
    const table = model.dbName || model.name; assert.match(table, /^[A-Za-z_][A-Za-z0-9_]*$/);
    values.push(...await db.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS row FROM "${table}" t WHERE to_jsonb(t)::text LIKE $1`, `%${match}%`));
  }
  return JSON.stringify(values);
}
async function boot() {
  const { AppModule } = require('../dist/app.module');
  const { EmailProvider, WhatsAppProvider } = require('../dist/modules/notifications/notifications.service');
  app = await NestFactory.create(AppModule, { logger: false }); app.setGlobalPrefix('api/v1');
  app.use((req, res, next) => { if (req.path.startsWith('/api/v1/auth/')) res.setHeader('Cache-Control', 'no-store'); next(); });
  app.get(EmailProvider).sendEmail = async (input) => {
    emails.push(structuredClone(input));
    if (failEmail(input)) { const { ApiException } = require('../dist/common/errors/api.exception'); throw new ApiException(503, 'NOTIFICATION_UNAVAILABLE', 'No se pudo enviar la notificación'); }
    acceptedEmails.push(structuredClone(input));
  };
  app.get(WhatsAppProvider).sendOtp = async (input) => otps.push(structuredClone(input));
  await app.listen(0, '127.0.0.1'); base = await app.getUrl() + '/api/v1';
}
before(async () => {
  releaseAuthTestLock = await acquireAuthSuiteMutex(process.env.TEST_DATABASE_URL);
  await boot(); site = await db.site.findFirstOrThrow();
  root = (await fixture({ role: 'SUPER_ADMIN' })).user;
});
beforeEach(async () => { failEmail = () => false; await db.authRateLimit.deleteMany(); });
after(async () => {
  if (app) await app.close();
  // Align table-specific C cleanup after schema is designed; no reset/global delete.
  if (db.adminAccessNotification) await db.adminAccessNotification.deleteMany({ where: { request: { userId: { in: owned } } } });
  if (db.adminAccessRequest) await db.adminAccessRequest.deleteMany({ where: { userId: { in: owned } } });
  if (db.adminAccessChallenge) await db.adminAccessChallenge.deleteMany({ where: { identityHash: { in: profiles.map((value) => createHmac('sha256', process.env.JWT_REFRESH_SECRET).update('admin-request:'+value.email.toLowerCase()).digest('hex')) } } });
  await db.user.deleteMany({ where: { id: { in: owned } } }); await db.$disconnect();
  if (releaseAuthTestLock) await releaseAuthTestLock();
});

test('initial ten-field requests remain neutral and cannot create accounts or change roles before email OTP', async () => {
  const existing = await fixture(), admin = await fixture({ role: 'ADMIN' }), inactive = await fixture({ accountStatus: 'INACTIVE' });
  const fresh = profile(); let neutral;
  for (const input of [fresh, existing.input, admin.input, inactive.input, { ...existing.input, password: 'incorrect' }]) {
    const challenge = await start(input);
    neutral ??= challenge.message; assert.equal(challenge.message, neutral);
    assert.ok(Date.parse(challenge.expiresAt) <= Date.now() + 600000 && Date.parse(challenge.expiresAt) >= Date.now() + 599000);
    assert.ok(Date.parse(challenge.resendAvailableAt) <= Date.now() + 60000);
  }
  assert.equal(await db.user.count({ where: { email: fresh.email } }), 0);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: existing.user.id } })).role, 'EMPLOYEE');
  assert.equal(await db.adminAccessRequest.count({ where: { userId: existing.user.id } }), 0);
});
test('legacy existing secrets and weak new secrets share the same initial response but only existing identity can use legacy password', async () => {
  const existing = await fixture({}, 'legacy pass');
  const old = await start(existing.input), fresh = await start(profile({ password: 'legacy pass' }));
  assert.equal(old.message, fresh.message); submitted(await verify(old));
  error(await verify(fresh), 422, 'VALIDATION_ERROR');
  const before = existing.user; const after = await db.user.findUniqueOrThrow({ where: { id: before.id } });
  assert.equal(after.passwordHash, before.passwordHash); assert.equal(after.role, 'TO_BE_ADMIN');
});
test('new verified applicants become TO_BE_ADMIN without JWT and use one signed seven-day decision capability', async () => {
  const input = profile({ firstName: '<b>Rocío</b>' }); const initial = await start(input);
  const row = await db.adminAccessChallenge.findUniqueOrThrow({ where: { id: initial.challengeId } });
  assert.ok(!JSON.stringify(row).includes(password)); assert.ok(!JSON.stringify(row).includes(initial.code));
  const result = await verify(initial); submitted(result);
  const user = await db.user.findUniqueOrThrow({ where: { email: input.email } }); owned.push(user.id);
  assert.equal(user.role, 'TO_BE_ADMIN'); assert.equal(user.accountStatus, 'ACTIVE'); assert.ok(user.emailVerifiedAt);
  assert.ok(await argon2.verify(user.passwordHash, password));
  await until(async () => acceptedEmails.some(item=>item.html.includes(input.email)&&item.html.includes('/admin-access/confirm')));
  const { token, message, links } = decisionLinks(root.email,input.email); const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
  assert.equal(claims.exp - claims.iat, 604800); assert.ok(!message.html.includes('<b>Rocío</b>')); assert.match(message.html, /&lt;b&gt;/);
  const request = await db.adminAccessRequest.findFirstOrThrow({ where: { userId: user.id } });
  assert.ok(!(await persistedAdminRows(request.id)).includes(token));
  assert.ok(!JSON.stringify(result.body).includes(token));
  for (const url of links) assert.equal(url.origin, new URL(process.env.ADMIN_FRONTEND_URL).origin);
  assert.equal((await http('/auth/admin-access/confirm?token=' + encodeURIComponent(token) + '&decision=APPROVE')).status, 404);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).role, 'TO_BE_ADMIN');
});
test('existing profiles/passwords stay intact, mismatches are warned only after OTP and role transition revokes current sessions', async () => {
  const existing = await fixture({ emailVerifiedAt: null }); const before = existing.user;
  const active = await session(before);
  const challenge = await start({ ...existing.input, firstName: 'Otro', phone: '5493511111111', address: 'Otra calle' });
  const result = await verify(challenge); submitted(result); assert.match(result.body.data.message, /perfil|datos|conserv/i);
  const after = await db.user.findUniqueOrThrow({ where: { id: before.id } });
  for (const field of ['firstName','lastName','phone','address','birthDate','siteId','passwordHash','dni','employeeId']) assert.deepEqual(after[field], before[field]);
  assert.ok(after.emailVerifiedAt); assert.equal(after.role, 'TO_BE_ADMIN');
  assert.ok((await db.authSession.findUniqueOrThrow({ where: { id: active.row.id } })).revokedAt);
  assert.equal((await http('/profile', { jwt: active.accessToken })).status, 401);
  assert.equal(await db.user.count({ where: { id: before.id } }), 1);
});
test('existing verified timestamps remain unchanged, and rejected applicants keep the email proof without another magic link', async () => {
  const verifiedAt = new Date('2020-01-01T00:00:00Z'); const existing = await fixture({ emailVerifiedAt: verifiedAt });
  const state = await pending(existing.input); const response = await confirm(state.token, 'REJECT');
  assert.deepEqual(response.body, { data: { decision: 'REJECTED' } });
  const user = await db.user.findUniqueOrThrow({ where: { id: existing.user.id } });
  assert.equal(user.role, 'EMPLOYEE'); assert.deepEqual(user.emailVerifiedAt, verifiedAt);
  assert.ok(!acceptedEmails.some((item) => item.to === user.email && /auth\/email\/verify/.test(item.html)));
});
test('OTP possession gates identity conflicts, inactive/admin eligibility and wrong current password errors', async () => {
  const one = await fixture(), two = await fixture();
  const rows = [
    { input: { ...one.input, dni: two.user.dni }, status: 409, code: 'ADMIN_REQUEST_IDENTITY_CONFLICT' },
    { input: (await fixture({ accountStatus: 'INACTIVE' })).input, status: 403, code: 'ADMIN_REQUEST_NOT_ELIGIBLE' },
    { input: (await fixture({ role: 'ADMIN' })).input, status: 403, code: 'ADMIN_REQUEST_NOT_ELIGIBLE' },
    { input: (await fixture({ role: 'SUPER_ADMIN' })).input, status: 403, code: 'ADMIN_REQUEST_NOT_ELIGIBLE' },
    { input: { ...one.input, password: 'wrong' }, status: 401, code: 'INVALID_CREDENTIALS' },
  ];
  for (const item of rows) { const challenge = await start(item.input); error(await verify(challenge), item.status, item.code); }
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: one.user.id } })).role, 'EMPLOYEE');
});
test('a password, identity, role or status changed after challenge invalidates stale authorization', async () => {
  for (const update of [{ passwordHash: await argon2.hash('newly changed secret') }, { employeeId: randomUUID() }, { role: 'ADMIN' }, { accountStatus: 'INACTIVE' }]) {
    const existing = await fixture(); const challenge = await start(existing.input);
    await db.user.update({ where: { id: existing.user.id }, data: update });
    const response = await verify(challenge); assert.ok(response.status >= 400 && response.status < 500, JSON.stringify(response.body));
    const user = await db.user.findUniqueOrThrow({ where: { id: existing.user.id } });
    if (update.role) assert.equal(user.role, update.role); else assert.equal(user.role, 'EMPLOYEE');
  }
});
test('pending verification replays require the original code and never duplicate request, token or emails', async () => {
  const state = await pending(); const before = acceptedEmails.length;
  const replay = await verify(state.challenge); submitted(replay);
  assert.equal(await db.adminAccessRequest.count({ where: { userId: state.user.id } }), 1); assert.equal(acceptedEmails.length, before);
  error(await verify(state.challenge, state.challenge.code === '000000' ? '000001' : '000000'), 401, 'INVALID_OTP');
  const fresh = await start(state.challenge.input); submitted(await verify(fresh));
  assert.equal(await db.adminAccessRequest.count({ where: { userId: state.user.id } }), 1);
  assert.equal(decisionLinks().token, state.token);
});
test('OTP failures persist, resend invalidates old code, cooldown applies and retention never extends past original 72h', async () => {
  const challenge = await start();
  error(await http('/auth/admin-access-request/resend', { body: { challengeId: challenge.challengeId } }), 429, 'OTP_RESEND_COOLDOWN');
  for (let i=0;i<5;i++) error(await verify(challenge, challenge.code === '000000' ? '000001' : '000000'), i===4 ? 429 : 401, i===4 ? 'TOO_MANY_ATTEMPTS' : 'INVALID_OTP');
  const expiring = await start(); await setOtpExpiry(expiring.challengeId, new Date(0)); error(await verify(expiring), 410, 'OTP_EXPIRED');
  const old = await start(); await ageChallenge(old.challengeId, new Date(Date.now()-73*3600000));
  const resend = await http('/auth/admin-access-request/resend', { body: { challengeId: old.challengeId } }); assert.ok(resend.status >= 400 && resend.status < 500);
  const retained = await db.adminAccessChallenge.findUnique({ where: { id: old.challengeId } });
  assert.ok(!retained || !retained.payload, 'expired retained payload is erased rather than renewed');
});
test('OTP expiry is rechecked after waiting on the existing user lock without consuming or changing role', async () => {
  const existing = await fixture(); const challenge = await start(existing.input); let checking;
  const expires = Date.now() + 2000; await setOtpExpiry(challenge.challengeId, new Date(expires));
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${existing.user.id}::uuid FOR UPDATE`;
    checking = verify(challenge); await until(() => waitingOn('User'));
    await until(async () => Date.now() >= expires);
  }, { timeout: 10000 });
  error(await checking, 410, 'OTP_EXPIRED');
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: existing.user.id } })).role, 'EMPLOYEE');
});
test('opposing decisions have one winner and a consumed/cancelled decision never changes role again', async () => {
  const state = await pending(); const results = await Promise.all([confirm(state.token, 'APPROVE'), confirm(state.token, 'REJECT')]);
  assert.deepEqual(results.map((item)=>item.status).sort(), [200,409]);
  const winner = results.find((item)=>item.status===200); keys(winner.body.data, ['decision']);
  const user = await db.user.findUniqueOrThrow({ where: { id: state.user.id } });
  assert.equal(user.role, winner.body.data.decision === 'APPROVED' ? 'ADMIN' : 'EMPLOYEE');
  error(await confirm(state.token, 'APPROVE'), 409, 'REQUEST_ALREADY_DECIDED');
  error(await verify(state.challenge), 409, 'REQUEST_ALREADY_DECIDED');
});
test('direct SQL deactivation cancels pending requests atomically and reactivation cannot revive their capability', async () => {
  const state = await pending();
  await db.$executeRaw`UPDATE "User" SET "accountStatus"='INACTIVE' WHERE id=${state.user.id}::uuid`;
  const cancelled = await db.adminAccessRequest.findUniqueOrThrow({ where: { id: state.request.id } });
  assert.ok(cancelled.cancelledAt); assert.equal(cancelled.status, 'PENDING');
  await db.user.update({ where: { id: state.user.id }, data: { accountStatus: 'ACTIVE' } });
  error(await confirm(state.token, 'APPROVE'), 409, 'REQUEST_ALREADY_DECIDED');
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: state.user.id } })).role, 'TO_BE_ADMIN');
  const adminSession = await session(root);
  const result = await http('/users/' + state.user.id + '/account-status', { method: 'PATCH', jwt: adminSession.accessToken, body: { accountStatus: 'INACTIVE' } });
  assert.equal(result.status,404); assert.equal(result.body.error.code,'USER_NOT_FOUND');
});
test('public confirmation validates purpose, expiry and decision without adding JWT or GET side effects', async () => {
  const state = await pending();
  error(await confirm('not-a-token', 'APPROVE'), 401, 'INVALID_TOKEN');
  error(await confirm(state.token, 'INVALID'), 422, 'VALIDATION_ERROR');
  await expireDecision(state.request.id); error(await confirm(state.token, 'APPROVE'), 410, 'TOKEN_EXPIRED');
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: state.user.id } })).role, 'TO_BE_ADMIN');
});
test('a fresh email OTP renews only expired pending links, preserving request identity and replacing the signed generation', async () => {
  const state = await pending(); await expireDecision(state.request.id);
  const before = await db.adminAccessRequest.findUniqueOrThrow({ where: { id: state.request.id } });
  // Old consumed challenge cannot refresh its previous grant.
  await verify(state.challenge);
  assert.deepEqual((await db.adminAccessRequest.findUniqueOrThrow({ where: { id: state.request.id } })).decisionExpiresAt, before.decisionExpiresAt);
  const fresh = await start(state.challenge.input); submitted(await verify(fresh));
  const after = await db.adminAccessRequest.findUniqueOrThrow({ where: { id: state.request.id } });
  assert.equal(after.id, before.id); assert.equal(await db.adminAccessRequest.count({ where: { userId: state.user.id } }), 1);
  assert.equal(after.decisionGeneration, before.decisionGeneration+1);
  assert.ok(after.decisionExpiresAt.getTime() >= Date.now()+604799000);
  await until(async()=>acceptedEmails.some(item=>item.to===root.email&&item.html.includes(state.user.email)&&item.html.includes('/admin-access/confirm')&&!item.html.includes(state.token)));
  const renewed = decisionLinks(root.email,state.user.email,state.token).token; assert.notEqual(renewed, state.token);
  assert.ok((await confirm(state.token, 'APPROVE')).status >= 400);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: state.user.id } })).role, 'TO_BE_ADMIN');
});
test('renewal races create one winning generation and active pending links do not produce duplicate decision mail', async () => {
  const state = await pending(); await expireDecision(state.request.id);
  const before = await db.adminAccessRequest.findUniqueOrThrow({ where: { id: state.request.id } });
  const first = await start(state.challenge.input), second = await start(state.challenge.input);
  const results = await Promise.all([verify(first),verify(second)]); results.forEach(submitted);
  const after = await db.adminAccessRequest.findUniqueOrThrow({ where: { id: state.request.id } }); assert.equal(after.decisionGeneration, before.decisionGeneration+1);
  await until(async()=>!await db.adminAccessNotification.count({where:{requestId:state.request.id,completedAt:null}}));
  const mails = acceptedEmails.filter((item)=>item.to===root.email && item.html.includes('/admin-access/confirm'));
  const count = mails.length; const fresh = await start(state.challenge.input); submitted(await verify(fresh));
  assert.equal(acceptedEmails.filter((item)=>item.to===root.email && item.html.includes('/admin-access/confirm')).length, count);
});
test('postcommit provider failure retains notification intent and retries reconstruct identical tokens and idempotency keys after restart', async () => {
  const value = profile(); const initial = await start(value);
  failEmail = (item) => item.html.includes('/admin-access/confirm');
  const result = await verify(initial); assert.ok(result.status===202 || result.status===503, JSON.stringify(result.body));
  const user = await db.user.findUniqueOrThrow({ where: { email: value.email } }); owned.push(user.id);
  const row = await db.adminAccessRequest.findFirstOrThrow({ where: { userId: user.id } });
  await until(async()=>emails.some(item=>item.to===root.email && item.html.includes(value.email)&&item.html.includes('/admin-access/confirm')));
  const failed = emails.findLast((item)=>item.to===root.email && item.html.includes(value.email)&&item.html.includes('/admin-access/confirm')); assert.ok(failed);
  const token = /[?&]token=([^&"']+)/.exec(failed.html.replaceAll('&amp;','&'))?.[1];
  assert.ok(token); assert.ok(!(await persistedAdminRows(row.id)).includes(decodeURIComponent(token)));
  failEmail = () => false; await app.close(); await boot();
  // Advance the run-owned notification nextAttemptAt via C's model once finalized,
  // without clearing all notifications or mocking production time.
  await until(async()=>acceptedEmails.some((item)=>item.idempotencyKey===failed.idempotencyKey && item.html===failed.html));
  submitted(await verify(initial)); assert.equal(await db.adminAccessRequest.count({where:{userId:user.id}}),1);
});

test('new OTP permits reapplication after rejection or cancellation while preserving old immutable history', async () => {
  for (const cancelled of [false,true]) {
    const state=await pending();
    if(cancelled) {
      await db.user.update({where:{id:state.user.id},data:{accountStatus:'INACTIVE'}});
      await db.user.update({where:{id:state.user.id},data:{accountStatus:'ACTIVE'}});
    } else assert.equal((await confirm(state.token,'REJECT')).status,200);
    const historical=await db.adminAccessRequest.findUniqueOrThrow({where:{id:state.request.id}});
    error(await verify(state.challenge),409,'REQUEST_ALREADY_DECIDED');
    const fresh=await start(state.challenge.input);submitted(await verify(fresh));
    const rows=await db.adminAccessRequest.findMany({where:{userId:state.user.id},orderBy:{createdAt:'asc'}});
    assert.equal(rows.length,2);assert.deepEqual(rows[0],historical);assert.notEqual(rows[1].id,historical.id);
    assert.equal(rows[1].status,'PENDING');assert.equal(rows[1].cancelledAt,null);
    error(await confirm(state.token,'APPROVE'),409,'REQUEST_ALREADY_DECIDED');
    assert.equal((await db.user.findUniqueOrThrow({where:{id:state.user.id}})).role,'TO_BE_ADMIN');
  }
});
test('parallel fresh proofs after rejection create one pending request and one logical generation of notifications', async()=>{
  const state=await pending();assert.equal((await confirm(state.token,'REJECT')).status,200);
  const first=await start(state.challenge.input),second=await start(state.challenge.input);
  const results=await Promise.all([verify(first),verify(second)]);
  assert.equal(results.filter(r=>r.status===202).length,1);error(results.find(r=>r.status!==202),401,'INVALID_CREDENTIALS');
  const rows=await db.adminAccessRequest.findMany({where:{userId:state.user.id,status:'PENDING',cancelledAt:null}});assert.equal(rows.length,1);
  assert.equal(await db.adminAccessNotification.count({where:{requestId:rows[0].id,kind:'DECISION',recipientId:root.id}}),1);
});
test('resend rotates code with full DTO and bounded expiry without restoring a stale identity proof',async()=>{
  const existing=await fixture();const c=await start(existing.input);
  await db.adminAccessChallenge.update({where:{id:c.challengeId},data:{sentAt:new Date(Date.now()-61000),createdAt:new Date(Date.now()-72*3600000+300000)}});
  const response=await http('/auth/admin-access-request/resend',{body:{challengeId:c.challengeId}});assert.equal(response.status,202);
  keys(response.body.data,['challengeId','expiresAt','resendAvailableAt','message']);
  const row=await db.adminAccessChallenge.findUniqueOrThrow({where:{id:c.challengeId}});
  assert.ok(row.expiresAt.getTime()<=row.createdAt.getTime()+72*3600000);
  const latest=codeFor(existing.input.email);assert.notEqual(latest,c.code);
  error(await verify(c),401,'INVALID_OTP');
  await db.user.update({where:{id:existing.user.id},data:{passwordHash:await argon2.hash('a replacement current secret')}});
  error(await verify(c,latest),401,'INVALID_CREDENTIALS');
});
test('verification budget survives fresh challenges and a wrong code cannot mask OTP expiration',async()=>{
  const input=profile();
  for(let n=0;n<4;n++) {const c=await start(input);for(let i=0;i<5;i++)await verify(c,c.code==='000000'?'000001':'000000');}
  const last=await start(input);error(await verify(last),429,'TOO_MANY_ATTEMPTS');
  await db.authRateLimit.deleteMany();
  const expired=await start();await setOtpExpiry(expired.challengeId,new Date(0));
  error(await verify(expired,expired.code==='000000'?'000001':'000000'),410,'OTP_EXPIRED');
});
test('confirmation rechecks expiration after waiting on User and cannot overwrite an externally changed role',async()=>{
  const state=await pending();const ends=Date.now()+1500;await expireDecision(state.request.id,new Date(ends));let checking;
  await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${state.user.id}::uuid FOR UPDATE`;
    checking=confirm(state.token,'APPROVE');await until(()=>waitingOn('User'));await until(async()=>Date.now()>=ends);
  },{timeout:10000});error(await checking,410,'TOKEN_EXPIRED');
  const another=await pending();await db.user.update({where:{id:another.user.id},data:{role:'SUPER_ADMIN'}});
  error(await confirm(another.token,'REJECT'),403,'ADMIN_REQUEST_NOT_ELIGIBLE');
  assert.equal((await db.user.findUniqueOrThrow({where:{id:another.user.id}})).role,'SUPER_ADMIN');
});
test('expired outbox is bounded to the provider idempotency window and purged without sending after downtime',async()=>{
  const state=await pending();
  const row=await db.adminAccessNotification.findFirstOrThrow({where:{requestId:state.request.id,kind:'DECISION'}});
  assert.ok(row.expiresAt.getTime()<=row.createdAt.getTime()+86400000+1000);
  const {AdminAccessNotificationsService}=require('../dist/modules/auth/admin-access-notifications.service');
  const worker=app.get(AdminAccessNotificationsService);await worker.onModuleDestroy();
  const count=emails.length;
  await db.adminAccessNotification.update({where:{id:row.id},data:{completedAt:null,acceptedAt:null,expiresAt:new Date(0),attempts:0,lockedUntil:null}});
  await worker.drain();assert.equal(emails.length,count);assert.equal(await db.adminAccessNotification.findUnique({where:{id:row.id}}),null);
  worker.onModuleInit();
});
test('outbox workers isolate namespaces and stale claims cannot overwrite acceptance or change token/body/key',async()=>{
  const state=await pending();
  const {AdminAccessNotificationsService}=require('../dist/modules/auth/admin-access-notifications.service');
  const {AdminDecisionTokensService}=require('../dist/modules/auth/admin-decision-tokens.service');
  const {ConfigService}=require('@nestjs/config');const {EmailProvider}=require('../dist/modules/notifications/notifications.service');
  const original=app.get(AdminAccessNotificationsService);await original.onModuleDestroy();
  const tokens=app.get(AdminDecisionTokensService),config=app.get(ConfigService),provider=app.get(EmailProvider);
  const row=await db.adminAccessNotification.findFirstOrThrow({where:{requestId:state.request.id,recipientId:root.id,kind:'DECISION'}});
  await db.adminAccessNotification.update({where:{id:row.id},data:{completedAt:null,acceptedAt:null,attempts:0,lockedUntil:null,nextAttemptAt:new Date(0)}});
  const alien=new AdminAccessNotificationsService(db,new ConfigService({...process.env,JWT_REFRESH_SECRET:'different-signing-namespace'}),provider,tokens);
  await alien.drain();assert.equal((await db.adminAccessNotification.findUniqueOrThrow({where:{id:row.id}})).attempts,0);
  const worker=new AdminAccessNotificationsService(db,config,provider,tokens);
  let unblock,entered;const enteredPromise=new Promise(r=>entered=r),blocked=new Promise(r=>unblock=r);
  const sign=tokens.sign.bind(tokens);let calls=0;
  tokens.sign=async meta=>{if(meta.requestId===state.request.id&&calls++===0){entered();await blocked;}return sign(meta);};
  const old=original.drain();await enteredPromise;
  await db.adminAccessNotification.update({where:{id:row.id},data:{lockedUntil:new Date(0)}});
  const baseline=acceptedEmails.filter(m=>m.idempotencyKey==='admin-access/'+row.id).length;
  await worker.drain();const accepted=await db.adminAccessNotification.findUniqueOrThrow({where:{id:row.id}});
  assert.ok(accepted.acceptedAt);assert.equal(accepted.attempts,2);
  unblock();await old;tokens.sign=sign;
  assert.deepEqual(await db.adminAccessNotification.findUniqueOrThrow({where:{id:row.id}}),accepted);
  const messages=acceptedEmails.filter(m=>m.idempotencyKey==='admin-access/'+row.id);assert.equal(messages.length,baseline+1);
  assert.equal(messages.at(-1).html,messages[0].html);
  original.onModuleInit();
});
test('result notification survives acceptance failure and restart without changing decision or message',async()=>{
  const state=await pending();
  failEmail=item=>item.to===state.user.email&&item.subject.includes('Resultado');
  assert.equal((await confirm(state.token,'REJECT')).status,200);
  await until(async()=>emails.some(item=>item.to===state.user.email&&item.subject.includes('Resultado')));
  const failed=emails.findLast(item=>item.to===state.user.email&&item.subject.includes('Resultado'));
  assert.equal((await db.adminAccessRequest.findUniqueOrThrow({where:{id:state.request.id}})).status,'REJECTED');
  await app.close();failEmail=()=>false;await boot();
  await until(async()=>acceptedEmails.some(item=>item.idempotencyKey===failed.idempotencyKey&&item.html===failed.html));
  error(await confirm(state.token,'APPROVE'),409,'REQUEST_ALREADY_DECIDED');
});
test('a unique-index wait past OTP expiry rolls back the new applicant, request, and outbox together',async()=>{
  const value=profile();const c=await start(value);const ends=Date.now()+1500;await setOtpExpiry(c.challengeId,new Date(ends));let checking;
  await assert.rejects(db.$transaction(async tx=>{
    const {password:ignored,...profile}=value;void ignored;
    await tx.user.create({data:{...profile,birthDate:new Date(profile.birthDate),passwordHash:await argon2.hash(password),role:'EMPLOYEE'}});
    checking=verify(c);
    await until(async()=>{const rows=await db.$queryRaw`SELECT query FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock'`;return rows.some(r=>r.query.includes('INSERT INTO')&&r.query.includes('User'));});
    await until(async()=>Date.now()>=ends);throw new Error('rollback competing insert');
  },{timeout:10000}),/rollback competing insert/);
  error(await checking,410,'OTP_EXPIRED');
  assert.equal(await db.user.count({where:{email:value.email}}),0);
  const row=await db.adminAccessChallenge.findUniqueOrThrow({where:{id:c.challengeId}});assert.equal(row.consumedAt,null);assert.equal(row.requestId,null);
});
test('decision delivery rechecks active SuperAdmin eligibility before dispatch and never reaches inactive or ordinary admins',async()=>{
  const {AdminAccessNotificationsService}=require('../dist/modules/auth/admin-access-notifications.service');
  const worker=app.get(AdminAccessNotificationsService);await worker.onModuleDestroy();
  const active=(await fixture({role:'SUPER_ADMIN'})).user;
  const inactive=(await fixture({role:'SUPER_ADMIN',accountStatus:'INACTIVE'})).user;
  const admin=(await fixture({role:'ADMIN'})).user;
  const input=profile();const initial=await start(input);submitted(await verify(initial));
  const user=await db.user.findUniqueOrThrow({where:{email:input.email}});owned.push(user.id);
  // kick() may start a drain even with the interval stopped: mark a known retry
  // generation to exercise dispatch eligibility with all metadata unchanged.
  await until(async()=>!await db.adminAccessNotification.count({where:{request:{userId:user.id},completedAt:null}}));
  const request=await db.adminAccessRequest.findFirstOrThrow({where:{userId:user.id}});
  assert.equal(await db.adminAccessNotification.count({where:{requestId:request.id,recipientId:{in:[inactive.id,admin.id]}}}),0);
  const row=await db.adminAccessNotification.findFirstOrThrow({where:{requestId:request.id,recipientId:active.id,kind:'DECISION'}});
  await db.adminAccessNotification.update({where:{id:row.id},data:{completedAt:null,acceptedAt:null,attempts:0,lockedUntil:null}});
  await db.user.update({where:{id:active.id},data:{role:'EMPLOYEE'}});
  const before=acceptedEmails.filter(m=>m.idempotencyKey==='admin-access/'+row.id).length;
  await worker.drain();assert.equal(acceptedEmails.filter(m=>m.idempotencyKey==='admin-access/'+row.id).length,before);
  const skipped=await db.adminAccessNotification.findUniqueOrThrow({where:{id:row.id}});assert.ok(skipped.completedAt);assert.equal(skipped.acceptedAt,null);
  worker.onModuleInit();
});
test('role transitions invalidate preexisting login OTP and the decision revokes any stale session atomically',async()=>{
  const existing=await fixture();
  const login=await http('/auth/login',{body:{identifier:existing.user.email,password,client:'MOBILE'}});assert.equal(login.status,202);
  const oldCode=otps.at(-1).code;
  const state=await pending(existing.input);
  const otp=await http('/auth/otp/verify',{body:{challengeId:login.body.data.challengeId,code:oldCode}});
  assert.equal(otp.status,403,JSON.stringify(otp.body));assert.equal(otp.body.error.code,'ROLE_NOT_ALLOWED');
  const user=await db.user.findUniqueOrThrow({where:{id:existing.user.id}});const stale=await session(user,'ADMIN');
  const before=user.credentialVersion;assert.equal((await confirm(state.token,'REJECT')).status,200);
  assert.ok((await db.authSession.findUniqueOrThrow({where:{id:stale.row.id}})).revokedAt);
  assert.equal((await db.user.findUniqueOrThrow({where:{id:user.id}})).credentialVersion,before+1);
  error(await http('/auth/otp/verify',{body:{challengeId:login.body.data.challengeId,code:oldCode}}),401,'INVALID_OTP');
});
test('dispatch rechecks recipient and request eligibility after asynchronous token reconstruction',async()=>{
  const {AdminAccessNotificationsService}=require('../dist/modules/auth/admin-access-notifications.service');
  const {AdminDecisionTokensService}=require('../dist/modules/auth/admin-decision-tokens.service');
  const worker=app.get(AdminAccessNotificationsService),tokens=app.get(AdminDecisionTokensService);
  for(const revoke of ['recipient','request']) {
    const state=await pending();await worker.onModuleDestroy();
    const row=await db.adminAccessNotification.findFirstOrThrow({where:{requestId:state.request.id,recipientId:root.id,kind:'DECISION'}});
    await db.adminAccessNotification.update({where:{id:row.id},data:{completedAt:null,acceptedAt:null,attempts:0,lockedUntil:null,nextAttemptAt:new Date(0)}});
    let unblock,entered;const enteredPromise=new Promise(r=>entered=r),blocked=new Promise(r=>unblock=r);
    const sign=tokens.sign.bind(tokens);let intercepted=false;
    tokens.sign=async meta=>{if(meta.requestId===state.request.id&&!intercepted){intercepted=true;entered();await blocked;}return sign(meta);};
    const sending=worker.drain();await enteredPromise;
    if(revoke==='recipient')await db.user.update({where:{id:root.id},data:{role:'EMPLOYEE'}});
    else await db.user.update({where:{id:state.user.id},data:{accountStatus:'INACTIVE'}});
    const count=acceptedEmails.filter(m=>m.idempotencyKey==='admin-access/'+row.id).length;
    unblock();await sending;tokens.sign=sign;
    assert.equal(acceptedEmails.filter(m=>m.idempotencyKey==='admin-access/'+row.id).length,count);
    await db.user.update({where:{id:root.id},data:{role:'SUPER_ADMIN'}});
    worker.onModuleInit();
  }
});
test('known-user verification budget survives an email edit instead of restarting under the new address',async()=>{
  const known=await fixture();
  for(let n=0;n<4;n++) {const c=await start(known.input);for(let i=0;i<5;i++)await verify(c,c.code==='000000'?'000001':'000000');}
  const email='edited-'+known.user.email;await db.user.update({where:{id:known.user.id},data:{email}});
  const next=await start({...known.input,email});error(await verify(next),429,'TOO_MANY_ATTEMPTS');
});
