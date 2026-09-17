# F-001 — Bootstrap del backend (NestJS + Prisma + Docker + cross-cutting)

**Estado:** done
**App(s):** backend
**Creada:** 2026-09-15

## Contexto

`backend_api_gdes/` no tiene código. Es la primera feature: deja el esqueleto sobre el que se implementan todas las demás (F-002 en adelante). El diseño completo está en `backend_api_gdes/docs/`.

## Alcance

**Incluye:**
- Proyecto NestJS nuevo con TypeScript estricto, ESLint/Prettier, estructura de carpetas de `docs/01-arquitectura-y-stack.md`.
- Prisma + PostgreSQL: `schema.prisma` inicial con `User`, `Site` y enums base; `prisma migrate`; seed con las 6 provincias.
- Cross-cutting: filtro global de excepciones (`{ error: { code, message, retryable } }`), interceptor de respuesta (`{ data }`), `ValidationPipe` global, guards `JwtAuthGuard`/`RolesGuard` (esqueleto), `ConfigModule` con validación de env al boot.
- `Dockerfile` multi-stage + `docker-compose.yml` de dev (api + postgres).
- Health check `GET /health`.

**NO incluye:**
- Ningún endpoint de negocio (auth, attendance, etc.) — van en features siguientes.
- Providers de email/WhatsApp/storage (van en F-007/F-008).

## Referencias (fuente de verdad)

- Docs: `backend_api_gdes/docs/01-arquitectura-y-stack.md`, `backend_api_gdes/docs/02-modelo-de-datos.md` (User, Site, enums), `backend_api_gdes/docs/07-convenciones.md`
- Contratos: `docs/arquitectura/contratos-api.md` (decisiones de integración)

## Criterios de aceptación

- [ ] `npm run build` compila y `npm run start:dev` levanta contra postgres de docker-compose.
- [ ] `GET /health` responde `{ "data": { "status": "ok" } }`.
- [ ] Un error lanzado en cualquier controller sale con formato `{ error: { code, message, retryable } }`.
- [ ] Una respuesta exitosa sale envuelta en `{ data: ... }`.
- [ ] Boot falla rápido con mensaje claro si falta una variable de entorno requerida.
- [ ] `docker compose up` levanta api + postgres y corre migraciones + seed.

## Notas de implementación

- Todo el código en inglés; mensajes de error en español (ver `docs/07-convenciones.md`).
- Variables de entorno mínimas listadas en `docs/01-arquitectura-y-stack.md`.
- No agregar dependencias fuera del stack definido sin consultar.

## Registro de implementación

Implementado 2026-09-16 en branch `feat/F-001-bootstrap` (commits `b0b64d5`, `33ed8af`, `e074673`, `00091bf`). Esqueleto completo: NestJS 11 + TS estricto + ESLint/Prettier; Prisma con `User`, `Site` y los 18 enums centrales + migración inicial + seed de las 6 provincias; cross-cutting (validación de env fail-fast, filtro de errores `{ error: { code, message, retryable } }` en español, interceptor `{ data }`, ValidationPipe → 422 `VALIDATION_ERROR`, `JwtAuthGuard`/`RolesGuard` esqueleto); `GET /health`; Dockerfile multi-stage + docker-compose dev (api + postgres con migraciones + seed). Todos los criterios de aceptación verificados salvo `docker compose up` (Docker no disponible en el entorno del implementer — pendiente de verificación manual). Reporte completo: `progress/backend/F-001-report.md`.

## Review

### Ronda 1 — 2026-09-16

**Veredicto: cambios requeridos** (1 ítem sustantivo + 3 menores + 1 no verificable en el entorno).

**Verificado por el reviewer (evidencia propia, no solo la del implementer):**
- `npm run build` ✓ y `npm run lint` ✓ (0 errores/warnings).
- Boot fail-fast sin env ✓: exit con "Invalid environment configuration. Fix the following variables: ..." listando todas las faltantes.
- `prisma migrate deploy` + `prisma db seed` contra Postgres local ✓; seed idempotente, las 6 provincias confirmadas en DB.
- `GET /health` → `{"data":{"status":"ok"}}` HTTP 200 ✓ (formato exacto del criterio).
- `GET /nonexistent` → `{"error":{"code":"NOT_FOUND","message":"Recurso no encontrado","retryable":false}}` HTTP 404 ✓ (formato exacto de `07-convenciones.md` / `contratos-api.md`, mensaje en español).
- Scope ✓: solo `HealthController`; sin endpoints de negocio ni providers email/WhatsApp/storage; sin dependencias fuera del stack de `01-arquitectura-y-stack.md`; sin `any` sueltos; `tsconfig` estricto.
- Coherencia con docs ✓: `User`, `Site` y los 18 enums coinciden con `02-modelo-de-datos.md`; `retryable` solo en 429/5xx; estructura de carpetas según doc 01.

**Ítems de corrección:**
1. `Dockerfile` (stage `production`, línea 28): `npm ci --omit=dev` no instala el CLI de `prisma` (está en devDependencies), así que el `npx prisma generate` siguiente descargaría una versión **no pineada** del registry (riesgo de major incompatible con `@prisma/client@6`) o fallaría en builds sin red. Opciones: copiar el cliente generado desde el stage `build` (`COPY --from=build /app/node_modules/.prisma` + `@prisma/client`), o mover `prisma` a dependencies. El path de dev (`docker-compose.yml`, target `development`) no está afectado.
2. (menor) Documentación del implementer: `progress/backend/F-001-report.md` y el Registro de implementación de este spec dicen "16 enums"; el schema, la migración y el doc 02 tienen **18**. Corregir el número en ambos.
3. (menor) `eslint.config.mjs`: `@typescript-eslint/no-explicit-any` quedó en `'warn'`; el doc 01 exige TypeScript estricto — elevar a `'error'`.
4. (menor) `src/common/guards/roles.guard.ts` y `src/common/decorators/roles.decorator.ts`: roles tipados como `string`; aceptable para el esqueleto, pero F-002 debe tiparlos con el enum `UserRole` de `@prisma/client`.
5. ⚠️ **No verificable en este entorno** (Docker tampoco disponible para el reviewer): `docker compose up` y el build del Dockerfile. Evaluación estática del compose: correcta (healthcheck de postgres con `pg_isready`, `depends_on: service_healthy`, command corre `migrate deploy && db seed && start:dev`, placeholders completos de env). Pendiente verificación manual en un entorno con Docker: `docker compose up --build` → `curl localhost:3000/health`.

### Ronda 1 re-review — 2026-09-16 (fix `00091bf..HEAD`, commits `014c066` + `6ed0ad1`)

**Veredicto del fix: fix aprobado** (3/3 findings ADDRESSED, sin breakage nuevo).

1. `Dockerfile` stage `production` → **ADDRESSED**. Eliminado `npx prisma generate`; el stage queda autocontenido: `npm ci --omit=dev` (instala `@prisma/client@^6.0.0`, que está en `dependencies`) + `COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma`. Verificado por el reviewer: `prisma` CLI confirmado en `devDependencies`; cliente generado presente en `node_modules/.prisma/client` pineado al lockfile; mismo base `node:24-alpine` en build y production (engines compatibles).
2. Documentación "16 enums" → **ADDRESSED**. `progress/backend/F-001-report.md` (2 ocurrencias) y el Registro de implementación de este spec ahora dicen **18**; verificado con `grep -c '^enum' prisma/schema.prisma` → 18. Las menciones restantes a "16 enums" son solo el histórico de esta review (correcto que queden).
3. `eslint.config.mjs` `no-explicit-any: 'error'` → **ADDRESSED**. Re-corrido por el reviewer tras el fix: `npm run lint` ✓ (0 errores/warnings) y `npm run build` ✓.

**Breakage nuevo introducido por el diff del fix:** ninguno. El diff toca únicamente el stage `production` del Dockerfile y una regla de ESLint; el path de dev (`docker-compose.yml`) queda intacto; lint/build pasan; árbol de trabajo limpio tras los commits.

**Siguen abiertos (no pertenecen al fix, ya registrados en ronda 1):** ítem 4 (F-002 debe tipar roles con el enum `UserRole` de `@prisma/client`) e ítem 5 (verificación manual de `docker compose up --build` en un entorno con Docker — el build del stage production tampoco pudo ejecutarse acá, solo evaluación estática).
