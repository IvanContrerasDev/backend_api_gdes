import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

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

async function main(): Promise<void> {
  for (const name of SITES) {
    await prisma.site.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  let seededUsers = 0;
  if (process.env.NODE_ENV !== 'production') {
    const site = await prisma.site.findUniqueOrThrow({ where: { name: 'San Juan' } });
    const passwordHash = await argon2.hash(process.env.LOCAL_SEED_PASSWORD || 'GdesLocal2026!');
    for (const user of LOCAL_USERS) {
      await prisma.user.upsert({
        where: { email: user.email },
        update: {
          passwordHash,
          role: user.role,
          accountStatus: 'ACTIVE',
          emailVerifiedAt: new Date(),
        },
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
    `Seed complete: ${SITES.length} sites (provinces), ${seededUsers} local users${seededUsers ? ' (shared local password)' : ''}.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
