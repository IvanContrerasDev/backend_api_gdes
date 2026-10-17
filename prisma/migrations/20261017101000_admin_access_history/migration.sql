DROP INDEX "AdminAccessRequest_userId_key";
CREATE UNIQUE INDEX "AdminAccessRequest_active_userId_key" ON "AdminAccessRequest"("userId") WHERE status='PENDING' AND "cancelledAt" IS NULL;
CREATE INDEX "AdminAccessRequest_userId_createdAt_idx" ON "AdminAccessRequest"("userId","createdAt");
