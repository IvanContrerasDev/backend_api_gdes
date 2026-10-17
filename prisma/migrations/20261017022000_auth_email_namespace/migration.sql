-- Previous delivery configurations cannot decrypt/process pending encrypted intents.
ALTER TABLE "AuthEmailIntent" ADD COLUMN "namespace" TEXT NOT NULL DEFAULT '';
DROP INDEX "AuthEmailIntent_completedAt_nextAttemptAt_idx";
CREATE INDEX "AuthEmailIntent_namespace_completedAt_nextAttemptAt_idx" ON "AuthEmailIntent"("namespace", "completedAt", "nextAttemptAt");
