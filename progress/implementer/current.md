# Current — backend

## Tarea activa
Ninguna (F-001 cerrada).

## Haciendo ahora
-

## Hecho (esta sesión)
- F-001 — Bootstrap del backend completo: scaffold NestJS 11 + TS estricto + ESLint/Prettier; Prisma (schema User/Site + 16 enums, migración inicial, seed 6 provincias); cross-cutting (validación de env fail-fast, filtro `{ error: { code, message, retryable } }`, interceptor `{ data }`, ValidationPipe 422, guards esqueleto); `GET /health`; Dockerfile multi-stage + docker-compose dev.
- Verificado: build, lint, boot fail-fast, migraciones + seed contra Postgres real (`prisma dev`/PGlite), `/health` → `{"data":{"status":"ok"}}`, formatos de error (404/409/422/500) y éxito.
- Commits: b0b64d5, 33ed8af, e074673, 00091bf (branch `feat/F-001-bootstrap`).
- Fix round 1 (review): cliente Prisma copiado desde stage build en Dockerfile production (`014c066`); `no-explicit-any` a `error` (`6ed0ad1`); "16 enums" → 18 en reporte y task spec. lint+build ✓. Detalle en reporte, sección "Fix round 1".

## Blockers / Preguntas para el humano
- Ninguno. Nota: Docker no disponible en el entorno → `docker compose up` y build del Dockerfile quedan pendientes de verificación manual (todo lo demás verificado).

## Resultado final
- **Status:** done_with_concerns (solo por la verificación de Docker pendiente).
- **Archivos:** ver reporte `progress/backend/F-001-report.md` (lista completa + decisiones + evidencia de verificación).
- **Decisiones clave:** 16 enums completos de doc 02; `createdAt`/`updatedAt` en User/Site por regla global; todas las env del listado mínimo requeridas al boot (placeholders en compose/.env.example); `EMAIL_PROVIDER`/`WHATSAPP_PROVIDER` con default `log`; JwtAuthGuard falla cerrado hasta F-002.
- **Cómo verificar:** `npm install && npm run build`; con DB: `npx prisma migrate deploy && npx prisma db seed && npm run start:dev` → `curl localhost:3000/health`. Con Docker: `docker compose up --build` (pendiente de verificación manual).
- **Reporte:** `progress/backend/F-001-report.md`. Registro en `docs/tasks/F-001-backend-bootstrap.md`.
