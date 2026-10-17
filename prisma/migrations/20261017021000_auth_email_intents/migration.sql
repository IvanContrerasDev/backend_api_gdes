CREATE TABLE "AuthEmailIntent" (
  "id" UUID NOT NULL, "emailCiphertext" TEXT NOT NULL, "purpose" "AuthLinkPurpose" NOT NULL,
  "linkId" UUID, "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lockedUntil" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthEmailIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthEmailIntent_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "AuthLink"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AuthEmailIntent_linkId_key" ON "AuthEmailIntent"("linkId");
CREATE INDEX "AuthEmailIntent_completedAt_nextAttemptAt_idx" ON "AuthEmailIntent"("completedAt", "nextAttemptAt");
CREATE INDEX "AuthEmailIntent_expiresAt_idx" ON "AuthEmailIntent"("expiresAt");
