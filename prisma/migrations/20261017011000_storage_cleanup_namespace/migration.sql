ALTER TABLE "StorageCleanupJob" ADD COLUMN "namespace" TEXT NOT NULL DEFAULT '';
DROP INDEX "StorageCleanupJob_nextAttemptAt_idx";
CREATE INDEX "StorageCleanupJob_namespace_nextAttemptAt_idx" ON "StorageCleanupJob"("namespace", "nextAttemptAt");
