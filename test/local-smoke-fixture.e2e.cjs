const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register');
const { readConfig } = require('../prisma/local-smoke-fixture.ts');

function withEnvironment(overrides, callback) {
  const defaults = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:5432/gdes_f003_test',
    LOCAL_SMOKE_FIXTURE_ENABLED: 'true',
    LOCAL_SMOKE_SITE_NAME: 'San Juan',
    LOCAL_SMOKE_LATITUDE: '-31.4',
    LOCAL_SMOKE_LONGITUDE: '-64.2',
    LOCAL_SMOKE_RADIUS_METERS: '100',
  };
  const changes = { ...defaults, ...overrides };
  const previous = new Map(Object.keys(changes).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('local smoke fixture refuses to run without explicit opt-in', () => {
  withEnvironment({ LOCAL_SMOKE_FIXTURE_ENABLED: undefined }, () => {
    assert.throws(() => readConfig(), /LOCAL_SMOKE_FIXTURE_ENABLED=true/);
  });
});

test('local smoke fixture rejects production', () => {
  withEnvironment({ NODE_ENV: 'production' }, () => {
    assert.throws(() => readConfig(), /development o test/);
  });
});

test('local smoke fixture rejects a remote database host before opening a connection', () => {
  withEnvironment(
    { DATABASE_URL: 'postgresql://unused:unused@db.example.invalid:5432/gdes' },
    () => assert.throws(() => readConfig(), /host loopback o el servicio Docker/),
  );
});

test('local smoke fixture requires an explicit valid GPS center and existing province selection', () => {
  withEnvironment({ LOCAL_SMOKE_LATITUDE: undefined, LOCAL_SMOKE_LONGITUDE: undefined }, () => {
    assert.throws(() => readConfig(), /LOCAL_SMOKE_LATITUDE and LOCAL_SMOKE_LONGITUDE/);
  });

  withEnvironment({ LOCAL_SMOKE_LATITUDE: '91' }, () => {
    assert.throws(() => readConfig(), /LOCAL_SMOKE_LATITUDE debe estar entre -90 y 90/);
  });

  withEnvironment({ LOCAL_SMOKE_RADIUS_METERS: undefined }, () => {
    assert.throws(() => readConfig(), /LOCAL_SMOKE_RADIUS_METERS es obligatorio/);
  });
});
