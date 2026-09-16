# 03 — Contratos API

Convenciones REST y endpoints completos. Este doc es la materialización de `../../docs/arquitectura/contratos-api.md` para el backend; cualquier cambio de contrato exige actualizar AMBOS archivos en la misma tarea y avisar al leader.

Base URL: `/api/v1`. Todo request/response es JSON salvo los uploads (`multipart/form-data`).

## Convenciones

### Formato de respuesta

- Éxito (objeto): `{ "data": { ... } }`
- Éxito (listado paginado): `{ "data": [ ... ], "pagination": { "page": 1, "pageSize": 25, "totalItems": 137, "totalPages": 6 } }`
- Error (uniforme, cualquier endpoint):

```json
{ "error": { "code": "USER_ALREADY_EXISTS", "message": "El usuario ya existe", "retryable": false } }
```

`code`: machine-readable, SCREAMING_SNAKE en inglés. `message`: en español, apto para mostrar en UI tal cual. `retryable`: `true` solo con HTTP 429/500/502/503/504. El frontend no debe basarse únicamente en `retryable` (spec §86). Catálogo completo de códigos en `07-convenciones.md`.

### Paginación, filtros y orden

- `?page=1&pageSize=25` (máx. 100). El módulo de registros usa `pageSize=50` para infinite scroll (spec §84).
- Filtros explícitos en query string: `GET /records?month=5&year=2026&siteId=<uuid>&employeeId=<uuid>&status=INCOMPLETE`.
- Orden: `?sortBy=lastName&order=asc`.
- Paginación, filtros y orden son **100% server-side** (spec §59/§65).

### Semántica HTTP

- `GET` listado/detalle, `POST` crear/acciones, `PATCH` actualización parcial, `DELETE` solo para documents (legajo).
- Activar/desactivar: `PATCH /{resource}/{id}/status` con `{ "status": "ACTIVE" | "INACTIVE" }`.
- Códigos: 200 OK, 201 Created, 204 No Content; errores 400/401/403/404/409/422/429/500.

### Nombres e idioma

- Campos, enums y rutas en inglés. Mensajes de error y labels de catálogos en español.
- Timestamps: ISO 8601 en UTC. El campo `date` de registros es `YYYY-MM-DD` calculado en GMT-3.
- Auth: `Authorization: Bearer <accessToken>`.

---

## Auth (`/auth`)

### POST /auth/login
Login de empleado (mobile) o admin (web). Acepta **email o legajo** en `identifier`.

Request: `{ "identifier": string, "password": string, "client": "MOBILE" | "ADMIN" }`

- `client=MOBILE`: solo rol `EMPLOYEE`. Otro rol → 403 `ROLE_NOT_ALLOWED`.
- `client=ADMIN`: roles `ADMIN`/`SUPER_ADMIN` → dispara 2FA (202 + `{ "data": { "twoFactorRequired": true, "challengeId": "<uuid>" } }`). `TO_BE_ADMIN` → 403 `ADMIN_ACCESS_PENDING` ("Su solicitud de acceso administrativo se encuentra pendiente de aprobación.", spec §10.3). `EMPLOYEE` → 403 `ROLE_NOT_ALLOWED`.

Response 200 (sin 2FA):
```json
{ "data": { "user": { "id": "...", "firstName": "...", "lastName": "...", "email": "...", "employeeId": "...", "role": "EMPLOYEE" },
            "tokens": { "accessToken": "...", "refreshToken": "...", "expiresIn": 1800 } } }
```
Errores: 401 `INVALID_CREDENTIALS`, 403 `ACCOUNT_INACTIVE`, 403 `ROLE_NOT_ALLOWED`, 403 `ADMIN_ACCESS_PENDING`, 429 `TOO_MANY_ATTEMPTS`.

### POST /auth/login/2fa/verify
Request: `{ "challengeId": uuid, "code": string }` → 200 igual que login. Errores: 401 `INVALID_OTP`, 410 `OTP_EXPIRED`, 429 `TOO_MANY_ATTEMPTS`.

### POST /auth/google
Login mobile con Google. Request: `{ "idToken": string, "phone": string }`. El backend verifica el `idToken` contra Google, asocia/encuentra el usuario por email y envía OTP por WhatsApp al `phone` registrado.
Response 202: `{ "data": { "otpRequired": true, "challengeId": "<uuid>" } }`. Errores: 401 `INVALID_GOOGLE_TOKEN`, 404 `USER_NOT_FOUND`, 403 `ACCOUNT_INACTIVE`.

### POST /auth/otp/verify
Request: `{ "challengeId": uuid, "code": string }` → 200 con `{ user, tokens }` (igual que login). Errores: 401 `INVALID_OTP`, 410 `OTP_EXPIRED`, 429 `TOO_MANY_ATTEMPTS`.

### POST /auth/otp/resend
Request: `{ "challengeId": uuid }` → 202 `{ "data": { "sent": true } }`. Cooldown de 60 s: 429 `OTP_RESEND_COOLDOWN`.

### POST /auth/register
Registro de empleado desde mobile. Request:
```json
{ "firstName": "...", "lastName": "...", "email": "...", "password": "...",
  "phone": "...", "employeeId": "...", "dni": "...", "address": "...",
  "siteId": "<uuid>", "birthDate": "YYYY-MM-DD" }
```
Valida unicidad y campos, y envía OTP por WhatsApp. **No crea el `User` todavía**: el payload queda guardado en el challenge OTP (`OtpCode.payload`) y el usuario se crea recién al verificar el código (así no existen cuentas a medias en la tabla). Response 202: `{ "data": { "otpRequired": true, "challengeId": "<uuid>" } }`. Errores: 409 `USER_ALREADY_EXISTS` (email), 409 `EMPLOYEE_ID_ALREADY_EXISTS` (legajo), 409 `DNI_ALREADY_EXISTS`, 422 `VALIDATION_ERROR`.

### POST /auth/password-recovery
Request: `{ "email": string }`. Respuesta **siempre neutra** 202: `{ "data": { "sent": true } }` (exista o no la cuenta). Envía email con enlace/token (1 h, un solo uso).

### POST /auth/password-reset
Request: `{ "token": string, "newPassword": string }` → 200 `{ "data": { "updated": true } }`. Errores: 410 `TOKEN_EXPIRED`, 401 `INVALID_TOKEN`, 422 `VALIDATION_ERROR` (política de contraseña).

### POST /auth/refresh
Request: `{ "refreshToken": string }` → 200 `{ "data": { "tokens": { "accessToken", "refreshToken", "expiresIn" } } }` (rotación). Reuso detectado → 401 `REFRESH_TOKEN_REUSED` y revocación de toda la cadena.

### POST /auth/logout
Autenticado. Invalida el refresh token activo. → 204.

### POST /auth/admin-access-request
Solicitud de acceso admin (spec §10). Request: `{ "email": string }` (el empleado debe existir o se crea como `TO_BE_ADMIN` con datos mínimos — ver flujo completo en `04-auth-y-seguridad.md`). → 202 `{ "data": { "submitted": true } }`. Envía confirmación al solicitante y solicitud al SuperAdmin.

### Confirmación de solicitud admin (links del email al SuperAdmin)
Los emails al SuperAdmin contienen dos links (aprobar / rechazar) que apuntan al **frontend admin** (`ADMIN_FRONTEND_URL/admin-access/confirm?token=...&decision=APPROVE|REJECT`). Esa pantalla confirma la acción y llama al backend:

`POST /auth/admin-access/confirm` — Request: `{ "token": string, "decision": "APPROVE" | "REJECT" }`. Aprobación → rol `ADMIN` + email; rechazo → rol `EMPLOYEE` + email. → 200 `{ "data": { "decision": "APPROVED" } }`. Errores: 410 `TOKEN_EXPIRED`, 401 `INVALID_TOKEN`, 409 `REQUEST_ALREADY_DECIDED`.

---

## Mobile

### GET /workplaces
Rol: EMPLOYEE. Lista de workplaces **activos** para el selector de marcación.
Response: `{ "data": [ { "id", "name", "siteId", "siteName", "clientName", "latitude", "longitude", "radiusMeters" } ] }` (sin paginación: catálogo completo, decenas de lugares).

### POST /attendance/events
Rol: EMPLOYEE. Registra una marcación. **Idempotente** por `clientRequestId`: un reintento devuelve 200 con el resultado original (ver `05-asistencia-eventos-y-registros.md`).

Request:
```json
{ "workplaceId": "<uuid>", "type": "CHECK_IN" | "CHECK_OUT" | "ABSENCE",
  "occurredAt": "2026-09-15T12:03:00.000Z", "latitude": -31.4, "longitude": -64.2,
  "accuracy": 12.5, "locationTimestamp": "2026-09-15T12:02:58.000Z",
  "observation": "opcional", "absenceReason": "ILLNESS", "clientRequestId": "offline-1726497780-a1b2c3",
  "deviceInfo": { "platform": "android", "model": "..." } }
```
`absenceReason` solo si `type=ABSENCE` (hoy mobile no lo envía — cambio pendiente en su contrato).

Response 201: `{ "data": { "eventId": "<uuid>", "recordId": "<uuid>", "message": "Registro realizado correctamente" } }`.

Errores: 422 `VALIDATION_ERROR`, 404 `WORKPLACE_NOT_FOUND`, 403 `ACCOUNT_INACTIVE`, 403 `OUT_OF_WORKPLACE_AREA` (fuera del círculo + margen de tolerancia), 422 `LOW_GPS_ACCURACY` (solo si se configura como rechazo; por defecto genera revisión PENDING y acepta — ver `05`).

### GET /attendance/status
Rol: EMPLOYEE. Estado actual del empleado para derivar `isWorking` (resuelve deuda mobile #13: hoy vive solo en memoria).
Response: `{ "data": { "isWorking": true, "since": "2026-09-15T12:03:00.000Z", "workplaceId": "<uuid>" | null } }`.

### POST /timesheets
Rol: EMPLOYEE (o ADMIN, ver sección admin). `multipart/form-data`: campos `workplaceId` (requerido), `month`, `year`, y uno o varios `files`. Máx. 20 MB/archivo, formatos permitidos.
Response 201: `{ "data": { "timesheetIds": ["<uuid>"], "message": "La planilla fue cargada correctamente." } }`.
Errores: 422 `FILE_TOO_LARGE`, 422 `FILE_TYPE_NOT_ALLOWED`, 422 `VALIDATION_ERROR`.

### POST /documents
Rol: EMPLOYEE. `multipart/form-data`: `type` (DocumentType), `workplaceId` (opcional, `null` permitido), y `files`. Legajo digital del propio empleado.
Response 201: `{ "data": { "documentIds": ["<uuid>"], "message": "..." } }`. Mismos errores de archivo que timesheets.

### GET /profile
Rol: EMPLOYEE. Datos del propio perfil (los 11 campos que muestra `PerfilScreen`).
Response: `{ "data": { "id", "firstName", "lastName", "dni", "cuil", "employeeId", "birthDate", "phone", "email", "address", "hireDate", "position" } }`.
> Nota: `cuil`, `hireDate` y `position` hoy solo existen en el mock de perfil de mobile — quedaron **nullable en `User`** (ver `02-modelo-de-datos.md`) hasta confirmar quién los carga; el endpoint los devuelve `null` si no están.

---

## Admin (roles ADMIN y SUPER_ADMIN; mismas vistas en MVP)

### Dashboard
`GET /dashboard/summary` →
```json
{ "data": { "pendingTimesheets": 0, "incompleteRecords": 0, "pendingReviewRecords": 0, "recordsWithAbsences": 0 } }
```
Las 4 métricas de spec §47. Filtros opcionales: `?month=&year=&siteId=`.

### Registros (`/records`)
- `GET /records` — paginado (default `pageSize=50`, infinite scroll), filtros: `month`, `year`, `siteId`, `employeeId`, `workplaceId`, `clientId`, `status` (RecordStatus), `reviewStatus`, `origin`, `hasAbsence=true`. Incluye intervalos anidados por registro.
- `GET /records/{id}` — detalle con intervalos y metadata de eventos.
- `POST /records` — creación manual completa (marca `reviewStatus=MANUAL_LOADED`, `origin=MANUAL`).
- `PATCH /records/{id}` — edición de horarios/intervalos/observaciones (marca `MANUAL_LOADED`).
- `PATCH /records/{id}/review` — `{ "decision": "APPROVED" | "REJECTED", "observations"?: string }`. Un REJECTED puede volver a APPROVED tras corrección (§16).
- **No existe DELETE** (§26).

### Empleados (`/users`)
- `GET /users` — paginado; búsqueda parcial `?search=` sobre nombre/apellido/email/legajo/DNI; filtro `?status=`; orden default `lastName,asc,firstName,asc`.
- `POST /users` — alta con TODOS los campos obligatorios (§11.1) + contraseña inicial (no revisualizable).
- `GET /users/{id}` — detalle + accesos a sus planillas y documentos.
- `PATCH /users/{id}` — edición de datos (admin NO puede modificar roles, §11.3).
- `PATCH /users/{id}/status` — `{ "status": "ACTIVE" | "INACTIVE" }`.
- Errores de unicidad: 409 `USER_ALREADY_EXISTS` / `EMPLOYEE_ID_ALREADY_EXISTS` / `DNI_ALREADY_EXISTS`.

### Estructura (`/clients`, `/sites`, `/workplaces`)
- `GET/POST /clients`, `GET/PATCH /clients/{id}`, `PATCH /clients/{id}/status`. Filtros: `search` (nombre), `status`.
- `GET /sites` — catálogo de provincias (sin alta en MVP: seed fijo).
- `GET/POST /workplaces`, `GET/PATCH /workplaces/{id}`, `PATCH /workplaces/{id}/status`. Payload (§34): `{ "clientId", "siteId", "name", "latitude", "longitude", "radiusMeters", "gpsAccuracyThreshold"? }`. Filtros: `search`, `clientId`, `siteId`, `status`.

### Planillas (`/timesheets`)
- `GET /timesheets` — paginado; orden default `year desc, month desc, sequenceNumber desc`; filtros: `employeeId`, `clientId`, `workplaceId`, `siteId`, `month`, `year`, `status`. Columnas de listado según §39.4 (incluye `uploadedBy`).
- `POST /timesheets` — upload por admin para cualquier empleado (mismo comportamiento que mobile, §39.3).
- `PATCH /timesheets/{id}/status` — `{ "status": "PENDING" | "LOADED" | "ERROR" }`.
- `PUT /timesheets/{id}/file` — reemplazo de archivo (borra el anterior del bucket).
- `GET /timesheets/{id}/file` — devuelve `{ "data": { "downloadUrl": "<url firmada, expira 15 min>" } }`.

### Documentos / legajos (`/documents`)
- `GET /documents` — paginado; orden default `createdAt desc`; filtros: `employeeId`, `type`, `uploadedBy`, rango de fechas `from`/`to`.
- `POST /documents` — upload por admin (multipart, `employeeId` requerido).
- `PATCH /documents/{id}` — edición de `type` y `fileName` (§40.4).
- `DELETE /documents/{id}` — elimina registro y archivo del bucket (§40.5).
- `GET /documents/{id}/file` — URL firmada de descarga.

### Catálogos
`GET /catalogs` → `{ "data": { "absenceReasons": [...], "documentTypes": [...], "sites": [...] } }` con `value` + `label` en español. Fuente única de labels para ambas apps.
