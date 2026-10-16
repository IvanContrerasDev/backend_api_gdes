-- Review enums were unused before this migration; the attendance tables are created below.
-- AlterEnum
BEGIN;
CREATE TYPE "ReviewStatus_new" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'MANUAL_LOADED');
ALTER TYPE "ReviewStatus" RENAME TO "ReviewStatus_old";
ALTER TYPE "ReviewStatus_new" RENAME TO "ReviewStatus";
DROP TYPE "ReviewStatus_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "IntervalReviewStatus_new" AS ENUM ('NONE', 'PENDING', 'APPROVED');
ALTER TYPE "IntervalReviewStatus" RENAME TO "IntervalReviewStatus_old";
ALTER TYPE "IntervalReviewStatus_new" RENAME TO "IntervalReviewStatus";
DROP TYPE "IntervalReviewStatus_old";
COMMIT;

-- CreateTable
CREATE TABLE "AttendanceEvent" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "workplaceId" UUID NOT NULL,
    "recordId" UUID NOT NULL,
    "type" "AttendanceEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "clientSentAt" TIMESTAMP(3),
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "locationTimestamp" TIMESTAMP(3) NOT NULL,
    "observation" TEXT,
    "absenceReason" "AbsenceReason",
    "clientRequestId" TEXT NOT NULL,
    "origin" "EventOrigin" NOT NULL,
    "deviceInfo" JSONB,
    "responseMessage" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "workplaceId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "totalWorkMinutes" INTEGER NOT NULL DEFAULT 0,
    "recordStatus" "RecordStatus" NOT NULL,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'NONE',
    "origin" "RecordOrigin" NOT NULL,
    "observations" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interval" (
    "id" UUID NOT NULL,
    "recordId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" "IntervalType" NOT NULL,
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "intervalStatus" "IntervalStatus" NOT NULL,
    "reviewStatus" "IntervalReviewStatus" NOT NULL DEFAULT 'NONE',
    "origin" "RecordOrigin" NOT NULL,
    "absenceReason" "AbsenceReason",
    "observations" TEXT,
    "entryEventId" UUID,
    "exitEventId" UUID,
    "absenceEventId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceEvent_clientRequestId_key" ON "AttendanceEvent"("clientRequestId");

-- CreateIndex
CREATE INDEX "AttendanceEvent_userId_receivedAt_idx" ON "AttendanceEvent"("userId", "receivedAt");

-- CreateIndex
CREATE INDEX "AttendanceEvent_recordId_idx" ON "AttendanceEvent"("recordId");

-- CreateIndex
CREATE INDEX "AttendanceRecord_userId_date_idx" ON "AttendanceRecord"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_userId_workplaceId_date_key" ON "AttendanceRecord"("userId", "workplaceId", "date");

-- CreateIndex
CREATE INDEX "Interval_entryEventId_idx" ON "Interval"("entryEventId");

-- CreateIndex
CREATE INDEX "Interval_exitEventId_idx" ON "Interval"("exitEventId");

-- CreateIndex
CREATE INDEX "Interval_absenceEventId_idx" ON "Interval"("absenceEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Interval_recordId_sequence_key" ON "Interval"("recordId", "sequence");

-- AddForeignKey
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_workplaceId_fkey" FOREIGN KEY ("workplaceId") REFERENCES "Workplace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "AttendanceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_workplaceId_fkey" FOREIGN KEY ("workplaceId") REFERENCES "Workplace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interval" ADD CONSTRAINT "Interval_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "AttendanceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interval" ADD CONSTRAINT "Interval_entryEventId_fkey" FOREIGN KEY ("entryEventId") REFERENCES "AttendanceEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interval" ADD CONSTRAINT "Interval_exitEventId_fkey" FOREIGN KEY ("exitEventId") REFERENCES "AttendanceEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interval" ADD CONSTRAINT "Interval_absenceEventId_fkey" FOREIGN KEY ("absenceEventId") REFERENCES "AttendanceEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
