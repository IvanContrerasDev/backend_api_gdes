ALTER TABLE "User" ADD COLUMN "credentialVersion" INTEGER NOT NULL DEFAULT 0 CHECK ("credentialVersion" >= 0);
ALTER TABLE "AuthChallenge" ADD COLUMN "credentialVersion" INTEGER NOT NULL DEFAULT 0 CHECK ("credentialVersion" >= 0);
ALTER TABLE "AuthChallenge" ADD COLUMN "destinationHash" TEXT NOT NULL DEFAULT '';
CREATE TYPE "AuthLinkPurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');
CREATE TABLE "RegistrationChallenge" (
  "id" UUID NOT NULL, "identityHash" TEXT NOT NULL, "payload" JSONB,
  "codeHash" TEXT NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RegistrationChallenge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RegistrationChallenge_createdAt_idx" ON "RegistrationChallenge"("createdAt");
CREATE INDEX "RegistrationChallenge_identityHash_idx" ON "RegistrationChallenge"("identityHash");
CREATE TABLE "AuthLink" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "purpose" "AuthLinkPurpose" NOT NULL,
  "hash" TEXT NOT NULL, "emailHash" TEXT NOT NULL, "credentialVersion" INTEGER NOT NULL CHECK ("credentialVersion" >= 0),
  "createdAt" TIMESTAMP(3) NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "consumedAt" TIMESTAMP(3),
  CONSTRAINT "AuthLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CHECK ("expiresAt" > "createdAt")
);
CREATE UNIQUE INDEX "AuthLink_hash_key" ON "AuthLink"("hash");
CREATE INDEX "AuthLink_userId_purpose_idx" ON "AuthLink"("userId", "purpose");
CREATE INDEX "AuthLink_expiresAt_idx" ON "AuthLink"("expiresAt");
