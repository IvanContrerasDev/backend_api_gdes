# Instrucción: materializar en docs de backend lo ratificado de P-01 a P-04 (2026-09-17, segunda ronda)

**Fecha:** 2026-09-17
**Origen:** orchestrator (GdesProject)
**Incluye y extiende:** `20260917-p04b-completitud-proyeccion.md` (sigue vigente; esta instrucción la amplía).
**Fuente de verdad:** `docs/arquitectura/contratos-api.md` (SYNCED), sección "Decisiones de integración (2026-09-17)", ítems 8–11. Propuestas originales con tipos completos: `admin_web_app/docs/changes_proposals/20260917-p01..p04-*.md` (P-01, P-03 y P-04 figuran como `aplicada`; P-02 sigue `pendiente` en parte).

El humano ratificó los diseños candidatos. Tu trabajo es **materializarlos en la documentación de backend** (`docs/03-contratos-api.md`, `02-modelo-de-datos.md`, `04-auth-y-seguridad.md`, `05-asistencia-eventos-y-registros.md`, `07-convenciones.md` según corresponda): DTOs completos (requests/responses, nullables), catálogo de errores nuevo, ejemplos válidos/inválidos y reglas de validación. No implementar código hasta tener los task specs propios.

## Alcance por propuesta

1. **P-01 — Matriz mensual** (`GET /api/v1/records/monthly`): materializar los tipos aprobados (query, Day EMPTY/PRESENT con `matchesFilters`, fila, response con `meta.snapshotToken/snapshotExpiresAt/totals`), definir collation del orden fijo, implementación y costo del snapshot (TTL 15 min ya decidido), y registrar errores `410 MONTHLY_SNAPSHOT_EXPIRED`, `400 MONTHLY_SNAPSHOT_MISMATCH`, `409 RECORD_ALREADY_EXISTS` en el catálogo 07. Entregar ejemplos de evidencia: febrero bisiesto, mes de 31 días, filas con estados mezclados, cero filas, dos páginas con snapshot, escritura concurrente.
2. **P-02 — Sesión web**: materializar las rutas `/auth/web/csrf|session|refresh|logout`, la ampliación `rememberSession` del login ADMIN y la respuesta 2FA web sin refresh en JSON. **Proponer** (el humano ratifica): identificador de generación de sesión, mecanismo CSRF exacto (emisión preauth, rotación, cabecera) y atributos definitivos de cookie. Orígenes CORS: dominios tentativos del backend ya definidos por el humano (prod `https://backend-api-gdes-prod.vercel.app`, test `https://backend-api-gdes-dev.vercel.app`, a confirmar en el deploy); faltan los orígenes de la web admin. Atención: `vercel.app` está en la Public Suffix List — web y API en subdominios distintos de vercel.app implican cross-site (SameSite=None; Secure, posible bloqueo de terceros); evaluar dominio propio o same-site al deploy. Rechazo de refresh ambiguo → relogin.
3. **P-03 — Solicitud admin**: materializar el endpoint ampliado (10 campos), challenge (TTL 10 min, 5 intentos, cooldown 60 s, payload borrado a las 72 h), verify/resend con respuestas neutrales, exigencia de contraseña actual para cuentas existentes, tabla de estados (incl. cancelación si la cuenta pasa a INACTIVE), decisión por token de un solo uso con expiración 7 días, y errores `409 ADMIN_REQUEST_IDENTITY_CONFLICT` / `403 ADMIN_REQUEST_NOT_ELIGIBLE`.
4. **P-04 — DTOs y reglas**: escrituras con `expectedVersion` (409 RECORD_VERSION_CONFLICT), ADD/UPDATE sin DELETE, identidad inmutable en PATCH, rechazo de solapamientos en carga manual, no aceptar WORK sin ambos extremos ni registros sin intervalos, motivo de ausencia opcional siempre; flujo revisión pura vs MANUAL_LOADED; completitud/medianoche/proyección (ya en la instrucción p04b); retrospectivas permitidas como corrección histórica; archivos 20 MiB × 10, lote atómico, búsqueda fileName+nombre/apellido/legajo; dashboard con contadores del mes seleccionado (`pendingTimesheets`, `incompleteRecords`, `pendingReviewRecords`, `recordsWithAbsence`); DTOs completos de users/clients/sites/workplaces/records/catalogs/timesheets/documents con políticas de validación (teléfono 10–13, DNI 7–8, unicidad, política de contraseña compartida con mobile).

## Lo que NO está aprobado

- Proveedor de mapas (P-05): en investigación; no documentar endpoint de geocodificación todavía.
- Orígenes de producción/preview: placeholder documentado hasta el deploy.
- Cualquier campo/ruta que no esté en las decisiones 8–11 ni en las propuestas ratificadas: frenar y consultar.
