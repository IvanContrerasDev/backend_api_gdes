# GdeS Backend API — Documentación

Backend del sistema GdeS: conecta la app mobile (empleados) y la web admin (RRHH/gerencia). Centraliza lógica de negocio, autenticación, almacenamiento e integraciones externas.

> **Estado:** diseño aprobado por el humano (2026-09-15). Sin código todavía. Estos docs son la fuente de verdad para implementar; lo que no esté acá ni en `../docs/arquitectura/contratos-api.md` no se inventa: se frena y se consulta.

## Ruta de lectura

1. `01-arquitectura-y-stack.md` — stack, módulos NestJS, estructura del repo, cross-cutting, Docker.
2. `02-modelo-de-datos.md` — entidades, enums, relaciones y constraints (nivel Prisma).
3. `03-contratos-api.md` — convenciones REST y todos los endpoints con request/response/errores.
4. `04-auth-y-seguridad.md` — flujos de autenticación, tokens, 2FA, OTP, roles y permisos.
5. `05-asistencia-eventos-y-registros.md` — corazón del sistema: eventos → proyección a registros diarios con intervalos, validaciones GPS, idempotencia.
6. `06-integraciones.md` — Resend (email), Meta WhatsApp Cloud API, Cloudflare R2 (storage), Google OAuth.
7. `07-convenciones.md` — idioma, formato de respuestas/errores, paginación, timezone, límites de archivos, códigos de error.

## Leyenda de estado (para cuando haya código)

Igual que en mobile: **Implementado** / **Mock** / **Parcial** / **Pendiente**, declarado por doc o por sección.

## Relación con el resto del sistema

- Contratos entre apps (fuente de verdad de integración): `../../docs/arquitectura/contratos-api.md`.
- Spec funcional de la web admin: `../../admin_web_app/docs/spec_definition.md` (el backend implementa todo lo que esa spec delega al servidor).
- Estado actual de mobile y sus servicios a conectar: `../../mobile_app_gdes/docs/05-servicios-datos-y-contratos.md`.
