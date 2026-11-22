-- Preserve ordinary historical rows and their existing FK/composite uniqueness.
ALTER TABLE "Timesheet" ALTER COLUMN "workplaceId" DROP NOT NULL;

-- PostgreSQL ordinary unique indexes treat NULLs as distinct. Enforce the
-- contingency sequence independently without inventing a workplace UUID.
CREATE UNIQUE INDEX "Timesheet_contingency_sequence_key"
ON "Timesheet" ("employeeId", "month", "year", "sequenceNumber")
WHERE "workplaceId" IS NULL;
