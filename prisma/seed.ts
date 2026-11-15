import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

/**
 * Seed: provinces catalog (sites). Fixed list shared with mobile
 * (`mobile_app_gdes/constants/data.ts`). Idempotent (upsert by name).
 */
const SITES = ['San Juan', 'Mendoza', 'Catamarca', 'La Rioja', 'Salta', 'San Luis'];
const LOCAL_USERS = [
  { role: 'EMPLOYEE', email: 'seed.employee@gdes.local', employeeId: '99000001' },
  { role: 'TO_BE_ADMIN', email: 'seed.to-be-admin@gdes.local', employeeId: '99000002' },
  { role: 'ADMIN', email: 'seed.admin@gdes.local', employeeId: '99000003' },
  { role: 'SUPER_ADMIN', email: 'seed.super-admin@gdes.local', employeeId: '99000004' },
] as const;

export async function seedDatabase(
  prisma: PrismaClient,
  nodeEnvironment = process.env.NODE_ENV,
  localSeedPassword = process.env.LOCAL_SEED_PASSWORD || 'GdesLocal2026!',
): Promise<void> {
  for (const name of SITES) {
    await prisma.site.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  let seededUsers = 0;
  if (nodeEnvironment !== 'production') {
    const site = await prisma.site.findUniqueOrThrow({ where: { name: 'San Juan' } });
    const passwordHash = await argon2.hash(localSeedPassword);
    for (const user of LOCAL_USERS) {
      await prisma.user.upsert({
        where: { email: user.email },
        // This seed is additive: existing local accounts may contain operator
        // edits and must never be reset by a restart or repeated catalog seed.
        update: {},
        create: {
          firstName: 'Usuario',
          lastName: user.role,
          email: user.email,
          emailVerifiedAt: new Date(),
          passwordHash,
          phone: '5491100000000',
          dni: user.employeeId,
          employeeId: user.employeeId,
          address: 'Domicilio de prueba',
          birthDate: new Date('1990-01-01T00:00:00.000Z'),
          siteId: site.id,
          position: 'Cuenta local de prueba',
          role: user.role,
          accountStatus: 'ACTIVE',
        },
      });
      seededUsers++;
    }
  }
  console.log(
    `Seed complete: ${SITES.length} sites (provinces), ${seededUsers} local users ensured; shared local password applies only to newly created accounts.`,
  );
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await seedDatabase(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  });
}
