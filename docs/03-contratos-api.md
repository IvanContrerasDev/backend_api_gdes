# 03 — Contratos API

Detalle HTTP de diseño vigente. Acuerdos y racional cross-app: `arquitectura/contratos-api.md` (SYNCED). Cambios comunes se proponen al orchestrator.

**Disponibilidad real:** solo `GET /health`, sin prefijo, devuelve `{ data: { status: "ok" } }`. `src/app.module.ts` registra únicamente HealthController y `src/main.ts` no configura `/api/v1`, CORS ni cookies. Todos los endpoints siguientes están **pendientes de implementar**, incluidos auth, catálogos y uploads. Un diseño documentado no demuestra integración real. Los DTOs expresamente marcados pendientes necesitan confirmación antes de integración.

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
- Orden fijo para empleados/clientes/lugares/matriz según contrato común; sortBy/order solo donde el recurso tenga allowlist publicada.
- Paginación, filtros y orden son **100% server-side** (spec §59/§65).

### Semántica HTTP

- `GET` listado/detalle, `POST` crear/acciones, `PUT` reemplazo completo de campos editables de clients/workplaces, `PATCH` actualización parcial, `DELETE` solo para documents (legajo).
- Activar/desactivar: clients/workplaces usan `PATCH /{resource}/{id}/status` con `{ status }`; users usa `PATCH /users/{id}/account-status` con `{ accountStatus }`.
- Códigos: 200 OK, 201 Created, 204 No Content; errores 400/401/403/404/409/422/429/500.

### Nombres e idioma

- Campos, enums y rutas en inglés. Mensajes de error y labels de catálogos en español.
- Timestamps: ISO 8601 en UTC. El campo `date` de registros es `YYYY-MM-DD` calculado en GMT-3.
- Auth: `Authorization: Bearer <accessToken>`.

---

## Auth (`/auth`)

### POST /auth/login
Login de empleado (mobile) o admin (web). Acepta **email o legajo** en `identifier`.

Request: `{ "identifier": string, "password": string, "client": "MOBILE" | "ADMIN", "rememberSession"?: boolean }`. `rememberSession` corresponde solo a ADMIN.

- `client=MOBILE`: solo rol `EMPLOYEE`. Otro rol → 403 `ROLE_NOT_ALLOWED`.
- Email sin verificar → 403 `EMAIL_NOT_VERIFIED` (sin enviar OTP; ver flujo 4 de `04-auth-y-seguridad.md`). Credenciales válidas + email verificado → dispara OTP WhatsApp (202 + `{ "data": { "otpRequired": true, "challengeId": "<uuid>" } }`).
- `client=ADMIN`: roles `ADMIN`/`SUPER_ADMIN` → dispara 2FA (202 + `{ "data": { "twoFactorRequired": true, "challengeId": "<uuid>" } }`). `TO_BE_ADMIN` → 403 `ADMIN_ACCESS_PENDING` ("Su solicitud de acceso administrativo se encuentra pendiente de aprobación.", spec §10.3). `EMPLOYEE` → 403 `ROLE_NOT_ALLOWED`.

`/auth/login` siempre responde 202 (OTP mobile o 2FA admin): el 200 con tokens solo lo devuelven `POST /auth/otp/verify` (mobile), con esta forma; la respuesta web 2FA se define en Sesión web y no lleva refresh en JSON:
```json
{ "data": { "user": { "id": "...", "firstName": "...", "lastName": "...", "email": "...", "employeeId": "...", "role": "EMPLOYEE" },
            "tokens": { "accessToken": "...", "refreshToken": "...", "expiresIn": 1800 } } }
```
Errores: 401 `INVALID_CREDENTIALS`, 403 `ACCOUNT_INACTIVE`, 403 `ROLE_NOT_ALLOWED`, 403 `ADMIN_ACCESS_PENDING`, 403 `EMAIL_NOT_VERIFIED`, 429 `TOO_MANY_ATTEMPTS`.

### POST /auth/login/2fa/verify
Request: `{ "challengeId": uuid, "code": string }` → 200 `WebTokenResponse`; emite cookie HttpOnly. Sin refresh en JSON. Errores: 401 `INVALID_OTP`, 410 `OTP_EXPIRED`, 429 `TOO_MANY_ATTEMPTS`.

### POST /auth/google
Login mobile con Google. Request: `{ "idToken": string, "phone": string }`. El backend verifica el `idToken` contra Google, asocia/encuentra el usuario por email y —solo si el email está verificado— envía OTP por WhatsApp al `phone` registrado.
Response 202: `{ "data": { "otpRequired": true, "challengeId": "<uuid>" } }`. Errores: 401 `INVALID_GOOGLE_TOKEN`, 404 `USER_NOT_FOUND`, 403 `ACCOUNT_INACTIVE`, 403 `EMAIL_NOT_VERIFIED`.

### POST /auth/otp/verify
Request: `{ "challengeId": uuid, "code": string }`.
- purpose `LOGIN` / `GOOGLE_LOGIN` → 200 con `{ user, tokens }` (igual que login).
- purpose `REGISTER` → crea el `User`, envía el email de verificación (magic link) y responde 202 `{ "data": { "emailVerificationRequired": true } }` — **sin tokens**: el login queda bloqueado (`EMAIL_NOT_VERIFIED`) hasta confirmar el email.
Errores: 401 `INVALID_OTP`, 410 `OTP_EXPIRED`, 429 `TOO_MANY_ATTEMPTS`.

### POST /auth/otp/resend
Request: `{ "challengeId": uuid }` → 202 `{ "data": { "sent": true } }`. Cooldown de 60 s: 429 `OTP_RESEND_COOLDOWN`.

### POST /auth/register
Registro de empleado desde mobile. Request:
```json
{ "firstName": "...", "lastName": "...", "email": "...", "password": "...",
  "phone": "...", "employeeId": "...", "dni": "...", "address": "...",
  "siteId": "<uuid>", "birthDate": "YYYY-MM-DD" }
```
Valida unicidad y campos, y envía OTP por WhatsApp. **No crea el `User` todavía**: el payload queda guardado en el challenge OTP (`OtpCode.payload`) y el usuario se crea recién al verificar el código (así no existen cuentas a medias en la tabla). Tras la verificación del OTP el usuario queda **pendiente de verificación de email** (magic link — ver flujo 4 de `04-auth-y-seguridad.md`). Response 202: `{ "data": { "otpRequired": true, "challengeId": "<uuid>" } }`. Errores: 409 `USER_ALREADY_EXISTS` (email), 409 `EMPLOYEE_ID_ALREADY_EXISTS` (legajo), 409 `DNI_ALREADY_EXISTS`, 422 `VALIDATION_ERROR`.

### GET /auth/email/verify
Destino del magic link de verificación de email (botón "confirmar" del correo). Query: `?token=<string>` (firmado, un solo uso; TTL de diseño 24 h pendiente de ratificación, ver 04). Marca `emailVerifiedAt` del usuario y redirige (302) al deep link de mobile (`MOBILE_DEEP_LINK_SCHEME`) con el resultado. Errores: 410 `TOKEN_EXPIRED`, 401 `INVALID_TOKEN`.

### POST /auth/email-verification/resend
Request: `{ "email": string }`. Respuesta **siempre neutra** 202: `{ "data": { "sent": true } }` (exista o no la cuenta). Reenvía el email de verificación solo si la cuenta existe y sigue sin verificar.

### POST /auth/password-recovery
Request: `{ "email": string }`. Respuesta **siempre neutra** 202: `{ "data": { "sent": true } }` (exista o no la cuenta). Envía email con enlace/token (1 h, un solo uso).

### POST /auth/password-reset
Request: `{ "token": string, "newPassword": string }` → 200 `{ "data": { "updated": true } }`. Errores: 410 `TOKEN_EXPIRED`, 401 `INVALID_TOKEN`, 422 `VALIDATION_ERROR` (política de contraseña).

### POST /auth/refresh
Request: `{ "refreshToken": string }` → 200 `{ "data": { "tokens": { "accessToken", "refreshToken", "expiresIn" } } }` (rotación). Reuso detectado → 401 `REFRESH_TOKEN_REUSED` y revocación de toda la cadena.

### POST /auth/logout
Autenticado. Invalida el refresh token activo. → 204.

### POST /auth/admin-access-request
Solicitud completa de diez campos + challenge email previo; ver sección Solicitud admin. Nunca crea cuenta ni cambia rol antes de verificar el email.

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

Errores: 422 `VALIDATION_ERROR`, 422 `ATTENDANCE_EVENT_TOO_OLD`, 404 `WORKPLACE_NOT_FOUND`, 403 `ACCOUNT_INACTIVE`, 403 `OUT_OF_WORKPLACE_AREA` (fuera del círculo + margen de tolerancia). Precisión GPS insuficiente genera PENDING y acepta; no existe rechazo LOW_GPS_ACCURACY aprobado.

### GET /attendance/status
Rol: EMPLOYEE. Estado actual del empleado para derivar `isWorking` (resuelve deuda mobile #13: hoy vive solo en memoria).
Response: `{ "data": { "isWorking": true, "since": "2026-09-15T12:03:00.000Z", "workplaceId": "<uuid>" | null } }`.

### POST /timesheets
Rol: EMPLOYEE (o ADMIN, ver sección admin). `multipart/form-data`: campos `workplaceId` (requerido), `month`, `year`, y uno o varios `files`. Máx. 20 MiB/archivo y 10 archivos por request; lote atómico, formatos permitidos.
Response 201: `{ "data": { "timesheetIds": ["<uuid>"], "message": "La planilla fue cargada correctamente." } }`.
Errores: 422 `FILE_TOO_LARGE`, 422 `FILE_TYPE_NOT_ALLOWED`, 422 `VALIDATION_ERROR`.

### POST /documents
Rol: EMPLOYEE. `multipart/form-data`: `type` (DocumentType), `workplaceId` (opcional, `null` permitido), y `files`. Legajo digital del propio empleado.
Response 201: `{ "data": { "documentIds": ["<uuid>"], "message": "..." } }`. Mismos errores de archivo que timesheets.

### GET /profile
Rol: EMPLOYEE. Datos del propio perfil (los 11 campos que muestra `PerfilScreen`).
Response: `{ "data": { "id", "firstName", "lastName", "dni", "cuil", "employeeId", "birthDate", "phone", "email", "address", "hireDate", "position" } }`.
> Nota: `cuil`, `hireDate` y `position` hoy solo existen en el mock de perfil de mobile — quedaron **nullable en `User`** (ver `02-modelo-de-datos.md`) hasta que Admin los actualice (P-06); el endpoint los devuelve `null` si no están.

---

## Admin (roles ADMIN y SUPER_ADMIN; mismas vistas en MVP)

### Dashboard — diseño de ruta aún por reconciliar
`GET /dashboard/summary` →
```json
{ "data": { "pendingTimesheets": 0, "incompleteRecords": 0, "pendingReviewRecords": 0, "recordsWithAbsence": 0 } }
```
Las 4 métricas de spec §47. Período: mes seleccionado; la forma final de la ruta/query se mantiene pendiente en el contrato de F-009, sin inferirla del mock.

### Registros (`/records`)
- `GET /records`: listado diario paginado, filtros month/year/siteId/employeeId/workplaceId/clientId/status/reviewStatus/origin/hasAbsence. La matriz usa `/records/monthly`.
- `GET /records/{id}`: detalle bajo demanda; DTO mock de F-006 pendiente de confirmación (contrato común, sección Asistencia / Detalle y metadata bajo demanda).
- `POST /records`: creación manual completa; `PATCH /records/{id}`: corrección por expectedVersion. DTOs canónicos en `arquitectura/contratos-api.md`, sección Asistencia / Corrección y aprobación.
- `PATCH /records/{id}/review`: `{ expectedVersion, reviewStatus: "APPROVED" }`, devuelve detalle y versión incrementada. Conserva origen, observaciones, horarios e intervalos. No existe rechazo.
- No se borra el registro; DELETE solo existe como operación de intervalo dentro del PATCH.

### Empleados y estructura
DTOs, rutas, búsquedas y validaciones aprobados de empleados/clientes/lugares pertenecen a `arquitectura/contratos-api.md` (secciones Empleados y Clientes y lugares). `/users/{id}/account-status` usa `{ accountStatus }`; clients/workplaces usan PUT completo para edición. No hay DELETE de entidades.

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

## Dueños de contratos compartidos

Los DTOs y reglas cross-app tienen una sola definición en [contrato común](arquitectura/contratos-api.md). Este documento conserva detalle HTTP específico del backend y disponibilidad; no duplica esas interfaces.

| Tema común | Referencia y detalle que queda por implementar |
|---|---|
| Sesión web admin | Sección Sesión web admin: WebLogin/WebSession/WebTokenResponse/WebCsrfResponse, rutas /auth/web/*, cookie vs JSON, vencimiento absoluto y relogin ante refresh ambiguo |
| Solicitud administrativa | Sección Solicitud administrativa: diez campos, AdminAccessChallenge/Verify/Resend/Submitted; POST inicial, /verify y /resend; verificación previa a rol, contraseña existente y retención |
| Empleados | Sección Empleados: lista/detalle/alta/PATCH y PATCH account-status; cuil/hireDate/position nullables actualizables por Admin; contraseña 12–128 sin composición obligatoria |
| Clientes/lugares | Sección Clientes y lugares: PUT completo, estados, relaciones resueltas, queries y límites geográficos; sin dirección/Place ID persistidos |
| Matriz mensual | Sección Asistencia / Consulta mensual: MonthlyQuery/Day/MonthlyRow/MonthlyResponse, filas completas, filtros, totales y snapshot TTL 15 min |
| Corrección/aprobación | Sección Asistencia / Corrección y aprobación: CreateRecord/UpdateRecord/IntervalChange/ReviewRecord, expectedVersion, DELETE de intervalo y aprobación pura |
| Detalle/eventos | Sección Asistencia / Detalle y metadata bajo demanda: RecordDetail/RecordInterval/AttendanceEventDetail aprobados solo para mocks, pendientes de confirmar por backend |
| Archivos/métricas | Sección Archivos y métricas: límites/atomicidad/búsquedas/descarga y contadores aprobados; DTOs ampliados aún en propuesta viva |

## Detalle backend y pendientes contractuales

- Matriz: estrategia/costo de persistencia del snapshot y collation del orden fijo todavía sin definir. Probar febrero bisiesto, 31 días, cero filas, filtros mixtos, dos páginas y escritura concurrente. Nunca devolver intervalos/eventos por celda; pedir detalle bajo demanda. Son requisitos de ejecución, sin evidencia API real todavía.
- Solicitud admin: POST inicial y resend → 202 challenge neutral completo; verify → submitted PENDING. Challenge 6 dígitos/10 min/5 intentos/cooldown 60 s, payload temporal máximo 72 h; decisión de un solo uso 7 días. Serialización de cancelación y reenvío/idempotencia tras respuesta perdida pendiente de especificar. No crear cuenta/cambiar rol ni revelar existencia antes de verificar. Endpoint email-only previo quedó sustituido por diseño común vigente.
- Sesión web: proponer generación de sesión y mecanismo CSRF exacto para ratificación humana; orígenes/atributos finales de cookie/fallback/pruebas de navegador siguen pendientes. Reenvío 2FA admin y logout offline requieren precisión. No añadir campos/errores nuevos por suposición.
- Offline: `receivedAt - occurredAt <= 24 h` inclusivo, recepción del servidor. Más de 24 h → **422 ATTENDANCE_EVENT_TOO_OLD**, retryable=false (diseño técnico del catálogo 07; aún sin implementar). Validar exactamente 24 h aceptado/+1 ms rechazado. Futuro/clock skew sin umbral aprobado. Ver 05/07; falta código y pruebas reales.
- Detalle F-006: el DTO mock de intervalo hereda reviewStatus del registro e incluye MANUAL_LOADED, contrario al enum IntervalReviewStatus acordado. Confirmar representación antes de integrar; no ampliar enum silenciosamente. Faltan nombres/nullabilidad de metadata e historia, vínculos al borrar intervalos y usos EventOrigin.ADMIN fuera de correcciones (estas nunca generan eventos).
- Filtros/listados genéricos del diseño base no constituyen allowlist final para recursos todavía no cerrados. Catálogos públicos/privados y permisos deben definirse sin exponer datos operativos.
- El interceptor actual envuelve `{data: payload}` incondicionalmente: devolver ya `{data,pagination}` anida dos envelopes. Resolver al implementar paginación. `ApiException` acepta cualquier string y no valida catálogo; 07 documenta el diseño, no validación automática.

## Diferencias abiertas con archivos/métricas mock

Los mocks Admin consumen `/dashboard/metrics`, pero el diseño base publica `/dashboard/summary`; ruta/query final pendiente de ratificación. El mock exige `expiresAt` en descarga, mientras el acuerdo vigente solo garantiza `downloadUrl`. DTOs completos de listado/upload, multipart, preservación de estado al reemplazar y alcance provincial están pendientes de la propuesta viva enlazada por el contrato común. No inferir aprobación de los servicios frontend. El diseño base anterior no cubre aún todas esas necesidades. URLs firmadas de 15 min se solicitan al descargar, sin persistirlas como dato estable.

## Evidencia de bootstrap vigente

HealthController devuelve payload plano `{status:'ok'}` y el interceptor lo envuelve; AppModule registra filtro, interceptor y ValidationPipe global. `JwtAuthGuard` todavía falla cerrado. Prisma solo User/Site y enums, sin modelos de negocio, auth ni emailVerifiedAt. `ReviewStatus`/`IntervalReviewStatus` persistidos aún conservan REJECTED; OtpPurpose no incluye LOGIN. Migraciones y módulos futuros deben alinearse al diseño, no describirse como disponibles. Ver 01/02 para racional y operación.
