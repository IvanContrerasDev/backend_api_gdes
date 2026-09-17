# Review package F-001 (BASE 2a347de..HEAD 00091bf)

## Commits
00091bf chore: multi-stage Dockerfile and dev docker-compose (api + postgres with migrations and seed)
e074673 feat: app bootstrap with env validation, uniform error filter, data envelope, guards skeletons and health endpoint
33ed8af feat: initial Prisma schema (User, Site, base enums), migration and provinces seed
b0b64d5 chore: scaffold NestJS project with strict TypeScript, ESLint and Prettier

## Diff stat
 .dockerignore                                      |  11 ++
 .env.example                                       |  37 +++++
 .gitignore                                         |   3 +
 .prettierrc                                        |   5 +
 Dockerfile                                         |  31 +++++
 docker-compose.yml                                 |  61 ++++++++
 eslint.config.mjs                                  |  35 +++++
 nest-cli.json                                      |   8 ++
 package.json                                       |  52 +++++++
 .../migrations/20260916000000_init/migration.sql   | 106 ++++++++++++++
 prisma/migrations/migration_lock.toml              |   3 +
 prisma/schema.prisma                               | 155 +++++++++++++++++++++
 prisma/seed.ts                                     |  29 ++++
 src/app.module.ts                                  |  40 ++++++
 src/common/decorators/roles.decorator.ts           |   9 ++
 src/common/errors/api.exception.ts                 |  15 ++
 src/common/errors/validation-exception.factory.ts  |  26 ++++
 src/common/filters/http-exception.filter.ts        | 121 ++++++++++++++++
 src/common/guards/jwt-auth.guard.ts                |  34 +++++
 src/common/guards/roles.guard.ts                   |  38 +++++
 src/common/interceptors/transform.interceptor.ts   |  14 ++
 src/config/env.validation.ts                       | 131 +++++++++++++++++
 src/health/health.controller.ts                    |   9 ++
 src/main.ts                                        |  14 ++
 src/modules/attendance/.gitkeep                    |   0
 src/modules/auth/.gitkeep                          |   0
 src/modules/dashboard/.gitkeep                     |   0
 src/modules/documents/.gitkeep                     |   0
 src/modules/notifications/.gitkeep                 |   0
 src/modules/storage/.gitkeep                       |   0
 src/modules/structure/.gitkeep                     |   0
 src/modules/users/.gitkeep                         |   0
 src/prisma/prisma.module.ts                        |   9 ++
 src/prisma/prisma.service.ts                       |  13 ++
 test/.gitkeep                                      |   0
 tsconfig.build.json                                |   4 +
 tsconfig.json                                      |  21 +++
 37 files changed, 1034 insertions(+)

## Diff (package-lock.json excluido)
diff --git a/.dockerignore b/.dockerignore
new file mode 100644
index 0000000..df6aa12
--- /dev/null
+++ b/.dockerignore
@@ -0,0 +1,11 @@
+node_modules
+dist
+.git
+docs
+.agents
+*.md
+!README.md
+.env
+.env.*
+!.env.example
+coverage
diff --git a/.env.example b/.env.example
new file mode 100644
index 0000000..f3e83cc
--- /dev/null
+++ b/.env.example
@@ -0,0 +1,37 @@
+# Database
+DATABASE_URL=postgresql://gdes:gdes@localhost:5432/gdes
+
+# JWT
+JWT_ACCESS_SECRET=change-me
+JWT_REFRESH_SECRET=change-me
+
+# Email (Resend). In dev use EMAIL_PROVIDER=log to log instead of sending.
+EMAIL_PROVIDER=log
+RESEND_API_KEY=change-me
+EMAIL_FROM=no-reply@gdes.local
+
+# WhatsApp (Meta Cloud API). In dev use WHATSAPP_PROVIDER=log.
+WHATSAPP_PROVIDER=log
+WHATSAPP_TOKEN=change-me
+WHATSAPP_PHONE_NUMBER_ID=change-me
+
+# Storage (Cloudflare R2, S3-compatible)
+STORAGE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
+STORAGE_BUCKET=gdes-dev
+STORAGE_REGION=auto
+STORAGE_ACCESS_KEY_ID=change-me
+STORAGE_SECRET_ACCESS_KEY=change-me
+
+# Google OAuth
+GOOGLE_CLIENT_ID=change-me
+
+# Business rules (defaults from docs/01-arquitectura-y-stack.md)
+GEOFENCE_TOLERANCE_METERS=100
+OTP_TTL_MINUTES=10
+
+# Apps
+ADMIN_FRONTEND_URL=http://localhost:5173
+MOBILE_DEEP_LINK_SCHEME=gdes
+
+# HTTP
+PORT=3000
diff --git a/.gitignore b/.gitignore
index 45c1abc..7d795af 100644
--- a/.gitignore
+++ b/.gitignore
@@ -27,10 +27,13 @@ yarn-error.log*
 # local env files
 .env*.local
 .env
 
 # vercel
 .vercel
 
 # typescript
 *.tsbuildinfo
 next-env.d.ts
+
+# build output
+/dist
diff --git a/.prettierrc b/.prettierrc
new file mode 100644
index 0000000..2fec1f2
--- /dev/null
+++ b/.prettierrc
@@ -0,0 +1,5 @@
+{
+  "singleQuote": true,
+  "trailingComma": "all",
+  "printWidth": 100
+}
diff --git a/Dockerfile b/Dockerfile
new file mode 100644
index 0000000..6b9c285
--- /dev/null
+++ b/Dockerfile
@@ -0,0 +1,31 @@
+# ---- Base ----
+FROM node:24-alpine AS base
+WORKDIR /app
+
+# ---- Development (used by docker-compose.yml) ----
+FROM base AS development
+ENV NODE_ENV=development
+COPY package.json package-lock.json ./
+RUN npm ci
+COPY . .
+RUN npx prisma generate
+EXPOSE 3000
+CMD ["npm", "run", "start:dev"]
+
+# ---- Build ----
+FROM base AS build
+ENV NODE_ENV=development
+COPY package.json package-lock.json ./
+RUN npm ci
+COPY . .
+RUN npx prisma generate && npm run build
+
+# ---- Production runtime ----
+FROM base AS production
+ENV NODE_ENV=production
+COPY package.json package-lock.json ./
+COPY prisma ./prisma
+RUN npm ci --omit=dev && npx prisma generate
+COPY --from=build /app/dist ./dist
+EXPOSE 3000
+CMD ["node", "dist/main.js"]
diff --git a/docker-compose.yml b/docker-compose.yml
new file mode 100644
index 0000000..724422f
--- /dev/null
+++ b/docker-compose.yml
@@ -0,0 +1,61 @@
+services:
+  postgres:
+    image: postgres:16-alpine
+    container_name: gdes-postgres
+    restart: unless-stopped
+    environment:
+      POSTGRES_USER: gdes
+      POSTGRES_PASSWORD: gdes
+      POSTGRES_DB: gdes
+    ports:
+      - '5432:5432'
+    volumes:
+      - postgres_data:/var/lib/postgresql/data
+    healthcheck:
+      test: ['CMD-SHELL', 'pg_isready -U gdes -d gdes']
+      interval: 5s
+      timeout: 5s
+      retries: 10
+
+  api:
+    build:
+      context: .
+      target: development
+    container_name: gdes-api
+    restart: unless-stopped
+    depends_on:
+      postgres:
+        condition: service_healthy
+    command: sh -c "npx prisma migrate deploy && npx prisma db seed && npm run start:dev"
+    environment:
+      NODE_ENV: development
+      PORT: '3000'
+      DATABASE_URL: postgresql://gdes:gdes@postgres:5432/gdes
+      JWT_ACCESS_SECRET: dev-access-secret-change-me
+      JWT_REFRESH_SECRET: dev-refresh-secret-change-me
+      # External services are mocked in dev (log providers); keys are placeholders.
+      EMAIL_PROVIDER: log
+      WHATSAPP_PROVIDER: log
+      RESEND_API_KEY: dev-placeholder
+      EMAIL_FROM: no-reply@gdes.local
+      WHATSAPP_TOKEN: dev-placeholder
+      WHATSAPP_PHONE_NUMBER_ID: dev-placeholder
+      STORAGE_ENDPOINT: https://dev-placeholder.r2.cloudflarestorage.com
+      STORAGE_BUCKET: gdes-dev
+      STORAGE_REGION: auto
+      STORAGE_ACCESS_KEY_ID: dev-placeholder
+      STORAGE_SECRET_ACCESS_KEY: dev-placeholder
+      GOOGLE_CLIENT_ID: dev-placeholder
+      GEOFENCE_TOLERANCE_METERS: '100'
+      OTP_TTL_MINUTES: '10'
+      ADMIN_FRONTEND_URL: http://localhost:5173
+      MOBILE_DEEP_LINK_SCHEME: gdes
+    ports:
+      - '3000:3000'
+    volumes:
+      - .:/app
+      - api_node_modules:/app/node_modules
+
+volumes:
+  postgres_data:
+  api_node_modules:
diff --git a/eslint.config.mjs b/eslint.config.mjs
new file mode 100644
index 0000000..254e461
--- /dev/null
+++ b/eslint.config.mjs
@@ -0,0 +1,35 @@
+// @ts-check
+import eslint from '@eslint/js';
+import eslintConfigPrettier from 'eslint-config-prettier';
+import globals from 'globals';
+import tseslint from 'typescript-eslint';
+
+export default tseslint.config(
+  {
+    ignores: ['eslint.config.mjs', 'dist/**', 'node_modules/**'],
+  },
+  eslint.configs.recommended,
+  ...tseslint.configs.recommended,
+  eslintConfigPrettier,
+  {
+    languageOptions: {
+      globals: {
+        ...globals.node,
+      },
+      sourceType: 'commonjs',
+      parserOptions: {
+        projectService: true,
+        tsconfigRootDir: import.meta.dirname,
+      },
+    },
+  },
+  {
+    rules: {
+      '@typescript-eslint/no-explicit-any': 'warn',
+      '@typescript-eslint/no-unused-vars': [
+        'error',
+        { argsIgnorePattern: '^_' },
+      ],
+    },
+  },
+);
diff --git a/nest-cli.json b/nest-cli.json
new file mode 100644
index 0000000..f9aa683
--- /dev/null
+++ b/nest-cli.json
@@ -0,0 +1,8 @@
+{
+  "$schema": "https://json.schemastore.org/nest-cli",
+  "collection": "@nestjs/schematics",
+  "sourceRoot": "src",
+  "compilerOptions": {
+    "deleteOutDir": true
+  }
+}
diff --git a/package.json b/package.json
new file mode 100644
index 0000000..4a4c444
--- /dev/null
+++ b/package.json
@@ -0,0 +1,52 @@
+{
+  "name": "gdes-backend-api",
+  "version": "0.0.1",
+  "description": "GdeS backend API (NestJS + Prisma + PostgreSQL)",
+  "private": true,
+  "license": "UNLICENSED",
+  "scripts": {
+    "build": "nest build",
+    "format": "prettier --write \"src/**/*.ts\" \"prisma/**/*.ts\"",
+    "start": "nest start",
+    "start:dev": "nest start --watch",
+    "start:prod": "node dist/main.js",
+    "lint": "eslint \"{src,prisma,test}/**/*.ts\"",
+    "prisma:generate": "prisma generate",
+    "prisma:migrate": "prisma migrate dev",
+    "prisma:deploy": "prisma migrate deploy",
+    "prisma:seed": "prisma db seed"
+  },
+  "prisma": {
+    "seed": "ts-node prisma/seed.ts"
+  },
+  "dependencies": {
+    "@nestjs/common": "^11.0.0",
+    "@nestjs/config": "^4.0.0",
+    "@nestjs/core": "^11.0.0",
+    "@nestjs/platform-express": "^11.0.0",
+    "@prisma/client": "^6.0.0",
+    "class-transformer": "^0.5.1",
+    "class-validator": "^0.14.1",
+    "reflect-metadata": "^0.2.2",
+    "rxjs": "^7.8.1"
+  },
+  "devDependencies": {
+    "@eslint/js": "^9.18.0",
+    "@nestjs/cli": "^11.0.0",
+    "@types/express": "^5.0.0",
+    "@types/node": "^24.0.0",
+    "eslint": "^9.18.0",
+    "eslint-config-prettier": "^10.0.1",
+    "globals": "^16.0.0",
+    "prettier": "^3.4.2",
+    "prisma": "^6.0.0",
+    "ts-node": "^10.9.2",
+    "typescript": "^5.7.0",
+    "typescript-eslint": "^8.20.0"
+  },
+  "allowScripts": {
+    "@prisma/client@6.19.3": true,
+    "@prisma/engines@6.19.3": true,
+    "prisma@6.19.3": true
+  }
+}
diff --git a/prisma/migrations/20260916000000_init/migration.sql b/prisma/migrations/20260916000000_init/migration.sql
new file mode 100644
index 0000000..decc199
--- /dev/null
+++ b/prisma/migrations/20260916000000_init/migration.sql
@@ -0,0 +1,106 @@
+-- CreateSchema
+CREATE SCHEMA IF NOT EXISTS "public";
+
+-- CreateEnum
+CREATE TYPE "UserRole" AS ENUM ('EMPLOYEE', 'TO_BE_ADMIN', 'ADMIN', 'SUPER_ADMIN');
+
+-- CreateEnum
+CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'INACTIVE');
+
+-- CreateEnum
+CREATE TYPE "EntityStatus" AS ENUM ('ACTIVE', 'INACTIVE');
+
+-- CreateEnum
+CREATE TYPE "RecordStatus" AS ENUM ('COMPLETE', 'INCOMPLETE');
+
+-- CreateEnum
+CREATE TYPE "ReviewStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED', 'MANUAL_LOADED');
+
+-- CreateEnum
+CREATE TYPE "IntervalStatus" AS ENUM ('OPEN', 'CLOSED', 'SEMI_CLOSED');
+
+-- CreateEnum
+CREATE TYPE "IntervalType" AS ENUM ('WORK', 'ABSENCE');
+
+-- CreateEnum
+CREATE TYPE "IntervalReviewStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');
+
+-- CreateEnum
+CREATE TYPE "RecordOrigin" AS ENUM ('AUTOMATIC', 'MANUAL');
+
+-- CreateEnum
+CREATE TYPE "AttendanceEventType" AS ENUM ('CHECK_IN', 'CHECK_OUT', 'ABSENCE');
+
+-- CreateEnum
+CREATE TYPE "EventOrigin" AS ENUM ('MOBILE', 'ADMIN');
+
+-- CreateEnum
+CREATE TYPE "TimesheetStatus" AS ENUM ('PENDING', 'LOADED', 'ERROR');
+
+-- CreateEnum
+CREATE TYPE "ShapeType" AS ENUM ('CIRCLE');
+
+-- CreateEnum
+CREATE TYPE "AbsenceReason" AS ENUM ('ILLNESS', 'VACATION', 'LEAVE', 'ART', 'OTHER');
+
+-- CreateEnum
+CREATE TYPE "DocumentType" AS ENUM ('DNI', 'MEDICAL_CERTIFICATE', 'CONTRACT', 'ART', 'EPP_DOCUMENTATION', 'MEDICAL_RECORD', 'INTERNAL_RULES', 'ADDRESS_DECLARATION', 'OTHER');
+
+-- CreateEnum
+CREATE TYPE "OtpPurpose" AS ENUM ('REGISTER', 'GOOGLE_LOGIN', 'ADMIN_2FA');
+
+-- CreateEnum
+CREATE TYPE "OtpChannel" AS ENUM ('WHATSAPP', 'EMAIL');
+
+-- CreateEnum
+CREATE TYPE "AdminRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
+
+-- CreateTable
+CREATE TABLE "User" (
+    "id" UUID NOT NULL,
+    "firstName" TEXT NOT NULL,
+    "lastName" TEXT NOT NULL,
+    "email" TEXT NOT NULL,
+    "passwordHash" TEXT NOT NULL,
+    "phone" TEXT NOT NULL,
+    "dni" TEXT NOT NULL,
+    "employeeId" TEXT NOT NULL,
+    "address" TEXT NOT NULL,
+    "birthDate" DATE NOT NULL,
+    "siteId" UUID NOT NULL,
+    "cuil" TEXT,
+    "hireDate" DATE,
+    "position" TEXT,
+    "role" "UserRole" NOT NULL,
+    "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
+    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
+    "updatedAt" TIMESTAMP(3) NOT NULL,
+
+    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
+);
+
+-- CreateTable
+CREATE TABLE "Site" (
+    "id" UUID NOT NULL,
+    "name" TEXT NOT NULL,
+    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
+    "updatedAt" TIMESTAMP(3) NOT NULL,
+
+    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
+);
+
+-- CreateIndex
+CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
+
+-- CreateIndex
+CREATE UNIQUE INDEX "User_dni_key" ON "User"("dni");
+
+-- CreateIndex
+CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");
+
+-- CreateIndex
+CREATE UNIQUE INDEX "Site_name_key" ON "Site"("name");
+
+-- AddForeignKey
+ALTER TABLE "User" ADD CONSTRAINT "User_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
+
diff --git a/prisma/migrations/migration_lock.toml b/prisma/migrations/migration_lock.toml
new file mode 100644
index 0000000..044d57c
--- /dev/null
+++ b/prisma/migrations/migration_lock.toml
@@ -0,0 +1,3 @@
+# Please do not edit this file manually
+# It should be added in your version-control system (e.g., Git)
+provider = "postgresql"
diff --git a/prisma/schema.prisma b/prisma/schema.prisma
new file mode 100644
index 0000000..0a9ee32
--- /dev/null
+++ b/prisma/schema.prisma
@@ -0,0 +1,155 @@
+// GdeS — initial schema (F-001): User, Site and base enums.
+// Source of truth: docs/02-modelo-de-datos.md
+
+generator client {
+  provider = "prisma-client-js"
+}
+
+datasource db {
+  provider = "postgresql"
+  url      = env("DATABASE_URL")
+}
+
+model User {
+  id            String        @id @default(uuid()) @db.Uuid
+  firstName     String
+  lastName      String
+  email         String        @unique
+  passwordHash  String
+  phone         String
+  dni           String        @unique
+  employeeId    String        @unique
+  address       String
+  birthDate     DateTime      @db.Date
+  siteId        String        @db.Uuid
+  site          Site          @relation(fields: [siteId], references: [id])
+  cuil          String?
+  hireDate      DateTime?     @db.Date
+  position      String?
+  role          UserRole
+  accountStatus AccountStatus @default(ACTIVE)
+  createdAt     DateTime      @default(now())
+  updatedAt     DateTime      @updatedAt
+}
+
+model Site {
+  id        String   @id @default(uuid()) @db.Uuid
+  name      String   @unique
+  users     User[]
+  createdAt DateTime @default(now())
+  updatedAt DateTime @updatedAt
+}
+
+// Base enums — central definition (docs/02-modelo-de-datos.md, spec §89).
+// Enums without a model yet are used by features F-002+.
+
+enum UserRole {
+  EMPLOYEE
+  TO_BE_ADMIN
+  ADMIN
+  SUPER_ADMIN
+}
+
+enum AccountStatus {
+  ACTIVE
+  INACTIVE
+}
+
+enum EntityStatus {
+  ACTIVE
+  INACTIVE
+}
+
+enum RecordStatus {
+  COMPLETE
+  INCOMPLETE
+}
+
+enum ReviewStatus {
+  NONE
+  PENDING
+  APPROVED
+  REJECTED
+  MANUAL_LOADED
+}
+
+enum IntervalStatus {
+  OPEN
+  CLOSED
+  SEMI_CLOSED
+}
+
+enum IntervalType {
+  WORK
+  ABSENCE
+}
+
+enum IntervalReviewStatus {
+  NONE
+  PENDING
+  APPROVED
+  REJECTED
+}
+
+enum RecordOrigin {
+  AUTOMATIC
+  MANUAL
+}
+
+enum AttendanceEventType {
+  CHECK_IN
+  CHECK_OUT
+  ABSENCE
+}
+
+enum EventOrigin {
+  MOBILE
+  ADMIN
+}
+
+enum TimesheetStatus {
+  PENDING
+  LOADED
+  ERROR
+}
+
+enum ShapeType {
+  CIRCLE
+}
+
+enum AbsenceReason {
+  ILLNESS
+  VACATION
+  LEAVE
+  ART
+  OTHER
+}
+
+enum DocumentType {
+  DNI
+  MEDICAL_CERTIFICATE
+  CONTRACT
+  ART
+  EPP_DOCUMENTATION
+  MEDICAL_RECORD
+  INTERNAL_RULES
+  ADDRESS_DECLARATION
+  OTHER
+}
+
+enum OtpPurpose {
+  REGISTER
+  GOOGLE_LOGIN
+  ADMIN_2FA
+}
+
+enum OtpChannel {
+  WHATSAPP
+  EMAIL
+}
+
+enum AdminRequestStatus {
+  PENDING
+  APPROVED
+  REJECTED
+}
diff --git a/prisma/seed.ts b/prisma/seed.ts
new file mode 100644
index 0000000..5879068
--- /dev/null
+++ b/prisma/seed.ts
@@ -0,0 +1,29 @@
+import { PrismaClient } from '@prisma/client';
+
+const prisma = new PrismaClient();
+
+/**
+ * Seed: provinces catalog (sites). Fixed list shared with mobile
+ * (`mobile_app_gdes/constants/data.ts`). Idempotent (upsert by name).
+ */
+const SITES = ['San Juan', 'Mendoza', 'Catamarca', 'La Rioja', 'Salta', 'San Luis'];
+
+async function main(): Promise<void> {
+  for (const name of SITES) {
+    await prisma.site.upsert({
+      where: { name },
+      update: {},
+      create: { name },
+    });
+  }
+  console.log(`Seed complete: ${SITES.length} sites (provinces).`);
+}
+
+main()
+  .catch((error: unknown) => {
+    console.error('Seed failed:', error);
+    process.exitCode = 1;
+  })
+  .finally(() => {
+    void prisma.$disconnect();
+  });
diff --git a/src/app.module.ts b/src/app.module.ts
new file mode 100644
index 0000000..a9c4abf
--- /dev/null
+++ b/src/app.module.ts
@@ -0,0 +1,40 @@
+import { Module, ValidationPipe } from '@nestjs/common';
+import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
+import { ConfigModule } from '@nestjs/config';
+import { validateEnv } from './config/env.validation';
+import { PrismaModule } from './prisma/prisma.module';
+import { HttpExceptionFilter } from './common/filters/http-exception.filter';
+import { TransformInterceptor } from './common/interceptors/transform.interceptor';
+import { validationExceptionFactory } from './common/errors/validation-exception.factory';
+import { HealthController } from './health/health.controller';
+
+@Module({
+  imports: [
+    ConfigModule.forRoot({
+      isGlobal: true,
+      validate: validateEnv,
+    }),
+    PrismaModule,
+  ],
+  controllers: [HealthController],
+  providers: [
+    {
+      provide: APP_FILTER,
+      useClass: HttpExceptionFilter,
+    },
+    {
+      provide: APP_INTERCEPTOR,
+      useClass: TransformInterceptor,
+    },
+    {
+      provide: APP_PIPE,
+      useFactory: () =>
+        new ValidationPipe({
+          whitelist: true,
+          transform: true,
+          exceptionFactory: validationExceptionFactory,
+        }),
+    },
+  ],
+})
+export class AppModule {}
diff --git a/src/common/decorators/roles.decorator.ts b/src/common/decorators/roles.decorator.ts
new file mode 100644
index 0000000..effe36e
--- /dev/null
+++ b/src/common/decorators/roles.decorator.ts
@@ -0,0 +1,9 @@
+import { SetMetadata } from '@nestjs/common';
+
+export const ROLES_KEY = 'roles';
+
+/**
+ * Declares which roles may access a route, e.g. `@Roles('ADMIN', 'SUPER_ADMIN')`.
+ * Role values come from the `UserRole` enum (docs/02-modelo-de-datos.md).
+ */
+export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
diff --git a/src/common/errors/api.exception.ts b/src/common/errors/api.exception.ts
new file mode 100644
index 0000000..c61c9d2
--- /dev/null
+++ b/src/common/errors/api.exception.ts
@@ -0,0 +1,15 @@
+import { HttpException, HttpStatus } from '@nestjs/common';
+
+/**
+ * Domain/API exception carrying an explicit error code from the catalog
+ * (docs/07-convenciones.md). `message` must be in Spanish (user-facing).
+ */
+export class ApiException extends HttpException {
+  constructor(
+    status: HttpStatus,
+    public readonly code: string,
+    message: string,
+  ) {
+    super({ code, message }, status);
+  }
+}
diff --git a/src/common/errors/validation-exception.factory.ts b/src/common/errors/validation-exception.factory.ts
new file mode 100644
index 0000000..df189e6
--- /dev/null
+++ b/src/common/errors/validation-exception.factory.ts
@@ -0,0 +1,26 @@
+import { HttpStatus, ValidationError } from '@nestjs/common';
+import { ApiException } from './api.exception';
+
+function flattenMessages(errors: ValidationError[], parent = ''): string[] {
+  return errors.flatMap((error) => {
+    const property = parent ? `${parent}.${error.property}` : error.property;
+    const own = Object.values(error.constraints ?? {}).map(
+      (message) => `${property}: ${message}`,
+    );
+    const children = error.children?.length ? flattenMessages(error.children, property) : [];
+    return [...own, ...children];
+  });
+}
+
+/**
+ * Turns class-validator errors into the uniform 422 VALIDATION_ERROR payload.
+ * Message in Spanish per docs/07-convenciones.md.
+ */
+export function validationExceptionFactory(errors: ValidationError[]): ApiException {
+  const details = flattenMessages(errors);
+  const message =
+    details.length > 0
+      ? `Error de validación: ${details.join('; ')}`
+      : 'Error de validación en los datos enviados';
+  return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', message);
+}
diff --git a/src/common/filters/http-exception.filter.ts b/src/common/filters/http-exception.filter.ts
new file mode 100644
index 0000000..3c0b0d5
--- /dev/null
+++ b/src/common/filters/http-exception.filter.ts
@@ -0,0 +1,121 @@
+import {
+  ArgumentsHost,
+  Catch,
+  ExceptionFilter,
+  HttpException,
+  HttpStatus,
+  Logger,
+} from '@nestjs/common';
+import { Request, Response } from 'express';
+
+interface ErrorBody {
+  error: {
+    code: string;
+    message: string;
+    retryable: boolean;
+  };
+}
+
+const RETRYABLE_STATUSES = new Set([
+  HttpStatus.TOO_MANY_REQUESTS,
+  HttpStatus.INTERNAL_SERVER_ERROR,
+  HttpStatus.BAD_GATEWAY,
+  HttpStatus.SERVICE_UNAVAILABLE,
+  HttpStatus.GATEWAY_TIMEOUT,
+]);
+
+/**
+ * Fallback error codes per HTTP status, from the catalog in docs/07-convenciones.md.
+ * Feature code should prefer throwing `ApiException` with an explicit code.
+ */
+const DEFAULT_CODE_BY_STATUS: Record<number, string> = {
+  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
+  [HttpStatus.UNAUTHORIZED]: 'INVALID_TOKEN',
+  [HttpStatus.FORBIDDEN]: 'ROLE_NOT_ALLOWED',
+  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
+  [HttpStatus.UNPROCESSABLE_ENTITY]: 'VALIDATION_ERROR',
+  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_ATTEMPTS',
+};
+
+const DEFAULT_MESSAGE_BY_STATUS: Record<number, string> = {
+  [HttpStatus.BAD_REQUEST]: 'Solicitud inválida',
+  [HttpStatus.UNAUTHORIZED]: 'No autorizado',
+  [HttpStatus.FORBIDDEN]: 'Acceso denegado',
+  [HttpStatus.NOT_FOUND]: 'Recurso no encontrado',
+  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Error de validación en los datos enviados',
+  [HttpStatus.TOO_MANY_REQUESTS]: 'Demasiados intentos, probá más tarde',
+};
+
+/**
+ * Framework-generated messages (e.g. "Cannot GET /x") are in English;
+ * user-facing messages must be Spanish (docs/07-convenciones.md), so the
+ * filter replaces them with the Spanish default for the status.
+ */
+function isFrameworkMessage(message: string): boolean {
+  return /^Cannot [A-Z]+ /.test(message);
+}
+
+/**
+ * Global exception filter: every error leaves the API as
+ * `{ error: { code, message, retryable } }` (docs/07-convenciones.md).
+ * `message` is user-facing, in Spanish.
+ */
+@Catch()
+export class HttpExceptionFilter implements ExceptionFilter {
+  private readonly logger = new Logger(HttpExceptionFilter.name);
+
+  catch(exception: unknown, host: ArgumentsHost): void {
+    const ctx = host.switchToHttp();
+    const response = ctx.getResponse<Response>();
+    const request = ctx.getRequest<Request>();
+
+    const status =
+      exception instanceof HttpException
+        ? exception.getStatus()
+        : HttpStatus.INTERNAL_SERVER_ERROR;
+
+    const body = this.buildBody(exception, status);
+
+    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
+      this.logger.error(
+        `${request.method} ${request.url} -> ${status}`,
+        exception instanceof Error ? exception.stack : String(exception),
+      );
+    }
+
+    response.status(status).json(body);
+  }
+
+  private buildBody(exception: unknown, status: number): ErrorBody {
+    let code = DEFAULT_CODE_BY_STATUS[status] ?? 'INTERNAL_ERROR';
+    let message =
+      status >= HttpStatus.INTERNAL_SERVER_ERROR
+        ? 'Error interno del servidor'
+        : (DEFAULT_MESSAGE_BY_STATUS[status] ?? 'Error inesperado');
+
+    if (exception instanceof HttpException) {
+      const response = exception.getResponse();
+      if (typeof response === 'object' && response !== null) {
+        const payload = response as Record<string, unknown>;
+        if (typeof payload.code === 'string') {
+          code = payload.code;
+        }
+        if (typeof payload.message === 'string' && !isFrameworkMessage(payload.message)) {
+          message = payload.message;
+        }
+      } else if (typeof response === 'string' && response.length > 0) {
+        if (!isFrameworkMessage(response)) {
+          message = response;
+        }
+      }
+    }
+
+    return {
+      error: {
+        code,
+        message,
+        retryable: RETRYABLE_STATUSES.has(status),
+      },
+    };
+  }
+}
diff --git a/src/common/guards/jwt-auth.guard.ts b/src/common/guards/jwt-auth.guard.ts
new file mode 100644
index 0000000..5f902f6
--- /dev/null
+++ b/src/common/guards/jwt-auth.guard.ts
@@ -0,0 +1,34 @@
+import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
+import { Request } from 'express';
+import { ApiException } from '../errors/api.exception';
+
+export interface AuthenticatedUser {
+  id: string;
+  role: string;
+}
+
+export interface AuthenticatedRequest extends Request {
+  user?: AuthenticatedUser;
+}
+
+/**
+ * Skeleton guard (F-001). F-002 (auth) will verify the JWT signature/claims
+ * and populate `request.user`. For now it always rejects: no endpoint is
+ * protected yet, and any accidental use fails closed.
+ */
+@Injectable()
+export class JwtAuthGuard implements CanActivate {
+  canActivate(context: ExecutionContext): boolean {
+    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
+    const header = request.headers.authorization;
+
+    // TODO(F-002): verify JWT with JWT_ACCESS_SECRET and populate request.user.
+    void header;
+
+    throw new ApiException(
+      HttpStatus.UNAUTHORIZED,
+      'INVALID_TOKEN',
+      'Token de autenticación ausente o inválido',
+    );
+  }
+}
diff --git a/src/common/guards/roles.guard.ts b/src/common/guards/roles.guard.ts
new file mode 100644
index 0000000..e1ee631
--- /dev/null
+++ b/src/common/guards/roles.guard.ts
@@ -0,0 +1,38 @@
+import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
+import { Reflector } from '@nestjs/core';
+import { ROLES_KEY } from '../decorators/roles.decorator';
+import { ApiException } from '../errors/api.exception';
+import { AuthenticatedRequest } from './jwt-auth.guard';
+
+/**
+ * Skeleton guard (F-001). Reads the roles declared via `@Roles(...)` and
+ * checks them against `request.user.role` (populated by `JwtAuthGuard`).
+ */
+@Injectable()
+export class RolesGuard implements CanActivate {
+  constructor(private readonly reflector: Reflector) {}
+
+  canActivate(context: ExecutionContext): boolean {
+    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
+      context.getHandler(),
+      context.getClass(),
+    ]);
+
+    if (!requiredRoles || requiredRoles.length === 0) {
+      return true;
+    }
+
+    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
+    const user = request.user;
+
+    if (!user || !requiredRoles.includes(user.role)) {
+      throw new ApiException(
+        HttpStatus.FORBIDDEN,
+        'ROLE_NOT_ALLOWED',
+        'No tenés permisos para acceder a este recurso',
+      );
+    }
+
+    return true;
+  }
+}
diff --git a/src/common/interceptors/transform.interceptor.ts b/src/common/interceptors/transform.interceptor.ts
new file mode 100644
index 0000000..c5e69fc
--- /dev/null
+++ b/src/common/interceptors/transform.interceptor.ts
@@ -0,0 +1,14 @@
+import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
+import { Observable, map } from 'rxjs';
+
+/**
+ * Wraps every successful response in `{ data: ... }` (docs/07-convenciones.md).
+ * Controllers return the plain payload; list endpoints may return
+ * `{ data: [...], pagination }`-shaped objects from their services.
+ */
+@Injectable()
+export class TransformInterceptor implements NestInterceptor {
+  intercept(_context: ExecutionContext, next: CallHandler): Observable<{ data: unknown }> {
+    return next.handle().pipe(map((payload: unknown) => ({ data: payload ?? null })));
+  }
+}
diff --git a/src/config/env.validation.ts b/src/config/env.validation.ts
new file mode 100644
index 0000000..9fd04ee
--- /dev/null
+++ b/src/config/env.validation.ts
@@ -0,0 +1,131 @@
+import {
+  IsInt,
+  IsNotEmpty,
+  IsOptional,
+  IsString,
+  IsUrl,
+  Max,
+  Min,
+} from 'class-validator';
+import { plainToInstance } from 'class-transformer';
+import { validateSync } from 'class-validator';
+
+/**
+ * Required environment variables, validated at boot (fail fast).
+ * Source of truth: docs/01-arquitectura-y-stack.md ("Variables de entorno (mínimo)").
+ */
+class EnvironmentVariables {
+  @IsString()
+  @IsNotEmpty()
+  DATABASE_URL!: string;
+
+  @IsString()
+  @IsNotEmpty()
+  JWT_ACCESS_SECRET!: string;
+
+  @IsString()
+  @IsNotEmpty()
+  JWT_REFRESH_SECRET!: string;
+
+  @IsString()
+  @IsNotEmpty()
+  RESEND_API_KEY!: string;
+
+  @IsString()
+  @IsNotEmpty()
+  EMAIL_FROM!: string;
+
+  @IsString()
+  @IsNotEmpty()
+  WHATSAPP_TOKEN!: string;
+
+  @IsString()
+  @IsNotEmpty()
+  WHATSAPP_PHONE_NUMBER_ID!: string;
+
+  @IsString()
+  @IsNotEmpty()
+  STORAGE_ENDPOINT!: string;
+
+  @IsString()
+  @IsNotEmpty()
+  STORAGE_BUCKET!: string;
+
+  @IsString()
+  @IsNotEmpty()
+  STORAGE_REGION!: string;
+
+  @IsString()
+  @IsNotEmpty()
+  STORAGE_ACCESS_KEY_ID!: string;
+
+  @IsString()
+  @IsNotEmpty()
+  STORAGE_SECRET_ACCESS_KEY!: string;
+
+  @IsString()
+  @IsNotEmpty()
+  GOOGLE_CLIENT_ID!: string;
+
+  @IsInt()
+  @Min(0)
+  GEOFENCE_TOLERANCE_METERS!: number;
+
+  @IsInt()
+  @Min(1)
+  @Max(1440)
+  OTP_TTL_MINUTES!: number;
+
+  @IsUrl({ require_tld: false })
+  ADMIN_FRONTEND_URL!: string;
+
+  @IsString()
+  @IsNotEmpty()
+  MOBILE_DEEP_LINK_SCHEME!: string;
+
+  /** Dev switch: providers log to console instead of calling external services. */
+  @IsString()
+  @IsNotEmpty()
+  EMAIL_PROVIDER!: string;
+
+  @IsString()
+  @IsNotEmpty()
+  WHATSAPP_PROVIDER!: string;
+
+  @IsInt()
+  @Min(1)
+  @Max(65535)
+  PORT!: number;
+
+  @IsString()
+  @IsOptional()
+  NODE_ENV?: string;
+}
+
+export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
+  const merged: Record<string, unknown> = {
+    GEOFENCE_TOLERANCE_METERS: '100',
+    OTP_TTL_MINUTES: '10',
+    EMAIL_PROVIDER: 'log',
+    WHATSAPP_PROVIDER: 'log',
+    PORT: '3000',
+    ...config,
+  };
+
+  const validated = plainToInstance(EnvironmentVariables, merged, {
+    enableImplicitConversion: true,
+  });
+
+  const errors = validateSync(validated, { skipMissingProperties: false });
+
+  if (errors.length > 0) {
+    const details = errors
+      .map((error) => `${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`)
+      .join('; ');
+    throw new Error(
+      `Invalid environment configuration. Fix the following variables: ${details}`,
+    );
+  }
+
+  return validated;
+}
diff --git a/src/health/health.controller.ts b/src/health/health.controller.ts
new file mode 100644
index 0000000..c3d14da
--- /dev/null
+++ b/src/health/health.controller.ts
@@ -0,0 +1,9 @@
+import { Controller, Get } from '@nestjs/common';
+
+@Controller('health')
+export class HealthController {
+  @Get()
+  check(): { status: string } {
+    return { status: 'ok' };
+  }
+}
diff --git a/src/main.ts b/src/main.ts
new file mode 100644
index 0000000..f651a74
--- /dev/null
+++ b/src/main.ts
@@ -0,0 +1,14 @@
+import { NestFactory } from '@nestjs/core';
+import { ConfigService } from '@nestjs/config';
+import { Logger } from '@nestjs/common';
+import { AppModule } from './app.module';
+
+async function bootstrap(): Promise<void> {
+  const app = await NestFactory.create(AppModule);
+  const config = app.get(ConfigService);
+  const port = config.get<number>('PORT', 3000);
+  await app.listen(port);
+  new Logger('Bootstrap').log(`API listening on port ${port}`);
+}
+
+void bootstrap();
diff --git a/src/modules/attendance/.gitkeep b/src/modules/attendance/.gitkeep
new file mode 100644
index 0000000..e69de29
diff --git a/src/modules/auth/.gitkeep b/src/modules/auth/.gitkeep
new file mode 100644
index 0000000..e69de29
diff --git a/src/modules/dashboard/.gitkeep b/src/modules/dashboard/.gitkeep
new file mode 100644
index 0000000..e69de29
diff --git a/src/modules/documents/.gitkeep b/src/modules/documents/.gitkeep
new file mode 100644
index 0000000..e69de29
diff --git a/src/modules/notifications/.gitkeep b/src/modules/notifications/.gitkeep
new file mode 100644
index 0000000..e69de29
diff --git a/src/modules/storage/.gitkeep b/src/modules/storage/.gitkeep
new file mode 100644
index 0000000..e69de29
diff --git a/src/modules/structure/.gitkeep b/src/modules/structure/.gitkeep
new file mode 100644
index 0000000..e69de29
diff --git a/src/modules/users/.gitkeep b/src/modules/users/.gitkeep
new file mode 100644
index 0000000..e69de29
diff --git a/src/prisma/prisma.module.ts b/src/prisma/prisma.module.ts
new file mode 100644
index 0000000..7207426
--- /dev/null
+++ b/src/prisma/prisma.module.ts
@@ -0,0 +1,9 @@
+import { Global, Module } from '@nestjs/common';
+import { PrismaService } from './prisma.service';
+
+@Global()
+@Module({
+  providers: [PrismaService],
+  exports: [PrismaService],
+})
+export class PrismaModule {}
diff --git a/src/prisma/prisma.service.ts b/src/prisma/prisma.service.ts
new file mode 100644
index 0000000..829d52f
--- /dev/null
+++ b/src/prisma/prisma.service.ts
@@ -0,0 +1,13 @@
+import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
+import { PrismaClient } from '@prisma/client';
+
+@Injectable()
+export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
+  async onModuleInit(): Promise<void> {
+    await this.$connect();
+  }
+
+  async onModuleDestroy(): Promise<void> {
+    await this.$disconnect();
+  }
+}
diff --git a/test/.gitkeep b/test/.gitkeep
new file mode 100644
index 0000000..e69de29
diff --git a/tsconfig.build.json b/tsconfig.build.json
new file mode 100644
index 0000000..e97f053
--- /dev/null
+++ b/tsconfig.build.json
@@ -0,0 +1,4 @@
+{
+  "extends": "./tsconfig.json",
+  "exclude": ["node_modules", "test", "dist", "prisma", "**/*spec.ts"]
+}
diff --git a/tsconfig.json b/tsconfig.json
new file mode 100644
index 0000000..11d13a9
--- /dev/null
+++ b/tsconfig.json
@@ -0,0 +1,21 @@
+{
+  "compilerOptions": {
+    "module": "commonjs",
+    "declaration": true,
+    "removeComments": true,
+    "emitDecoratorMetadata": true,
+    "experimentalDecorators": true,
+    "allowSyntheticDefaultImports": true,
+    "esModuleInterop": true,
+    "target": "ES2023",
+    "sourceMap": true,
+    "outDir": "./dist",
+    "baseUrl": "./",
+    "incremental": true,
+    "skipLibCheck": true,
+    "strict": true,
+    "strictNullChecks": true,
+    "noImplicitAny": true,
+    "forceConsistentCasingInFileNames": true
+  }
+}
