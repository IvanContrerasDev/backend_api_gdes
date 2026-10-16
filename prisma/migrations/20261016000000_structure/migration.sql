-- CreateTable
CREATE TABLE "Client" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workplace" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "shapeType" "ShapeType" NOT NULL DEFAULT 'CIRCLE',
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radiusMeters" INTEGER NOT NULL,
    "gpsAccuracyThreshold" INTEGER,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workplace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Workplace_clientId_siteId_status_idx" ON "Workplace"("clientId", "siteId", "status");

-- AddForeignKey
ALTER TABLE "Workplace" ADD CONSTRAINT "Workplace_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workplace" ADD CONSTRAINT "Workplace_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- PostgreSQL enforces normalized uniqueness, including concurrent requests.
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE UNIQUE INDEX "Client_normalized_name_key" ON "Client" (lower(regexp_replace(trim(name), '\s+', ' ', 'g')));
CREATE UNIQUE INDEX "Workplace_client_site_normalized_name_key" ON "Workplace" ("clientId", "siteId", lower(regexp_replace(trim(name), '\s+', ' ', 'g')));
ALTER TABLE "Client" ADD CONSTRAINT "Client_name_valid" CHECK (length(trim(name)) BETWEEN 1 AND 120);
ALTER TABLE "Workplace" ADD CONSTRAINT "Workplace_name_valid" CHECK (length(trim(name)) BETWEEN 1 AND 120),
 ADD CONSTRAINT "Workplace_geography_valid" CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180 AND "radiusMeters" BETWEEN 10 AND 10000 AND ("gpsAccuracyThreshold" IS NULL OR "gpsAccuracyThreshold" BETWEEN 1 AND 1000));
