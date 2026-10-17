CREATE TABLE "Timesheet" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "workplaceId" UUID NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "status" "TimesheetStatus" NOT NULL DEFAULT 'PENDING',
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileExtension" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "uploadedById" UUID NOT NULL,
    "replacedById" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Timesheet_month_check" CHECK ("month" BETWEEN 1 AND 12),
    CONSTRAINT "Timesheet_year_check" CHECK ("year" BETWEEN 2000 AND 9999),
    CONSTRAINT "Timesheet_sequenceNumber_check" CHECK ("sequenceNumber" > 0),
    CONSTRAINT "Timesheet_fileSizeBytes_check" CHECK ("fileSizeBytes" > 0),
    CONSTRAINT "Timesheet_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Timesheet_workplaceId_fkey" FOREIGN KEY ("workplaceId") REFERENCES "Workplace"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Timesheet_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Timesheet_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Timesheet_employeeId_workplaceId_month_year_sequenceNumber_key" ON "Timesheet"("employeeId", "workplaceId", "month", "year", "sequenceNumber");
CREATE INDEX "Timesheet_year_month_status_idx" ON "Timesheet"("year", "month", "status");
CREATE INDEX "Timesheet_workplaceId_idx" ON "Timesheet"("workplaceId");
