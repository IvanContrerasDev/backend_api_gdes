# F-001 — Reporte de implementación: Bootstrap del backend

**Fecha:** 2026-09-16 · **Branch:** `feat/F-001-bootstrap` (BASE = 2a347de) · **Estado:** done_with_concerns (verificación de Docker pendiente, sin Docker en el entorno)

## Archivos creados

**Tooling / scaffold**
- `package.json` / `package-lock.json` — NestJS 11, Prisma 6.19.3, class-validator/class-transformer, ESLint 9 (flat) + Prettier, TypeScript 5 estricto. Incluye `allowScripts` (npm 12 bloquea postinstall por defecto; aprobados `@prisma/client`, `@prisma/engines`, `prisma` — necesario para generar engines/client).
- `tsconfig.json` (`strict: true`), `tsconfig.build.json`, `nest-cli.json`, `eslint.config.mjs`, `.prettierrc`
- `.gitignore` (+ `/dist`), `test/.gitkeep`, `src/modules/*/.gitkeep` (8 módulos del doc 01, placeholders)

**Prisma**
- `prisma/schema.prisma` — modelos `User` y `Site` + los 18 enums de la definición central (doc 02)
- `prisma/migrations/20260916000000_init/migration.sql` + `migration_lock.toml` — generada offline con `prisma migrate diff --from-empty` (no había DB/Docker al crearla); aplicada y verificada con `migrate deploy`
- `prisma/seed.ts` — upsert idempotente de las 6 provincias (San Juan, Mendoza, Catamarca, La Rioja, Salta, San Luis)

**Código (`src/`)**
- `main.ts`, `app.module.ts` — ConfigModule global con validación, APP_FILTER/APP_INTERCEPTOR/APP_PIPE globales
- `config/env.validation.ts` — validación de env al boot con class-validator (fail fast)
- `prisma/prisma.module.ts` (@Global), `prisma/prisma.service.ts`
- `common/filters/http-exception.filter.ts` — `{ error: { code, message, retryable } }`, mensajes en español, `retryable: true` solo en 429/5xx, reemplaza mensajes del framework en inglés ("Cannot GET /x") por defaults en español
- `common/interceptors/transform.interceptor.ts` — envoltorio `{ data }`
- `common/errors/api.exception.ts` — `ApiException(status, code, message)` para features
- `common/errors/validation-exception.factory.ts` — ValidationPipe → 422 `VALIDATION_ERROR`
- `common/guards/jwt-auth.guard.ts` — esqueleto, falla cerrado (401 `INVALID_TOKEN`) hasta F-002
- `common/guards/roles.guard.ts` + `common/decorators/roles.decorator.ts` — esqueleto con `@Roles(...)` (403 `ROLE_NOT_ALLOWED`)
- `health/health.controller.ts` — `GET /health`

**Docker**
- `Dockerfile` multi-stage (development / build / production, node:24-alpine)
- `docker-compose.yml` — `postgres:16-alpine` (healthcheck) + `api` (target development, command: `prisma migrate deploy && prisma db seed && start:dev`, hot-reload con volume)
- `.dockerignore`, `.env.example`

## Decisiones tomadas (fuera de lo literal de los docs, justificadas)

1. **Enums**: se incluyeron los 18 enums de la "definición central" del doc 02 (no solo los de `User`/`Site`), leyendo "enums base" del spec como ese conjunto cerrado. No agregan tablas ni acoplamiento; evitan churn en F-002+.
2. **Timestamps**: `createdAt`/`updatedAt` agregados a `User` y `Site` por la regla global del doc 02 ("en todas las entidades salvo que se indique lo contrario"); las tablas por entidad no los listan ni los excluyen.
3. **Env requeridas**: TODAS las variables del listado "mínimo" del doc 01 son requeridas al boot (con defaults solo donde el doc los define: `GEOFENCE_TOLERANCE_METERS=100`, `OTP_TTL_MINUTES=10`). En dev, docker-compose/`.env.example` proveen placeholders porque los providers son `log`.
4. **`EMAIL_PROVIDER`/`WHATSAPP_PROVIDER`**: el doc 01 los menciona en la sección Docker pero no están en el listado de variables; se agregaron como env con default `log`.
5. **`PORT`** (default 3000) y **`NODE_ENV`** (opcional) agregados — necesarios para el runtime.
6. **Mensajes de framework en inglés**: el filtro detecta "Cannot GET /x" (Nest router) y lo reemplaza por el default español del status, para cumplir la convención de `error.message` en español.
7. **JwtAuthGuard falla cerrado**: como es esqueleto y F-002 implementa verificación real, cualquier uso accidental devuelve 401 en vez de dejar pasar tráfico.
8. **Migración inicial generada con `prisma migrate diff`** (equivalente a `migrate dev` pero sin DB); aplicada y validada después contra Postgres real vía `migrate deploy`.

## Verificación (comandos y resultados)

Entorno: Node v24.19.0, npm 12.0.2. **Docker NO disponible** en este entorno (ni CLI ni postgres local). Para verificar contra una Postgres real se usó `npx prisma dev` (Prisma Postgres local, PGlite, puerto 51214).

| Verificación | Comando | Resultado |
|---|---|---|
| Compila | `npm run build` | ✓ sin errores |
| Lint | `npm run lint` | ✓ 0 errores/warnings |
| Boot fail-fast sin env | `node dist/main.js` | ✓ exit 1: "Invalid environment configuration. Fix the following variables: DATABASE_URL..., JWT_ACCESS_SECRET..., ..." (lista todas las faltantes) |
| Migraciones | `prisma migrate deploy` | ✓ "All migrations have been successfully applied" |
| Seed | `prisma db seed` | ✓ "Seed complete: 6 sites"; verificado en DB: `["Catamarca","La Rioja","Mendoza","Salta","San Juan","San Luis"]` (count 6, idempotente por upsert) |
| Health | `GET /health` | ✓ `{"data":{"status":"ok"}}` HTTP 200 |
| Error 404 | `GET /nonexistent` | ✓ `{"error":{"code":"NOT_FOUND","message":"Recurso no encontrado","retryable":false}}` |
| Error de dominio | `ApiException(409, USER_ALREADY_EXISTS, ...)` (app scratch temporal) | ✓ `{"error":{"code":"USER_ALREADY_EXISTS","message":"El email ya está registrado","retryable":false}}` |
| Error no controlado | `throw new Error('kaboom')` (scratch) | ✓ 500 `{"error":{"code":"INTERNAL_ERROR","message":"Error interno del servidor","retryable":true}}` (no filtra el mensaje interno) |
| ValidationPipe | POST con body inválido (scratch) | ✓ 422 `{"error":{"code":"VALIDATION_ERROR","message":"Error de validación: age: ...","retryable":false}}` |
| Respuesta exitosa | cualquier payload | ✓ envuelta en `{ data: ... }` |
| `npm run start:dev` | contra la Postgres local | ✓ "Nest application successfully started" |
| `docker compose up` | — | ⚠️ **PENDIENTE verificación manual** (Docker no disponible en el entorno). El servicio `api` corre `prisma migrate deploy && prisma db seed && npm run start:dev` tras el healthcheck de postgres; el Dockerfile (development/build/production) no pudo build-earse. |

Las pruebas de error/validación se hicieron con una app scratch temporal (`src/__smoke__.ts`) que reusaba filtro/interceptor/pipe reales; se borró después de correr (no queda en el repo).

## Commits (main..HEAD)

- `b0b64d5` chore: scaffold NestJS project with strict TypeScript, ESLint and Prettier
- `33ed8af` feat: initial Prisma schema (User, Site, base enums), migration and provinces seed
- `e074673` feat: app bootstrap with env validation, uniform error filter, data envelope, guards skeletons and health endpoint
- `00091bf` chore: multi-stage Dockerfile and dev docker-compose (api + postgres with migrations and seed)

## Dudas / concerns

1. **Docker sin verificar** (único criterio de aceptación no verificado): `docker compose up` y el build del `Dockerfile`. Verificación manual sugerida: `docker compose up --build` → `curl localhost:3000/health`.
2. **Warning de deprecación**: `package.json#prisma` (config de seed) está deprecado hacia Prisma 7; migrar a `prisma.config.ts` cuando se actualice (hoy Prisma 6.19.3, funciona).
3. **npm 12 + `allowScripts`**: quedó fijado en `package.json` con versiones exactas de prisma; si se actualiza prisma hay que re-aprobar (`npm install-scripts approve`). En Docker (`npm ci`) conviene verificar que los postinstall corran (npm 12 respeta `allowScripts` del package.json).
4. **Mensajes de constraints de class-validator en inglés**: el detalle dentro del 422 (`age must be an integer number`) es inglés por defecto de la librería; el mensaje principal queda en español. Las features pueden poner `message` en español por campo si se quiere español completo.
5. **`prisma dev` (PGlite)**: la URL directa `postgres://` del proxy necesitó `pgbouncer=true` para queries del client (quirk del proxy, no del schema); con postgres:16 real de compose no aplica.
6. No se modificó ningún doc de `backend_api_gdes/docs/` (no se encontraron errores objetivos; las decisiones 3/4 arriba quedan registradas acá por si el leader quiere reflejarlas en doc 01).

## Fix round 1 (2026-09-16)

1. **Dockerfile stage `production`**: eliminado `npx prisma generate` (bajaría un CLI no pineado o fallaría sin red, ya que `prisma` es devDependency excluida por `--omit=dev`). Ahora el cliente generado se copia desde el stage `build` (`COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma`), pineado a las versiones del lockfile y mismo base image. Verificación estática: `node_modules/.prisma/client` existe localmente tras `prisma generate` en el stage con deps completas; mismo `package-lock.json` y base `node:24-alpine` en ambos stages → engines compatibles. Stage production autocontenido. Docker no disponible → build de imagen sigue pendiente de verificación manual. Commit `014c066`.
2. **Documentación "16 enums" → 18**: corregido en este reporte (2 ocurrencias: lista de archivos y decisión #1) y en el Registro de implementación del task spec. Verificado con `grep -c "^enum" prisma/schema.prisma` → 18. (Archivos del repo raíz, sin commit en el subrepo.)
3. **`no-explicit-any` → `'error'`** en `eslint.config.mjs` (doc 01: TypeScript estricto). Verificación: `npm run lint` → 0 errores/warnings; `npm run build` → 0 errores. Commit `6ed0ad1`.

Comandos corridos: `npm run lint` ✓, `npm run build` ✓, `grep -c "^enum" prisma/schema.prisma` → 18 ✓, `git status` limpio tras commits.
