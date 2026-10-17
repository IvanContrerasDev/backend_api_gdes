import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from './storage.service';
import { storageUnavailable } from './r2-storage.service';

@Injectable()
export class StorageCleanupService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly logger = new Logger(StorageCleanupService.name);
  constructor(
    private readonly db: PrismaService,
    private readonly storage: StorageService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), 1000);
    this.timer.unref();
    void this.tick();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async journal(keys: string[]) {
    // A crash after any PUT leaves a durable, discoverable cleanup candidate.
    await this.db.storageCleanupJob.createMany({
      data: keys.map((key) => ({
        id: randomUUID(),
        key,
        namespace: this.storage.namespace,
        nextAttemptAt: new Date(Date.now() + 900000),
      })),
    });
  }
  async claimPublication(tx: Prisma.TransactionClient, keys: string[]) {
    const jobs = await tx.$queryRaw<
      { key: string; attempts: number; nextAttemptAt: Date }[]
    >(Prisma.sql`
      SELECT key, attempts, "nextAttemptAt" FROM "StorageCleanupJob" WHERE namespace=${this.storage.namespace} AND key IN (${Prisma.join(keys)}) ORDER BY key FOR UPDATE`);
    // Worker may have purged an abandoned upload after its lease expired. A
    // resumed publisher cannot create a reference to that already-deleted key.
    const acquiredAt = Date.now();
    if (
      jobs.length !== keys.length ||
      jobs.some((job) => job.attempts !== 0 || job.nextAttemptAt.getTime() <= acquiredAt)
    )
      throw storageUnavailable();
  }
  async publish(tx: Prisma.TransactionClient, keys: string[]) {
    await tx.storageCleanupJob.deleteMany({ where: { key: { in: keys } } });
  }
  async enqueue(tx: Prisma.TransactionClient, key: string) {
    await tx.storageCleanupJob.upsert({
      where: { key },
      create: { key, namespace: this.storage.namespace },
      update: { nextAttemptAt: new Date() },
    });
  }
  async compensate(keys: string[]) {
    try {
      await this.db.storageCleanupJob.updateMany({
        where: { key: { in: keys } },
        data: { nextAttemptAt: new Date() },
      });
      await this.tick();
    } catch {
      // The pre-upload journal remains durable even if DB/commit outcome is
      // ambiguous. Never bypass the reference check with a blind delete here.
      this.logger.warn('La limpieza de archivos se reintentará desde su registro persistido');
    }
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      for (let i = 0; i < 5; i++) {
        const processed = await this.db.$transaction(
          async (tx) => {
            const [job] = await tx.$queryRaw<{ id: string; key: string; attempts: number }[]>`
            SELECT id, key, attempts FROM "StorageCleanupJob" WHERE namespace=${this.storage.namespace} AND "nextAttemptAt" <= now()
            ORDER BY "nextAttemptAt", id LIMIT 1 FOR UPDATE SKIP LOCKED`;
            if (!job) return false;
            const referenced =
              (await tx.timesheet.findFirst({
                where: { fileKey: job.key },
                select: { id: true },
              })) ??
              (await tx.document.findFirst({ where: { fileKey: job.key }, select: { id: true } }));
            if (!referenced) {
              try {
                await this.storage.delete(job.key);
              } catch {
                await tx.storageCleanupJob.update({
                  where: { id: job.id },
                  data: {
                    attempts: { increment: 1 },
                    nextAttemptAt: new Date(
                      Date.now() + Math.min(3600000, 1000 * 2 ** Math.min(job.attempts, 12)),
                    ),
                  },
                });
                return true;
              }
            }
            await tx.storageCleanupJob.delete({ where: { id: job.id } });
            return true;
          },
          { timeout: 20000 },
        );
        if (!processed) break;
      }
    } catch {
      this.logger.warn('La limpieza de archivos está diferida y se reintentará');
    } finally {
      this.running = false;
    }
  }
}
