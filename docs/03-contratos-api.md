# 03 — Contratos API

Detalle HTTP de diseño vigente. Acuerdos y racional cross-app: `arquitectura/contratos-api.md` (SYNCED). Cambios comunes se proponen al orchestrator.

**Disponibilidad real:** `GET /health` sin prefijo y estructura bajo `/api/v1`: GET /sites; GET/POST /clients, GET/PUT /clients/{id}, PATCH /clients/{id}/status; rutas equivalentes de workplaces. ADMIN/SUPER_ADMIN gestionan; EMPLOYEE solo obtiene catálogo activo en GET /workplaces, sin paginación, excluyendo clientes inactivos. JWT real obligatorio en estructura, sin ruta de emisión de prueba. Auth base también implementada: login, otp verify/resend, 2fa verify, refresh/logout mobile y web csrf/session/refresh/logout; providers log dev/test y adaptadores Resend/Meta por configuración. Empleados/perfil también implementados (GET/POST /users, GET/PATCH /users/{id}, PATCH account-status, GET /profile). Ingesta/status de asistencia implementados, aprobación independiente completada; registros admin implementados y aprobados tras revisión independiente; dashboard mensual implementado y aprobado; planillas/documentos/R2 implementados y aprobados; auth avanzada pendiente. DTOs marcados pendientes aún requieren confirmación antes de integración.

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
Destino del magic link de verificación de email (botón "confirmar" del correo). Query: `?token=<string>` (firmado, un solo uso; TTL ratificado 24 h, ver 04). Marca `emailVerifiedAt` del usuario y redirige (302) al deep link de mobile (`MOBILE_DEEP_LINK_SCHEME`) con el resultado. Errores: 410 `TOKEN_EXPIRED`, 401 `INVALID_TOKEN`.

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
**Implementado, aprobación independiente completada:** online (sin clientSentAt) usa hora efectiva del servidor. Offline exige occurredAt original y clientSentAt actual del teléfono al sincronizar, con adelanto máximo inclusivo de dos minutos y ventana24h inclusiva (05). Procesamiento por recepción; reloj atrasado no tiene límite simétrico.

Rol: EMPLOYEE. Registra una marcación. **Idempotente** por `clientRequestId`: un reintento devuelve 200 con el resultado original (ver `05-asistencia-eventos-y-registros.md`).

Request:
```json
{ "workplaceId": "<uuid>", "type": "CHECK_IN" | "CHECK_OUT" | "ABSENCE",
  "occurredAt": "2026-09-15T12:03:00.000Z", "latitude": -31.4, "longitude": -64.2,
  "accuracy": 12.5, "locationTimestamp": "2026-09-15T12:02:58.000Z",
  "observation": "opcional", "absenceReason": "ILLNESS", "clientRequestId": "offline-1726497780-a1b2c3",
  "deviceInfo": { "platform": "android", "model": "..." } }
```
El ejemplo corresponde a offline si agrega `clientSentAt` ISO UTC de sincronización; sin ese campo, `occurredAt` legado se valida pero no fija la hora efectiva online. `receivedAt` no se recibe del cliente. `absenceReason` solo si `type=ABSENCE` (hoy mobile no lo envía — cambio pendiente en su contrato).

Response 201: `{ "data": { "eventId": "<uuid>", "recordId": "<uuid>", "message": "Registro realizado correctamente" } }`.

Errores: 422 `VALIDATION_ERROR`, 422 `INVALID_TIMESTAMP`, 422 `ATTENDANCE_EVENT_TOO_OLD`, 409 `CLIENT_INACTIVE`, 404 `WORKPLACE_NOT_FOUND`, 403 `ACCOUNT_INACTIVE`, 403 `OUT_OF_WORKPLACE_AREA` (fuera del círculo + margen de tolerancia). Precisión GPS insuficiente genera PENDING y acepta; no existe rechazo LOW_GPS_ACCURACY aprobado.

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

### Dashboard — implementado y aprobado (F-009)
`GET /dashboard/metrics?month=10&year=2026`, roles ADMIN/SUPER_ADMIN. Ambos parámetros obligatorios: month1–12, year2000–9999, enteros decimales; parámetros desconocidos/repetidos/invalidos422 VALIDATION_ERROR. Sustituye el diseño anterior /dashboard/summary.

```json
{ "data": { "pendingTimesheets": 0, "incompleteRecords": 0, "pendingReviewRecords": 0, "recordsWithAbsence": 0,
  "byProvince": [{ "id": "<uuid>", "name": "Catamarca", "pendingTimesheets": 0, "incompleteRecords": 0, "pendingReviewRecords": 0, "recordsWithAbsence": 0 }] } }
```

El arreglo incluye todas las provincias de Site (seed seis), incluso ceros; orden nombre COLLATE C y UUID. Totales generales coinciden con suma del desglose. Planillas PENDING se cuentan por month/year del período, no createdAt. Registros se cuentan por date civil GMT-3 del mes: INCOMPLETE, reviewStatus PENDING y existencia de al menos un intervalo ABSENCE respectivamente. Una ausencia cuenta el registro una vez, aunque tenga varias; condiciones pueden coexistir. NONE/APPROVED/MANUAL_LOADED no suman revisión pendiente. No hay paginación ni exclusión de históricos inactivos.

Provincia: snapshot AttendanceRecord.siteId para registros y workplace.siteId para planillas; no usar provincia del empleado. Lectura agregada coherente en RepeatableRead. La imagen docs/arquitectura/dashboardMetricsFrontendExample.png es guía de contenido, no fuente de valores. El frontend debe conservar período/filtro al abrir el destino. Incorporación al común pendiente de sync mediante propuesta20261017-dashboard-metrics.

### Registros (`/records`)
- `GET /records`: listado diario de diseño, aún sin DTO final ni ruta implementada. La matriz F-006 usa `/records/monthly`.
- `GET /records/{id}`: detalle bajo demanda; DTO del contrato común con ajustes ratificados al final de este documento; implementación F-006 implementada y aprobada.
- `POST /records`: creación manual completa; `PATCH /records/{id}`: corrección por expectedVersion. DTOs canónicos en `arquitectura/contratos-api.md`, sección Asistencia / Corrección y aprobación.
- `PATCH /records/{id}/review`: `{ expectedVersion, reviewStatus: "APPROVED" }`, devuelve detalle y versión incrementada. Conserva origen, observaciones, horarios e intervalos. No existe rechazo.
- No se borra el registro; DELETE solo existe como operación de intervalo dentro del PATCH.

### Empleados y estructura
DTOs, rutas, búsquedas y validaciones aprobados de empleados/clientes/lugares pertenecen a `arquitectura/contratos-api.md` (secciones Empleados y Clientes y lugares). `/users/{id}/account-status` usa `{ accountStatus }`; clients/workplaces usan PUT completo para edición. No hay DELETE de entidades.

### Archivos — F-007 implementada y aprobada

Uploads multipart proxificados,1–10archivos y20MiB inclusivos por archivo; validar extensión/contenido antes de publicar metadata. Formatos pdf/jpg/jpeg/png/doc/docx/txt. No se genera asistencia ni OCR. ADMIN/SUPER_ADMIN gestionan; EMPLOYEE carga para sí y lee/descarga solo archivos propios. Un id ajeno devuelve404 NOT_FOUND. No exponer fileKey/credenciales ni URL estable de bucket.

Timesheet público: `{id,employee:{id,firstName,lastName,employeeId},workplace:{id,name},client:{id,name},site:{id,name},month,year,sequence,status,fileName,fileExtension,fileSizeBytes,uploadedBy:{id,firstName,lastName},createdAt,updatedAt,version,replacedBy:{id,firstName,lastName}|null}`. sequence mapea sequenceNumber DB. uploadedBy/createdAt originales se conservan; replacedBy registra último reemplazante.

Document público: `{id,employee:{id,firstName,lastName,employeeId},workplace:{id,name}|null,type,fileName,fileExtension,fileSizeBytes,uploadedBy:{id,firstName,lastName},createdAt,updatedAt}`.

| Ruta | Entrada y salida |
|---|---|
| POST /timesheets | Multipart workplaceId/month/year/files repetidos; admin employeeId UUID requerido, móvil deriva de sesión.201 móvil `{data:{timesheetIds,message}}`; admin `{data:{created:Timesheet[]}}`. InicialPENDING y secuencia consecutiva por empleado/lugar/período |
| GET /timesheets | Admin paginado page1/pageSize25(máx100); filtros search/employeeId/clientId/workplaceId/siteId/month/year/status. Orden yearDESC,monthDESC,sequenceDESC,idASC |
| GET /timesheets/{id} | Detalle admin o propietario |
| PATCH /timesheets/{id}/status | Admin `{status:PENDING|LOADED|ERROR}`, devuelve Timesheet, version+1; serializado con reemplazo |
| PUT /timesheets/{id}/file | Admin multipart file único y expectedVersion entero>=1. Conserva identidad/período/secuencia/uploader/fechaoriginal; PENDING,version+1/replacedBy actualizado.409 FILE_VERSION_CONFLICT si cambió |
| GET /timesheets/{id}/file | Admin o propietario, `{data:{downloadUrl,expiresAt}}`, firma15min y no-store |
| POST /documents | Multipart type/files, workplaceId opcional(omitido/vacío/'null'→null); admin employeeId UUID, móvil deriva de sesión.201 móvil `{data:{documentIds,message}}`, admin `{data:{created:Document[]}}` |
| GET /documents | Admin paginado; filtros search/employeeId/type/uploadedBy(texto nombre/apellido uploader)/uploadedFrom/uploadedTo. Orden createdAtDESC,idASC |
| GET /documents/{id} | Detalle admin o propietario |
| PATCH /documents/{id} | Admin type y/o fileName, al menos uno; nombre visibletrim1–120, extensión real/contentType/fileKey intactos |
| DELETE /documents/{id} | Admin204, elimina metadata y programa borrado físico recuperable |
| GET /documents/{id}/file | Admin o propietario, misma respuesta firmada15min |
| GET /catalogs | Público ratificado: provincias/enums fijos con value/label español para uso antes del registro; sin empleados/clientes/lugares |

FiltrosAND, búsqueda parcial sin case/acentos por nombre de archivo y nombre/apellido/nombre completo/legajo empleado; uploadedBy busca nombre completo también. month1–12/year2000–9999, fechas uploadedFrom/To civiles reales GMT-3 inclusivas, from<=to; no alias from/to ni sort libre. Queries/campos desconocidos/repetidos o inválidos422 VALIDATION_ERROR. Cero bytes, exceso de archivos o multipart inválido422 VALIDATION_ERROR; tamaño422 FILE_TOO_LARGE; extensión/contenido422 FILE_TYPE_NOT_ALLOWED. Nombre de archivo sin rutas/control characters. TXT UTF8sinNUL; DOC WordOLE estructural acotado; DOCX WordOpenXML válido con ZIP/XMLlimitados, no XLSX/ZIP genérico o macro enabled disfrazado. No antivirus.

Nuevas cargas/reemplazos exigen empleado y lugar/cliente activos; lectura/descarga de históricos y cambio admin de status/metadata siguen disponibles aunque estén inactivos. Lugar con registros O planillas no permite cambiar cliente/provincia bajo lockWorkplace; relaciones iguales/nombre/geometría siguen editables.

Objetos nuevos en claves únicas antes de commit de metadata; lote visible todo-o-nada. Archivo anterior de reemplazo solo se limpia después de confirmar nuevo. Borrados fallidos/ambiguos tienen journal persistido y reintento; nunca borrar keys actualmente referenciadas. Publicación y worker coordinan locks/lease fresca e intentos para no publicar tras DELETE ambiguo; namespace de destino evita consumir cleanup de otro bucket/endpoint. Ante fallo R2, consistencia física eventual documentada en06; no se promete transacción distribuida perfecta. Descargas solicitan firma nueva al reintentar.

No DELETE de planillas. Catálogo DocumentType incluye INTERNAL_RULES→Normas internas, no alias INTERNAL_POLICIES. Labels completos en02. Incorporación de ajustes humanos al común pendiente de sync(propuesta20261017-files-contract).

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
| Detalle/eventos | Sección Asistencia / Detalle y metadata bajo demanda: RecordDetail/RecordInterval/AttendanceEventDetail con ajustes ratificados al final de03; implementación F-006 aprobada |
| Archivos/métricas | Sección Archivos y métricas: límites/atomicidad/búsquedas/descarga y contadores aprobados; DTOs ampliados aún en propuesta viva |

## Detalle backend y pendientes contractuales

- Matriz: estrategia F-006 definida: snapshot persistido PostgreSQL, payload inmutable en RepeatableRead, TTL absoluto15min; orden de texto PostgreSQL C, luego UUID empleado/lugar. Contexto usuario/filtros/orden/pageSize. Probar febrero bisiesto, 31 días, cero filas, filtros mixtos, dos páginas y escritura concurrente. Nunca devolver intervalos/eventos por celda; pedir detalle bajo demanda. Estos casos están verificados por HTTP/PostgreSQL real en test/records.e2e.cjs.
- Solicitud admin: POST inicial y resend → 202 challenge neutral completo; verify → submitted PENDING. Challenge 6 dígitos/10 min/5 intentos/cooldown 60 s, payload temporal máximo 72 h; decisión de un solo uso 7 días. Serialización de cancelación y reenvío/idempotencia tras respuesta perdida pendiente de especificar. No crear cuenta/cambiar rol ni revelar existencia antes de verificar. Endpoint email-only previo quedó sustituido por diseño común vigente.
- Sesión web: base de seguridad para desarrollo/pruebas ratificada en 04 (cookie __Host, preauth/CSRF, sesión interna y Origin exacto); propuesta común pendiente de sync. Dominios de producción, fallback y pruebas de navegador siguen pendientes para despliegue/F-010. Reenvío 2FA admin y logout offline frontend requieren precisión; no se exponen rutas/campos nuevos por suposición.
- Asistencia: online usa hora del servidor; offline conserva hora original y valida hora actual del teléfono al sincronizar (adelanto máximo dos minutos). Se conserva ventana offline24h y procesamiento por recepción. DTO y casos fuera de orden en05; API implementada y aprobada tras revisión independiente.
- Detalle F-006: ajustes ratificados e implementados al final de este documento. Metadata conserva contenido original; usos EventOrigin.ADMIN fuera de correcciones no definidos.
- Filtros/listados genéricos del diseño base no constituyen allowlist final para recursos todavía no cerrados. GET /catalogs público ratificado, limitado a provincias y enums fijos; sin datos operativos.
- El interceptor implementado conserva `{data,pagination}` y envuelve una sola vez los payloads simples. `ApiException` acepta cualquier string y no valida catálogo; 07 documenta el diseño, no validación automática.

## Diferencias abiertas con archivos/métricas mock

El humano ratificó `/dashboard/metrics` con month/year y byProvince (sección Dashboard). El humano ratificó expiresAt junto a downloadUrl, respuesta de upload según rol, INTERNAL_RULES y reemplazo PENDING con CAS/auditoría. DTOs de archivos/multipart/filtros se publican en esta sección; ajustes humanos comunes esperan incorporación/sync. No inferir aprobación de los servicios frontend. El diseño base anterior no cubre aún todas esas necesidades. URLs firmadas de 15 min se solicitan al descargar, sin persistirlas como dato estable.

## Evidencia de implementación vigente

HealthController devuelve payload plano envuelto por interceptor. AppModule registra filtro, interceptor y ValidationPipe; guard JWT real con usuario/sesión vigente. Prisma incluye User/Site, estructura, auth base y asistencia. No hay bypass de autenticación ni rutas para emitir tokens de prueba. Disponibilidad específica y límites en01/02/04/05.

## Implementación de estructura

`src/modules/structure/` implementa P-07 del contrato común, sin DELETE. Búsqueda literal parcial sin acentos; filtros AND y orden name,id ASC; listado/count comparten snapshot RepeatableRead para no desalinear paginación. Unicidades normalizadas se garantizan por índices SQL incluso bajo concurrencia. PUT exige todos los editables, incluyendo gpsAccuracyThreshold explícito null. Corrección del lugar en su cliente INACTIVE se conserva; crear/reasignar a cliente INACTIVE se rechaza. Guard comprueba usuario/rol/estado vigente, no solo claims. Comandos de verificación y DB aislada en `test/README.md`.

Estructura cerrada tras revisión independiente: build/lint y 8/8 pruebas HTTP/PostgreSQL con JWT reales. La regresión determinista de reasignación concurrente exige lock Workplace antes de leer clientId y luego Client; evita decisiones históricas basadas en relaciones obsoletas. Sin observaciones técnicas pendientes de F-003.

## Implementación auth base

Las rutas de password-login y sesiones de 04 están registradas bajo `/api/v1/auth`; OTP/2FA obligatorio, sin bypass. Registro, Google, magic link, password-recovery/reset y admin-access-request siguen pendientes F-008. `/auth/otp/verify` acepta solo LOGIN en esta etapa; no simula REGISTER/GOOGLE_LOGIN.

Web exige bootstrap GET csrf y Origin/X-CSRF-Token para login/2FA y mutaciones, refresh solo cookie, access solo JSON; GET csrf después de autenticar obtiene token de sesión renovado. Login ADMIN con sesión activa requiere logout previo. Mobile refresh responde únicamente tokens. Logout mobile revoca sesión del access; web revoca cadena de cookie. Errores de parser JSON 400 se traducen al español, sin alterar ApiException de dominio. Auth incluye no-store aun en errores. Verificación HTTP/DB y entorno en test/README.md; no equivale a pruebas de navegador ni proveedores reales.

## Implementación de empleados y perfil

`src/modules/users/` implementa P-06: ADMIN/SUPER_ADMIN gestionan exclusivamente EMPLOYEE, sin DELETE ni gestión de roles/contraseñas por PATCH; perfil devuelve solo identidad EMPLOYEE autenticada. Listas/detalle usan selecciones explícitas, sin passwordHash, role o contraseña inicial, con SiteReference y fechas civiles YYYY-MM-DD. Búsqueda literal parcial case-insensitive en campos publicados, orden lastName/firstName/id y snapshot consistente de listado/total.

Alta ACTIVE, contraseña Argon2 y emailVerifiedAt al crear. Política únicamente local (04); no hay mensajes ni llamadas de red al crear empleado. PATCH conserva omitidos y admite null solo en cuil/hireDate/position. Valida fechas civiles reales/no futuras en GMT-3, incluyendo bisiestos y rechazo de año0000. Un índice SQL lower(trim(email)) garantiza unicidad global frente a legado; migración falla ante colisiones históricas sin fusionar/borrar identidades. DNI y legajo conservan constraints globales y errores específicos incluso concurrentes.

Desactivar bloquea User y revoca todas sus sesiones en una transacción, compatible con refresh y OTP; reactivar no restaura sesiones. Cierre F-004 aprobado por reviewer independiente: build/lint y 38/38 pruebas HTTP/PostgreSQL (auth14, estructura8, users16), sin observaciones abiertas. Comandos y entorno en test/README.md.

## Implementación de asistencia

F-005 cerrada tras reviewer independiente y verificación final: build/lint y64/64 pruebas HTTP/PostgreSQL (asistencia26,auth14,estructura8,users16), sin pendientes técnicos. AttendanceModule registra ingesta/status y valida sesiones reales. Transacción User→Workplace→Client persiste evento/proyección; replay conserva respuesta y protege identidad. Detalle temporal/GPS/proyección en05. Cinco migraciones y seed verificadas desde DB nueva dedicada.

Guard histórico de estructura impide cambiar cliente/provincia tras primer registro con ambas carreras cubiertas. UUID se canonicalizan tras validación, por lo que mayúsculas no simulan reasignaciones ni bloquean la edición del mismo cliente inactivo.

## Registros admin (F-006 implementada y aprobada)

Detalle de intervalos usa IntervalReviewStatus NONE/PENDING/APPROVED, nunca MANUAL_LOADED; corrección marca origin MANUAL y el registro MANUAL_LOADED. Evento conserva recordId si se elimina su intervalo; AttendanceEventDetail.intervalId puede ser null. Estos ajustes del DTO mock fueron ratificados por el humano; propuesta común pendiente de sync.

No dividir filas mensuales por contexto histórico: el humano eligió impedir cambiar clientId/siteId de workplaces con registros. Guardar snapshots al crear registros para auditoría; fila mensual sigue empleado–lugar. Validación bajo lock Workplace evita carrera con el primer registro, error400 INVALID_WORKPLACE_DATA. F-005 incorpora ese guard de integración; cerrado y aprobado.

Detalle F-006: GET /records/monthly, GET /records/{id}, GET /attendance-events/{id}, POST /records, PATCH /records/{id}, PATCH /records/{id}/review exclusivamente ADMIN/SUPER_ADMIN. No diario GET /records ni revisión individual de intervalo; no DELETE de registros. CreateRecord.observations e IntervalInput completo son obligatorios con nullables explícitos; omisión conserva solo campos opcionales de UpdateRecord e intervalos no mencionados. Reglas manuales de día/solapamiento en05.

Metadata de evento: escalares de deviceInfo de primer nivel se exponen salvo nombres reservados; metadata.clientRequestId proviene de DB y metadata.clientSentAt es ISO|null de DB. deviceInfoJson conserva JSON.stringify del original cuando hay contenido anidado o colisión de nombre reservado. Reservados: id,userId,workplaceId,recordId,intervalId,occurredAt,receivedAt,createdAt,updatedAt,origin,locationTimestamp,clientRequestId,clientSentAt,deviceInfoJson,__proto__,constructor,prototype. Location.accuracyMeters mapea accuracy; capturedAt conserva locationTimestamp original. No altera el evento persistido ni certifica datos del teléfono.

Snapshot mensual: propietario/filtros/orden/pageSize canónicos, TTL absoluto15min; page1 sin token crea, siguientes requieren token. Payload completo inmutable persiste en DB y sobrevive reinicios; páginas posteriores no reconsultan dominio. Captura coherente en RepeatableRead; limpieza de snapshots vencidos fuera de esa transacción evita conflictos entre consultas concurrentes. Orden PostgreSQL COLLATE C para apellido/nombre/lugar y desempate UUID empleado/lugar. Totales de todas filas seleccionadas, filtros de estado/revisión/origen/ausencia coinciden en el mismo registro diario.

GET /records/{id} captura registro, versión, totales e intervalos en una sola transacción RepeatableRead: Prisma puede consultar relaciones en SELECTs separados y no debe mezclar estados de commits diferentes. Verificado por regresión HTTP/PostgreSQL con commit concurrente.

Cierre F-006 aprobado por reviewer independiente y verificación final del leader: build/lint y87/87 HTTP/PostgreSQL (registros23,asistencia26,auth14,estructura8,users16), sin pendientes técnicos. Seis migraciones y seed probadas desde DB vacía dedicada; detalle/matriz coherentes, concurrencia de limpieza corregida y snapshots persistentes al reiniciar API. Comandos en test/README.md.
