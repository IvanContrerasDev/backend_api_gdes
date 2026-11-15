import { PrismaClient } from '@prisma/client';

const DEFAULT_CLIENT_ID = 'f0120000-0000-4000-8000-000000000001';
const DEFAULT_WORKPLACE_ID = 'f0120000-0000-4000-8000-000000000002';

type FixtureConfig = {
  siteName: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  clientId: string;
  workplaceId: string;
  clientName: string;
  workplaceName: string;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} es obligatorio para preparar la fixture local.`);
  return value;
}

function coordinate(name: string, min: number, max: number): number {
  const value = Number(required(name));
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} debe estar entre ${min} y ${max}.`);
  }
  return value;
}

function uuid(name: string, fallback: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${name} debe ser un UUID válido.`);
  }
  return value;
}

function requireLocalDatabase(): void {
  const databaseUrl = required('DATABASE_URL');
  let host: string;
  try {
    host = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    throw new Error('DATABASE_URL debe apuntar a una base PostgreSQL local para usar la fixture.');
  }
  if (!['localhost', '127.0.0.1', '::1', '[::1]', 'postgres'].includes(host)) {
    throw new Error('La fixture local solo admite DATABASE_URL con host loopback o el servicio Docker `postgres`.');
  }
}

function parseConfig(): FixtureConfig {
  if (!['development', 'test'].includes(process.env.NODE_ENV || '')) {
    throw new Error('La fixture local solo se permite con NODE_ENV=development o test.');
  }
  if (process.env.LOCAL_SMOKE_FIXTURE_ENABLED !== 'true') {
    throw new Error('Opt-in requerido: define LOCAL_SMOKE_FIXTURE_ENABLED=true para ejecutar la fixture.');
  }
  requireLocalDatabase();
  if (!process.env.LOCAL_SMOKE_LATITUDE?.trim() || !process.env.LOCAL_SMOKE_LONGITUDE?.trim()) {
    throw new Error('LOCAL_SMOKE_LATITUDE and LOCAL_SMOKE_LONGITUDE son obligatorios; no hay centro GPS predeterminado.');
  }
  const radiusMeters = Number(required('LOCAL_SMOKE_RADIUS_METERS'));
  if (!Number.isInteger(radiusMeters) || radiusMeters < 10 || radiusMeters > 10000) {
    throw new Error('LOCAL_SMOKE_RADIUS_METERS debe ser un entero entre 10 y 10000.');
  }
  return {
    siteName: required('LOCAL_SMOKE_SITE_NAME'),
    latitude: coordinate('LOCAL_SMOKE_LATITUDE', -90, 90),
    longitude: coordinate('LOCAL_SMOKE_LONGITUDE', -180, 180),
    radiusMeters,
    clientId: uuid('LOCAL_SMOKE_CLIENT_ID', DEFAULT_CLIENT_ID),
    workplaceId: uuid('LOCAL_SMOKE_WORKPLACE_ID', DEFAULT_WORKPLACE_ID),
    clientName: process.env.LOCAL_SMOKE_CLIENT_NAME?.trim() || 'GdeS Local Smoke',
    workplaceName: process.env.LOCAL_SMOKE_WORKPLACE_NAME?.trim() || 'Lugar local de smoke',
  };
}

export async function ensureFixture(prisma: PrismaClient, config: FixtureConfig): Promise<void> {
  const site = await prisma.site.findUnique({ where: { name: config.siteName } });
  if (!site) throw new Error(`No existe la provincia configurada en LOCAL_SMOKE_SITE_NAME: ${config.siteName}`);

  // Empty update clauses are intentional: once created, operator edits and
  // business data remain authoritative on every subsequent invocation.
  await prisma.client.upsert({
    where: { id: config.clientId },
    update: {},
    create: { id: config.clientId, name: config.clientName },
  });
  const workplace = await prisma.workplace.upsert({
    where: { id: config.workplaceId },
    update: {},
    create: {
      id: config.workplaceId,
      clientId: config.clientId,
      siteId: site.id,
      name: config.workplaceName,
      latitude: config.latitude,
      longitude: config.longitude,
      radiusMeters: config.radiusMeters,
      gpsAccuracyThreshold: null,
    },
  });
  if (workplace.clientId !== config.clientId || workplace.siteId !== site.id) {
    throw new Error(
      'El lugar local existente fue editado para otro cliente o provincia; se conservó sin cambios. Revisá la fixture en Admin antes de continuar.',
    );
  }
  process.stdout.write(
    `Fixture local lista (${workplace.status}); cliente=${config.clientId}; lugar=${config.workplaceId}. Los valores existentes se conservan.\n`,
  );
}

export function readConfig(): FixtureConfig {
  return parseConfig();
}

async function main(): Promise<void> {
  // Validate opt-in and all operator-supplied geometry before constructing a
  // Prisma client, so invalid invocation cannot contact any database.
  const config = readConfig();
  const prisma = new PrismaClient();
  try {
    await ensureFixture(prisma, config);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`Fixture local no ejecutada: ${error instanceof Error ? error.message : 'error desconocido'}\n`);
    process.exitCode = 1;
  });
}
