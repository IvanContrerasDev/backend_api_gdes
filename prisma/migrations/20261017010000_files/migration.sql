ALTER TABLE "Timesheet" ADD COLUMN "contentType" TEXT NOT NULL DEFAULT 'application/octet-stream';
CREATE UNIQUE INDEX "Timesheet_fileKey_key" ON "Timesheet"("fileKey");
CREATE TABLE "Document" (
  "id" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "workplaceId" UUID,
  "type" "DocumentType" NOT NULL,
  "fileKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileExtension" TEXT NOT NULL,
  "fileSizeBytes" INTEGER NOT NULL,
  "contentType" TEXT NOT NULL,
  "uploadedById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Document_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Document_fileSizeBytes_check" CHECK ("fileSizeBytes">0),
  CONSTRAINT "Document_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Document_workplaceId_fkey" FOREIGN KEY ("workplaceId") REFERENCES "Workplace"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Document_fileKey_key" ON "Document"("fileKey");
CREATE INDEX "Document_employeeId_createdAt_idx" ON "Document"("employeeId","createdAt");
CREATE INDEX "Document_uploadedById_idx" ON "Document"("uploadedById");
CREATE INDEX "Document_workplaceId_idx" ON "Document"("workplaceId");
CREATE INDEX "Document_createdAt_id_idx" ON "Document"("createdAt","id");
CREATE TABLE "StorageCleanupJob" (
  "id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StorageCleanupJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StorageCleanupJob_attempts_check" CHECK ("attempts">=0)
);
CREATE UNIQUE INDEX "StorageCleanupJob_key_key" ON "StorageCleanupJob"("key");
CREATE INDEX "StorageCleanupJob_nextAttemptAt_idx" ON "StorageCleanupJob"("nextAttemptAt");
