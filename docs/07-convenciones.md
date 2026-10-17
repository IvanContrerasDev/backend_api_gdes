# 07 — Convenciones

## Idioma

- **Código, contratos, enums, rutas y nombres de campos: inglés.** Sin excepciones en la API.
- **Todo lo que se muestra al usuario por interfaz: español, obligatorio.** Esto incluye `error.message`, los `message` de respuestas de marcación/cargas, y los labels de catálogos (`GET /catalogs`).
- Los DTOs y estructuras de `admin_web_app/docs/spec_definition.md` Parte 8 eran sugerencias de un agente: donde difieren de estos docs, **estos docs mandan** (decisión del humano, 2026-09-15).

## Respuestas y errores

- Éxito: `{ data }` / `{ data: [], pagination }`; matriz agrega `meta` en el mismo nivel (ver `03-contratos-api.md`).
- Error uniforme: `{ error: { code, message, retryable } }`.
- `retryable: true` solo con HTTP 429/500/502/503/504 (spec §52/§69–71). El frontend no debe depender únicamente de `retryable`.

### Catálogo de códigos de error

| HTTP | code | retryable | Uso |
|---|---|---|---|
| 400 | `BAD_REQUEST` | false | Request mal formado |
| 401 | `INVALID_CREDENTIALS` | false | Login fallido |
| 401 | `INVALID_TOKEN` | false | Token inválido (reset, admin-access) |
| 401 | `INVALID_OTP` | false | Código OTP/2FA incorrecto |
| 401 | `REFRESH_TOKEN_REUSED` | false | Reuso detectado; cadena revocada |
| 401 | `INVALID_GOOGLE_TOKEN` | false | id_token de Google inválido |
| 403 | `ROLE_NOT_ALLOWED` | false | Rol no permitido en ese cliente/endpoint |
| 403 | `ACCOUNT_INACTIVE` | false | Cuenta desactivada (bloquea todo, spec §6) |
| 403 | `ADMIN_ACCESS_PENDING` | false | Login admin con solicitud pendiente (§10.3) |
| 403 | `EMAIL_NOT_VERIFIED` | false | Login mobile con email sin verificar (bloquea antes del OTP) |
| 403 | `OUT_OF_WORKPLACE_AREA` | false | Marcación fuera del círculo + tolerancia |
| 404 | `NOT_FOUND` / `USER_NOT_FOUND` / `WORKPLACE_NOT_FOUND` | false | Recurso inexistente |
| 409 | `USER_ALREADY_EXISTS` | false | Email duplicado |
| 409 | `EMPLOYEE_ID_ALREADY_EXISTS` | false | Legajo duplicado |
| 409 | `DNI_ALREADY_EXISTS` | false | DNI duplicado |
| 409 | `REQUEST_ALREADY_DECIDED` | false | Solicitud admin ya resuelta |
| 410 | `OTP_EXPIRED` / `TOKEN_EXPIRED` | false | Código/token vencido |
| 422 | `VALIDATION_ERROR` | false | Error de validación de campos |
| 422 | `INVALID_TIMESTAMP` | false | Timestamp offline inválido o adelanto de clientSentAt >2min; contrato implementado en05 |
| 422 | `FILE_TOO_LARGE` | false | Archivo > 20 MiB |
| 422 | `FILE_TYPE_NOT_ALLOWED` | false | Extensión/contenido no permitido |
| 429 | `TOO_MANY_ATTEMPTS` | true | Rate limit / intentos de OTP |
| 429 | `OTP_RESEND_COOLDOWN` | true | Reenvío de OTP antes de 60 s |
| 500 | `INTERNAL_ERROR` | true | Error no controlado |

El catálogo combina códigos implementados y previstos: disponibilidad por dominio en03. Asistencia/estructura/users y registros admin tienen implementación; solicitud admin sigue pendiente F-008. ApiException acepta strings y no valida pertenencia al catálogo. Nuevos códigos requieren documentar el contrato común y este catálogo.

| HTTP | code | retryable | Uso |
|---|---|---|---|
| 410 | MONTHLY_SNAPSHOT_EXPIRED | false | Reiniciar lectura mensual |
| 400 | MONTHLY_SNAPSHOT_MISMATCH | false | Snapshot de otro contexto |
| 409 | RECORD_ALREADY_EXISTS / RECORD_VERSION_CONFLICT | false | Unicidad / concurrencia |
| 422 | RECORD_INTERVALS_REQUIRED | false | Corrección deja cero intervalos |
| 422 | ATTENDANCE_EVENT_TOO_OLD | false | Más de 24 h al recibir; frontera inclusiva |
| 409 | ADMIN_REQUEST_IDENTITY_CONFLICT | false | Identidad en conflicto tras verificar |
| 403 | ADMIN_REQUEST_NOT_ELIGIBLE | false | Solicitud no elegible |
| 404 | USER_NOT_FOUND / CLIENT_NOT_FOUND / WORKPLACE_NOT_FOUND | false | Recurso inexistente |
| 409 | USER_EMAIL_ALREADY_EXISTS / USER_DNI_ALREADY_EXISTS / USER_EMPLOYEE_ID_ALREADY_EXISTS | false | Unicidad P-06 en gestión users |
| 400 | INVALID_USER_DATA / INVALID_SITE / WEAK_PASSWORD | false | Validación P-06 |
| 409 | CLIENT_NAME_ALREADY_EXISTS / WORKPLACE_NAME_ALREADY_EXISTS / CLIENT_INACTIVE | false | Unicidad / cliente inactivo P-07 |
| 400 | INVALID_CLIENT_DATA / INVALID_WORKPLACE_DATA / INVALID_GEO_CONFIGURATION | false | Validación P-07 |

Registro mobile conserva sus códigos de unicidad originales; no sustituirlos por códigos de gestión users sin decisión. Errores concretos CSRF/sesión y otros DTO pendientes no se inventan.

## Paginación y orden

- `?page=1&pageSize=25`, `pageSize` máx. 100. Registros: default 50 (infinite scroll, spec §84).
- Respuesta: `{ data: [], pagination: { page, pageSize, totalItems, totalPages } }`.
- Empleados/clientes/lugares/matriz usan orden fijo del contrato común. `sortBy/order` solo si el recurso publica allowlist en 03; no exponer orden libre por defecto.

## Fechas y timezone

- **GMT-3 única** para toda la lógica de negocio (spec §29/§76). No hay conversión de zonas.
- Persistencia y transporte: ISO 8601 UTC.
- El `date` de `AttendanceRecord` es `YYYY-MM-DD` calculado en GMT-3 (ver `05-asistencia-eventos-y-registros.md`).

## Archivos

- Formatos: `pdf, jpg, jpeg, png, doc, docx, txt`. Máx. **20 MiB (20 × 1024 × 1024 bytes)** por archivo.
- Validación en backend por extensión **y** magic bytes (mobile no valida tamaño ni cantidad — sus deudas #5/#16 las absorbe el backend).
- Cantidad de archivos por upload: máx. 10 por request (ratificado; lote atómico, validar capacidad de proxy al desplegar).

## Soft-delete

Nada del dominio se borra físicamente de la base: users se desactiva con `accountStatus`; clients/workplaces con `status`, registros y planillas no se eliminan jamás. Excepciones de dominio: `Document` (legajo) se elimina (spec §40.5); intervalos se pueden eliminar dentro de la corrección admin, conservando registro y eventos originales. Los archivos reemplazados/eliminados se borran del bucket. Tablas técnicas pueden limpiar datos vencidos conforme política, por ejemplo MonthlySnapshot; no implica borrar historia de asistencia.

## Commits y PRs del subrepo

Mensajes en inglés, conventional commits (`feat:`, `fix:`, `chore:`...), una feature por rama. Ninguna mutación git sin confirmación del humano (regla del harness).
