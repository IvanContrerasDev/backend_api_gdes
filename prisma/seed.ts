import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Seed: provinces catalog (sites). Fixed list shared with mobile
 * (`mobile_app_gdes/constants/data.ts`). Idempotent (upsert by name).
 */
const SITES = ['San Juan', 'Mendoza', 'Catamarca', 'La Rioja', 'Salta', 'San Luis'];

async function main(): Promise<void> {
  for (const name of SITES) {
    await prisma.site.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`Seed complete: ${SITES.length} sites (provinces).`);
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
