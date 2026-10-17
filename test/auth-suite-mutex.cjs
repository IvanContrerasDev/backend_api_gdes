// Both auth suites manipulate persistent rate counters; serialize only those suites.
const { PrismaClient } = require('@prisma/client');
exports.acquireAuthSuiteMutex = async function (databaseUrl) {
  const url = new URL(databaseUrl);
  url.searchParams.set('connection_limit', '1');
  const lock = new PrismaClient({ datasources: { db: { url: url.href } } });
  await lock.$connect();
  await lock.$queryRaw`SELECT pg_advisory_lock(8008001)::text`;
  return () => lock.$disconnect();
};
