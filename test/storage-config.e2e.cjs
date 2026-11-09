const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ConfigService } = require('@nestjs/config');
const { R2StorageService } = require('../dist/modules/storage/r2-storage.service');
const { validateEnv } = require('../dist/config/env.validation');
const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://local/test',
  JWT_ACCESS_SECRET: 'test-access',
  JWT_REFRESH_SECRET: 'test-refresh',
  STORAGE_ENDPOINT: 'https://internal.example.com',
  STORAGE_BUCKET: 'test-bucket',
  STORAGE_REGION: 'us-east-1',
  STORAGE_ACCESS_KEY_ID: 'test-access',
  STORAGE_SECRET_ACCESS_KEY: 'test-secret',
  GOOGLE_CLIENT_ID: 'test-google',
  ADMIN_FRONTEND_URL: 'http://localhost:5173',
  MOBILE_DEEP_LINK_SCHEME: 'gdes',
};
const adapter = (overrides = {}) =>
  new R2StorageService(new ConfigService({ ...base, ...overrides }));
test('public endpoint signs final host for 900s and leaves durable namespace unchanged', async () => {
  const internal = adapter();
  const external = adapter({ STORAGE_PUBLIC_ENDPOINT: 'https://public.example.com:9443' });
  const otherBucket = adapter({ STORAGE_BUCKET: 'other' });
  const otherInternal = adapter({ STORAGE_ENDPOINT: 'https://other.example.com' });
  try {
    assert.equal(internal.namespace, external.namespace);
    assert.notEqual(internal.namespace, otherBucket.namespace);
    assert.notEqual(internal.namespace, otherInternal.namespace);
    assert.equal(
      new URL((await internal.getSignedDownloadUrl('old.txt')).downloadUrl).origin,
      base.STORAGE_ENDPOINT,
    );
    const signed = await external.getSignedDownloadUrl('a test/file.pdf');
    const url = new URL(signed.downloadUrl);
    assert.equal(url.origin, 'https://public.example.com:9443');
    assert.equal(url.searchParams.get('X-Amz-Expires'), '900');
    assert.match(url.pathname, /test-bucket\/a%20test\/file.pdf$/);
    assert.ok(Math.abs(Date.parse(signed.expiresAt) - Date.now() - 900000) < 2000);
  } finally {
    [internal, external, otherBucket, otherInternal].forEach((a) => a.onModuleDestroy());
  }
});
test('environment and direct adapter enforce identical endpoint/HTTP policy', () => {
  const invalid = [
    { STORAGE_ENDPOINT: 'ftp://example.com' },
    { STORAGE_ENDPOINT: 'https://u:p@example.com' },
    { STORAGE_PUBLIC_ENDPOINT: 'https://example.com/?token=secret' },
    { STORAGE_PUBLIC_ENDPOINT: 'https://example.com/#fragment' },
    { STORAGE_PUBLIC_ENDPOINT: 'file:///tmp/local' },
    { STORAGE_PUBLIC_ENDPOINT: '' },
    { STORAGE_ENDPOINT: 'http://storage:8333' },
    { STORAGE_PUBLIC_ENDPOINT: 'http://192.168.1.7:8333' },
    ...['TRUE', '1', '', true, false].map((STORAGE_ALLOW_INSECURE_HTTP) => ({
      STORAGE_ALLOW_INSECURE_HTTP,
    })),
    { NODE_ENV: 'staging', STORAGE_ALLOW_INSECURE_HTTP: 'true' },
    { NODE_ENV: 'production', STORAGE_ALLOW_INSECURE_HTTP: 'true' },
    { NODE_ENV: 'production', STORAGE_PUBLIC_ENDPOINT: 'http://localhost:8333' },
    { NODE_ENV: 'production', STORAGE_ENDPOINT: 'http://localhost:8333' },
  ];
  for (const override of invalid) {
    assert.throws(() => adapter(override), JSON.stringify(override));
    assert.throws(() => validateEnv({ ...base, ...override }), JSON.stringify(override));
  }
  for (const override of [
    {},
    { STORAGE_ALLOW_INSECURE_HTTP: 'false' },
    { STORAGE_ENDPOINT: 'http://localhost:8333' },
    { STORAGE_ENDPOINT: 'http://127.0.0.1:8333', STORAGE_PUBLIC_ENDPOINT: 'http://[::1]:8333' },
    {
      STORAGE_ENDPOINT: 'http://storage:8333',
      STORAGE_PUBLIC_ENDPOINT: 'http://192.168.1.7:8333',
      STORAGE_ALLOW_INSECURE_HTTP: 'true',
    },
  ]) {
    assert.doesNotThrow(() => validateEnv({ ...base, ...override }));
    const service = adapter(override);
    service.onModuleDestroy();
  }
});

test('production HTTPS remains valid with real provider configuration and explicit false flag', () => {
  const config = {
    ...base,
    NODE_ENV: 'production',
    API_PUBLIC_URL: 'https://api.example.com',
    ADMIN_FRONTEND_URL: 'https://admin.example.com',
    EMAIL_PROVIDER: 'resend',
    RESEND_API_KEY: 'dummy',
    EMAIL_FROM: 'test@example.com',
    WHATSAPP_PROVIDER: 'meta',
    WHATSAPP_TOKEN: 'dummy',
    WHATSAPP_PHONE_NUMBER_ID: '1234',
    WHATSAPP_API_VERSION: 'v24.0',
    WHATSAPP_OTP_TEMPLATE_NAME: 'dummy',
    WHATSAPP_TEMPLATE_LANGUAGE: 'es',
    STORAGE_PUBLIC_ENDPOINT: 'https://download.example.com',
    STORAGE_ALLOW_INSECURE_HTTP: 'false',
  };
  assert.doesNotThrow(() => validateEnv(config));
  const service = new R2StorageService(new ConfigService(config));
  service.onModuleDestroy();
  for (const override of [
    { STORAGE_ALLOW_INSECURE_HTTP: 'true' },
    { STORAGE_PUBLIC_ENDPOINT: 'http://localhost:8333' },
    { STORAGE_ENDPOINT: 'http://localhost:8333' },
  ]) {
    assert.throws(() => validateEnv({ ...config, ...override }), /STORAGE_/);
    assert.throws(
      () => new R2StorageService(new ConfigService({ ...config, ...override })),
      /STORAGE_/,
    );
  }
});
