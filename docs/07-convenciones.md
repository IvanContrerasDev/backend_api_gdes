# 07 — Convenciones

## Idioma

- **Código, contratos, enums, rutas y nombres de campos: inglés.** Sin excepciones en la API.
- **Todo lo que se muestra al usuario por interfaz: español, obligatorio.** Esto incluye `error.message`, los `message` de respuestas de marcación/cargas, y los labels de catálogos (`GET /catalogs`).
- Los DTOs y estructuras de `admin_web_app/docs/spec_definition.md` Parte 8 eran sugerencias de un agente: donde difieren de estos docs, **estos docs mandan** (decisión del humano, 2026-09-15).

## Respuestas y errores

- Éxito: `{ data }` / `{ data: [], pagination }` (ver `03-contratos-api.md`).
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
| 403 | `OUT_OF_WORKPLACE_AREA` | false | Marcación fuera del círculo + tolerancia |
| 404 | `NOT_FOUND` / `USER_NOT_FOUND` / `WORKPLACE_NOT_FOUND` | false | Recurso inexistente |
| 409 | `USER_ALREADY_EXISTS` | false | Email duplicado |
| 409 | `EMPLOYEE_ID_ALREADY_EXISTS` | false | Legajo duplicado |
| 409 | `DNI_ALREADY_EXISTS` | false | DNI duplicado |
| 409 | `REQUEST_ALREADY_DECIDED` | false | Solicitud admin ya resuelta |
| 410 | `OTP_EXPIRED` / `TOKEN_EXPIRED` | false | Código/token vencido |
| 422 | `VALIDATION_ERROR` | false | Error de validación de campos |
| 422 | `INVALID_TIMESTAMP` | false | `occurredAt` en futuro > 5 min |
| 422 | `FILE_TOO_LARGE` | false | Archivo > 20 MB |
| 422 | `FILE_TYPE_NOT_ALLOWED` | false | Extensión/contenido no permitido |
| 429 | `TOO_MANY_ATTEMPTS` | true | Rate limit / intentos de OTP |
| 429 | `OTP_RESEND_COOLDOWN` | true | Reenvío de OTP antes de 60 s |
| 500 | `INTERNAL_ERROR` | true | Error no controlado |

Regla: ningún endpoint devuelve errores fuera de esta tabla sin actualizar este doc y `contratos-api.md`.

## Paginación y orden

- `?page=1&pageSize=25`, `pageSize` máx. 100. Registros: default 50 (infinite scroll, spec §84).
- Respuesta: `{ data: [], pagination: { page, pageSize, totalItems, totalPages } }`.
- Orden: `?sortBy=<campo>&order=asc|desc`; defaults por recurso documentados en `03-contratos-api.md`.

## Fechas y timezone

- **GMT-3 única** para toda la lógica de negocio (spec §29/§76). No hay conversión de zonas.
- Persistencia y transporte: ISO 8601 UTC.
- El `date` de `AttendanceRecord` es `YYYY-MM-DD` calculado en GMT-3 (ver `05-asistencia-eventos-y-registros.md`).

## Archivos

- Formatos: `pdf, jpg, jpeg, png, doc, docx, txt`. Máx. **20 MB** por archivo.
- Validación en backend por extensión **y** magic bytes (mobile no valida tamaño ni cantidad — sus deudas #5/#16 las absorbe el backend).
- Cantidad de archivos por upload: máx. 10 por request (límite nuevo del backend, ausente en las specs).

## Soft-delete

Nada del dominio se borra físicamente de la base: users/clients/workplaces se desactivan (`status`), registros y planillas no se eliminan jamás. Única excepción: `Document` (legajo) sí se elimina (spec §40.5), y los archivos reemplazados/eliminados sí se borran del bucket.

## Commits y PRs del subrepo

Mensajes en inglés, conventional commits (`feat:`, `fix:`, `chore:`...), una feature por rama. Ninguna mutación git sin confirmación del humano (regla del harness).
