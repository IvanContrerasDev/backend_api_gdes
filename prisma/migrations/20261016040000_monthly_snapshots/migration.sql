CREATE TABLE "MonthlySnapshot" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "context" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MonthlySnapshot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MonthlySnapshot_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MonthlySnapshot_expiresAt_idx" ON "MonthlySnapshot"("expiresAt");
CREATE INDEX "MonthlySnapshot_ownerId_idx" ON "MonthlySnapshot"("ownerId");
CREATE INDEX "AttendanceRecord_date_userId_workplaceId_idx" ON "AttendanceRecord"("date", "userId", "workplaceId");
CREATE INDEX "AttendanceRecord_workplaceId_idx" ON "AttendanceRecord"("workplaceId");
