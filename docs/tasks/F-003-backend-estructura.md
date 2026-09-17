# F-003 — Estructura organizacional: sites (seed), clients y workplaces CRUD

**Estado:** pending
**App(s):** backend
**Creada:** 2026-09-15

## Contexto

Mobile necesita el catálogo real de workplaces para marcar (hoy 3 lugares mock con IDs inconsistentes — su deuda #10) y admin gestiona la estructura client→workplace con configuración geográfica que luego usa la validación GPS de asistencia (F-005).

## Alcance

**Incluye:**
- Entidades `Client`, `Workplace` (y `Site` ya seedeada en F-001) con migraciones.
- CRUD admin: `GET/POST /clients`, `GET/PATCH /clients/{id}`, `PATCH /clients/{id}/status`; ídem `/workplaces`. Sin DELETE (soft-delete por `status`).
- `GET /sites` (catálogo de provincias, sin alta en MVP).
- `GET /workplaces` para mobile (rol EMPLOYEE, solo activos, sin paginación).
- Listados admin paginados con filtros (`search`, `clientId`, `siteId`, `status`) y orden server-side.

**NO incluye:**
- Geocodificación / mapas (el admin envía lat/lng; el mapa es frontend).
- Validación GPS de marcaciones (F-005).

## Referencias (fuente de verdad)

- Docs: `backend_api_gdes/docs/02-modelo-de-datos.md` (Client, Workplace, Site), `backend_api_gdes/docs/03-contratos-api.md` (secciones Mobile y Estructura)
- Spec: `admin_web_app/docs/spec_definition.md` Parte 4 (§28–§36)

## Criterios de aceptación

- [ ] Workplace exige `clientId` + `siteId` válidos (422/404 si no).
- [ ] Nada se elimina: deactivate deja `status=INACTIVE` y conserva historial.
- [ ] `GET /workplaces` (mobile) devuelve solo activos con `siteName` y `clientName` resueltos.
- [ ] Filtros y paginación responden con el envoltorio `{ data, pagination }`.
- [ ] Endpoints admin rechazan rol EMPLOYEE (403 `ROLE_NOT_ALLOWED`).

## Notas de implementación

- `shapeType` queda fijo `CIRCLE` en MVP (spec §34).
- IDs reales de workplaces reemplazan los tres catálogos mock de mobile en F-010.

## Registro de implementación

(pendiente)

## Review

(pendiente)
