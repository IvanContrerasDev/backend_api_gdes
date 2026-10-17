require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { ConfigService } = require('@nestjs/config');
const { Logger } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { Module } = require('@nestjs/common');
const { ConfigModule } = require('@nestjs/config');
const { validateEnv } = require('../dist/config/env.validation');
const providers = require('../dist/modules/notifications/notifications.service');
const configValues = {
  EMAIL_PROVIDER: 'resend',
  WHATSAPP_PROVIDER: 'meta',
  RESEND_API_KEY: 'email-secret',
  EMAIL_FROM: 'GdeS <auth@example.com>',
  WHATSAPP_TOKEN: 'meta-secret',
  WHATSAPP_PHONE_NUMBER_ID: '123456',
  WHATSAPP_API_VERSION: 'v23.0',
  WHATSAPP_OTP_TEMPLATE_NAME: 'gdes_otp',
  WHATSAPP_TEMPLATE_LANGUAGE: 'es_AR',
};
const config = () => new ConfigService(configValues);
const email = {
  to: 'employee@example.com',
  subject: 'Código de acceso GdeS',
  html: '<strong>123456</strong>',
};
const otp = { phone: '5493511234567', code: '123456' };
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status });
const unavailable = (error) => {
  assert.equal(error.getStatus(), 503);
  assert.deepEqual(error.getResponse(), {
    code: 'NOTIFICATION_UNAVAILABLE',
    message: 'No se pudo enviar la notificación. Intentá nuevamente.',
  });
  const { HttpExceptionFilter } = require('../dist/common/filters/http-exception.filter');
  let body;
  const response = {
    status(status) {
      assert.equal(status, 503);
      return this;
    },
    json(value) {
      body = value;
    },
  };
  const filter = new HttpExceptionFilter();
  filter.logger = { error() {} };
  filter.catch(error, {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: 'POST', url: '/auth/login' }),
    }),
  });
  assert.equal(body.error.code, 'NOTIFICATION_UNAVAILABLE');
  assert.equal(body.error.retryable, true);
  assert.doesNotMatch(JSON.stringify(error), /email-secret|meta-secret|employee@example|123456/);
  return true;
};
function transport(responses) {
  const requests = [];
  return {
    requests,
    async fetch(url, init) {
      requests.push({ url, ...init });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    },
  };
}

test('notification selectors accept only known independent providers and reject production log', () => {
  const example = Object.fromEntries(
    readFileSync('.env.example', 'utf8')
      .split('\n')
      .filter((x) => x && !x.startsWith('#'))
      .map((x) => {
        const i = x.indexOf('=');
        return [x.slice(0, i), x.slice(i + 1)];
      }),
  );
  assert.throws(() => validateEnv({ ...example, EMAIL_PROVIDER: 'unknown' }), /EMAIL_PROVIDER/);
  assert.throws(
    () => validateEnv({ ...example, WHATSAPP_PROVIDER: 'unknown' }),
    /WHATSAPP_PROVIDER/,
  );
  assert.throws(
    () => validateEnv({ ...example, NODE_ENV: 'production' }),
    /notification providers/,
  );
  assert.doesNotThrow(() => validateEnv({ ...example, ...configValues }));
  assert.doesNotThrow(() => validateEnv({ ...example, ...configValues, EMAIL_PROVIDER: 'log' }));
  assert.doesNotThrow(() => validateEnv({ ...example, ...configValues, WHATSAPP_PROVIDER: 'log' }));
  for (const key of [
    'RESEND_API_KEY',
    'EMAIL_FROM',
    'WHATSAPP_TOKEN',
    'WHATSAPP_PHONE_NUMBER_ID',
    'WHATSAPP_API_VERSION',
    'WHATSAPP_OTP_TEMPLATE_NAME',
    'WHATSAPP_TEMPLATE_LANGUAGE',
  ]) {
    assert.throws(() => validateEnv({ ...example, ...configValues, [key]: ' ' }), new RegExp(key));
  }
  for (const version of ['latest', 'v23', 'v23.0/other', 'https://other']) {
    assert.throws(
      () => validateEnv({ ...example, ...configValues, WHATSAPP_API_VERSION: version }),
      /WHATSAPP_API_VERSION/,
    );
  }
  assert.throws(
    () => validateEnv({ ...example, ...configValues, NODE_ENV: 'production' }),
    /HTTPS/,
  );
  assert.doesNotThrow(() =>
    validateEnv({
      ...example,
      ...configValues,
      NODE_ENV: 'production',
      ADMIN_FRONTEND_URL: 'https://admin.example.com',
      API_PUBLIC_URL: 'https://api.example.com',
    }),
  );
});

test('Resend serializes authenticated request and keeps business idempotency key', async () => {
  assert.equal(typeof providers.ResendEmailProvider, 'function');
  const http = transport([reply({ id: 'email-id' })]);
  await new providers.ResendEmailProvider(config(), http).sendEmail({
    ...email,
    idempotencyKey: 'login-event-1',
  });
  assert.equal(http.requests.length, 1);
  const request = http.requests[0];
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.method, 'POST');
  assert.equal(request.redirect, 'error');
  assert.equal(request.headers.Authorization, 'Bearer email-secret');
  assert.equal(request.headers['Idempotency-Key'], 'login-event-1');
  assert.equal(request.headers['Content-Type'], 'application/json');
  assert.equal(request.signal.aborted, false);
  assert.deepEqual(JSON.parse(request.body), {
    from: configValues.EMAIL_FROM,
    to: [email.to],
    subject: email.subject,
    html: email.html,
  });
});

test('Resend retries only transient failures, reusing exact payload and one generated key', async () => {
  const http = transport([
    reply({ error: 'private' }, 429),
    new Error('email-secret'),
    reply({ id: 'sent' }),
  ]);
  await new providers.ResendEmailProvider(config(), http).sendEmail(email);
  assert.equal(http.requests.length, 3);
  assert.equal(new Set(http.requests.map((x) => x.body)).size, 1);
  assert.equal(new Set(http.requests.map((x) => x.headers['Idempotency-Key'])).size, 1);
  assert.ok(http.requests[0].headers['Idempotency-Key']);
});

test('Resend bounds retries and redacts definitive, malformed and oversized responses', async () => {
  for (const status of [400, 401, 403, 422, 500]) {
    const http = transport(
      Array.from({ length: 3 }, () =>
        reply({ error: 'email-secret employee@example.com' }, status),
      ),
    );
    await assert.rejects(
      new providers.ResendEmailProvider(config(), http).sendEmail(email),
      unavailable,
    );
    assert.equal(http.requests.length, status === 500 ? 3 : 1);
  }
  for (const response of [
    reply({}),
    reply({ id: '' }),
    new Response('not-json'),
    reply({ id: 'x'.repeat(17000) }),
  ]) {
    const http = transport([response]);
    await assert.rejects(
      new providers.ResendEmailProvider(config(), http).sendEmail(email),
      unavailable,
    );
    assert.equal(http.requests.length, 1);
  }
});

test('Meta serializes authentication template with body and URL copy-code button', async () => {
  const http = transport([reply({ messages: [{ id: 'wamid.ok' }] })]);
  await new providers.MetaWhatsAppProvider(config(), http).sendOtp(otp);
  const request = http.requests[0];
  assert.equal(request.url, 'https://graph.facebook.com/v23.0/123456/messages');
  assert.equal(request.headers.Authorization, 'Bearer meta-secret');
  assert.equal(request.method, 'POST');
  assert.equal(request.redirect, 'error');
  assert.deepEqual(JSON.parse(request.body), {
    messaging_product: 'whatsapp',
    to: otp.phone,
    type: 'template',
    template: {
      name: 'gdes_otp',
      language: { code: 'es_AR' },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: otp.code }] },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: otp.code }],
        },
      ],
    },
  });
});

test('Meta validates destination and OTP locally and never retries ambiguous failures', async () => {
  for (const input of [
    { ...otp, code: '12345' },
    { ...otp, code: 'abcdef' },
    { ...otp, phone: '+5493511234567' },
    { ...otp, phone: '1' },
  ]) {
    const http = transport([]);
    await assert.rejects(
      new providers.MetaWhatsAppProvider(config(), http).sendOtp(input),
      unavailable,
    );
    assert.equal(http.requests.length, 0);
  }
  for (const response of [
    reply({}, 500),
    reply({}, 429),
    reply({}),
    reply({ messages: [{ id: '' }] }),
    new Response('invalid'),
    new DOMException('meta-secret', 'TimeoutError'),
  ]) {
    const http = transport([response]);
    await assert.rejects(
      new providers.MetaWhatsAppProvider(config(), http).sendOtp(otp),
      unavailable,
    );
    assert.equal(http.requests.length, 1);
  }
});

test('HTTP attempt aborts at ten seconds, including a stalled response body', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const http = {
    async fetch(url, init) {
      signal = init.signal;
      return new Response(
        new ReadableStream({
          start(controller) {
            signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
          },
        }),
      );
    },
  };
  const pending = new providers.MetaWhatsAppProvider(config(), http).sendOtp(otp);
  await Promise.resolve();
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(10000);
  await assert.rejects(pending, unavailable);
  assert.equal(signal.aborted, true);
});

test('DI selects mixed modes with fake transport and real adapters do not log secrets', async () => {
  const { NotificationsModule } = require('../dist/modules/notifications/notifications.module');
  const {
    NotificationHttpTransport,
  } = require('../dist/modules/notifications/notification-http.transport');
  const http = transport([reply({ id: 'ok' })]);
  class TestModule {}
  Module({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [() => ({ ...configValues, NODE_ENV: 'test', WHATSAPP_PROVIDER: 'log' })],
      }),
      NotificationsModule,
    ],
  })(TestModule);
  // Nest application context with overridden transport through a module's provider factory.
  const definition = Reflect.getMetadata('providers', NotificationsModule);
  const httpProvider = definition.find((x) => x.provide === NotificationHttpTransport);
  const originalFactory = httpProvider.useFactory;
  httpProvider.useFactory = () => http;
  const logs = [];
  const originalLog = Logger.prototype.log;
  Logger.prototype.log = function (...args) {
    logs.push(args.join(' '));
  };
  let app;
  try {
    app = await NestFactory.createApplicationContext(TestModule, { logger: false });
    assert.ok(app.get(providers.EmailProvider) instanceof providers.ResendEmailProvider);
    assert.ok(app.get(providers.WhatsAppProvider) instanceof providers.LogNotifications);
    logs.length = 0;
    await app.get(providers.EmailProvider).sendEmail(email);
    assert.equal(logs.length, 0);
    await app.get(providers.WhatsAppProvider).sendOtp(otp);
    assert.match(logs.join('\n'), /code=123456/);
    assert.doesNotMatch(logs.join('\n'), /5493511234567|email-secret|employee@example/);
  } finally {
    Logger.prototype.log = originalLog;
    httpProvider.useFactory = originalFactory;
    if (app) await app.close();
  }
});
