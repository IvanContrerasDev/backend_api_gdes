# GdeS Backend API — contexto para agentes

Backend que integra la app móvil (empleados) y la web admin (RRHH): lógica de negocio, almacenamiento, autenticación y procesamiento.

## Fuente de verdad

`docs/` de este repo (leer `docs/README.md` primero — tiene la ruta de lectura). Diseño aprobado por el humano el 2026-09-15. Lo que no esté en `docs/` ni en el task spec NO se inventa: se frena y se consulta al humano (vía leader).

## Stack

TypeScript estricto, Node.js, NestJS (monolito modular), PostgreSQL + Prisma, JWT + refresh tokens, Resend (email), Meta WhatsApp Cloud API, Cloudflare R2 (storage S3-compatible), REST JSON, Docker. Detalle en `docs/01-arquitectura-y-stack.md`.

## Reglas

- Contratos con las apps en `docs/arquitectura/contratos-api.md` (SYNCED, manda sobre supuestos locales) + `docs/03-contratos-api.md` de este repo.
- Convenciones (idioma, errores, paginación, timezone, archivos) en `docs/07-convenciones.md`.
- Skills del stack en `.agents/skills/` — leerlas antes de implementar. Las skills del plugin superpowers se rigen por `docs/convenciones/superpowers.md` (las apagadas tienen stub en `.agents/skills/`).
- Este repo es autocontenido: tiene su propio `leader` (`kimi --agent leader`), `reviewer` e `implementer-backend` en `.agents/agents/`, su backlog en `feature_list.json` y su estado en `progress/`.
- Los archivos marcados `SYNCED-FROM-TEMPLATE` son de solo lectura: los cambios se proponen en `docs/changes_proposals/` y los propaga el orchestrator de GdesProject.
