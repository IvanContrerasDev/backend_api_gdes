CREATE TYPE "AdminNotificationKind" AS ENUM ('RECEIPT','DECISION','RESULT');
CREATE TABLE "AdminAccessRequest" (
 "id" UUID NOT NULL, "userId" UUID NOT NULL, "status" "AdminRequestStatus" NOT NULL DEFAULT 'PENDING',
 "cancelledAt" TIMESTAMP(3), "decidedAt" TIMESTAMP(3), "emailHash" TEXT NOT NULL,
 "decisionGeneration" INTEGER NOT NULL DEFAULT 1, "decisionJti" UUID NOT NULL, "decisionTokenHash" TEXT NOT NULL,
 "decisionIssuedAt" TIMESTAMP(3) NOT NULL, "decisionExpiresAt" TIMESTAMP(3) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "AdminAccessRequest_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "AdminAccessRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "AdminAccessRequest_generation_check" CHECK ("decisionGeneration">0)
);
CREATE UNIQUE INDEX "AdminAccessRequest_userId_key" ON "AdminAccessRequest"("userId");
CREATE UNIQUE INDEX "AdminAccessRequest_decisionTokenHash_key" ON "AdminAccessRequest"("decisionTokenHash");
CREATE TABLE "AdminAccessChallenge" (
 "id" UUID NOT NULL,"identityHash" TEXT NOT NULL,"payload" JSONB,"codeHash" TEXT NOT NULL,"attempts" INTEGER NOT NULL DEFAULT 0,
 "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"expiresAt" TIMESTAMP(3) NOT NULL,"consumedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"requestId" UUID,
 CONSTRAINT "AdminAccessChallenge_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "AdminAccessChallenge_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AdminAccessRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "AdminAccessChallenge_attempts_check" CHECK ("attempts">=0)
);
CREATE INDEX "AdminAccessChallenge_identityHash_idx" ON "AdminAccessChallenge"("identityHash");
CREATE INDEX "AdminAccessChallenge_createdAt_idx" ON "AdminAccessChallenge"("createdAt");
CREATE TABLE "AdminAccessNotification" (
 "id" UUID NOT NULL,"requestId" UUID NOT NULL,"recipientId" UUID NOT NULL,"generation" INTEGER NOT NULL,"kind" "AdminNotificationKind" NOT NULL,
 "namespace" TEXT NOT NULL,"payload" JSONB NOT NULL,"attempts" INTEGER NOT NULL DEFAULT 0,
 "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"lockedUntil" TIMESTAMP(3),"acceptedAt" TIMESTAMP(3),"completedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"expiresAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "AdminAccessNotification_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "AdminAccessNotification_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AdminAccessRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "AdminAccessNotification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AdminAccessNotification_requestId_generation_kind_recipientId_key" ON "AdminAccessNotification"("requestId","generation","kind","recipientId");
CREATE INDEX "AdminAccessNotification_namespace_completedAt_nextAttemptAt_idx" ON "AdminAccessNotification"("namespace","completedAt","nextAttemptAt");
CREATE INDEX "AdminAccessNotification_expiresAt_idx" ON "AdminAccessNotification"("expiresAt");
CREATE FUNCTION gdes_cancel_admin_access_on_inactive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."accountStatus"='INACTIVE' AND OLD."accountStatus" IS DISTINCT FROM NEW."accountStatus" THEN
  UPDATE "AdminAccessRequest" SET "cancelledAt"=clock_timestamp(), "updatedAt"=clock_timestamp()
  WHERE "userId"=NEW.id AND status='PENDING' AND "cancelledAt" IS NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gdes_cancel_admin_access_on_inactive AFTER UPDATE OF "accountStatus" ON "User"
FOR EACH ROW EXECUTE FUNCTION gdes_cancel_admin_access_on_inactive();
