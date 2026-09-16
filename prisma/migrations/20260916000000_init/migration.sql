-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('EMPLOYEE', 'TO_BE_ADMIN', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "EntityStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('COMPLETE', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED', 'MANUAL_LOADED');

-- CreateEnum
CREATE TYPE "IntervalStatus" AS ENUM ('OPEN', 'CLOSED', 'SEMI_CLOSED');

-- CreateEnum
CREATE TYPE "IntervalType" AS ENUM ('WORK', 'ABSENCE');

-- CreateEnum
CREATE TYPE "IntervalReviewStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RecordOrigin" AS ENUM ('AUTOMATIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "AttendanceEventType" AS ENUM ('CHECK_IN', 'CHECK_OUT', 'ABSENCE');

-- CreateEnum
CREATE TYPE "EventOrigin" AS ENUM ('MOBILE', 'ADMIN');

-- CreateEnum
CREATE TYPE "TimesheetStatus" AS ENUM ('PENDING', 'LOADED', 'ERROR');

-- CreateEnum
CREATE TYPE "ShapeType" AS ENUM ('CIRCLE');

-- CreateEnum
CREATE TYPE "AbsenceReason" AS ENUM ('ILLNESS', 'VACATION', 'LEAVE', 'ART', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('DNI', 'MEDICAL_CERTIFICATE', 'CONTRACT', 'ART', 'EPP_DOCUMENTATION', 'MEDICAL_RECORD', 'INTERNAL_RULES', 'ADDRESS_DECLARATION', 'OTHER');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('REGISTER', 'GOOGLE_LOGIN', 'ADMIN_2FA');

-- CreateEnum
CREATE TYPE "OtpChannel" AS ENUM ('WHATSAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "AdminRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "dni" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "birthDate" DATE NOT NULL,
    "siteId" UUID NOT NULL,
    "cuil" TEXT,
    "hireDate" DATE,
    "position" TEXT,
    "role" "UserRole" NOT NULL,
    "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_dni_key" ON "User"("dni");

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Site_name_key" ON "Site"("name");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

