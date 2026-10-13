<!-- SYNCED-FROM-TEMPLATE: gestionado desde GdesProject/template/. NO EDITAR en este repo; proponé cambios en docs/changes_proposals/. -->

# Contratos entre apps — fuente de verdad de integración

> Regla: cuando mobile o admin hablen con el backend, los nombres, tipos y formas de estos contratos mandan. Cambiar un contrato exige actualizar este archivo EN LA MISMA TAREA y avisar al leader.

## Estado actual

**Diseño base definido (2026-09-15); materialización contractual incompleta al 2026-10-12.** El backend documenta stack, modelo, auth, asistencia e integraciones, pero `backend_api_gdes/docs/03-contratos-api.md` aún contradice decisiones ratificadas después (P-01..P-07 y F-006). Mobile y admin siguen operando con mocks; la disponibilidad del backend de integración no se infiere de estos documentos.

Este archivo es el **índice de contratos y registro de decisiones de integración**. El detalle endpoint-por-endpoint y los DTOs aprobados deben quedar materializados en `backend_api_gdes/docs/03-contratos-api.md`; mientras exista una divergencia, prevalecen las decisiones humanas de este archivo y la propuesta ratificada que la documenta.

## Decisiones de integración (resueltas por el humano, 2026-09-15)

Estas resoluciones cierran las divergencias que estaban abiertas. Mandan sobre mobile y sobre las sugerencias de la spec de admin (Parte 8), que eran propuestas de un agente, no contratos cerrados.

1. **Campos del usuario/empleado → inglés en contrato, español en interfaz.** Todo el código y los contratos en inglés (`firstName`, `lastName`, `employeeId`); todo lo visible en UI en español (obligatorio), incluidos `error.message` y labels de catálogos. La relación legajo/`employeeId` es correcta tal cual. Mobile debe migrar `AuthUser { nombre; apellido; legajo }` → `{ id; firstName; lastName; email; employeeId; role }`.
2. **Modelo del registro horario → eventos atómicos + proyección a registro diario.** Mobile emite eventos (`CHECK_IN`/`CHECK_OUT`/`ABSENCE`, un timestamp por evento); el backend los persiste append-only (`AttendanceEvent`) y proyecta el registro diario por `(userId, workplaceId, date)` con múltiples intervalos (algoritmo spec §23). Detalle: `backend_api_gdes/docs/05-asistencia-eventos-y-registros.md`.
3. **Formato de respuesta → envoltorio `{ "data": ... }`** para todos los endpoints (listados: `{ "data": [], "pagination": {} }`). Mobile migra sus `{ success, message, registrationId? }` a `{ data: { eventId, recordId, message } }`.
4. **Formato de error → `{ error: { code, message, retryable } }`** (la sugerencia de admin, que el humano prefiere). `code` SCREAMING_SNAKE en inglés, `message` en español, `retryable` coherente con HTTP status. Catálogo de códigos: `backend_api_gdes/docs/07-convenciones.md`.
5. **Referencia al lugar en cargas documentales → siempre `workplaceId`.** Planillas: requerido (spec §39.3). Contingencia: `workplaceId: string | null`. Mobile migra `DocumentUploadRequest.workplace` → `workplaceId`.
6. **Roles → `UserRole { EMPLOYEE, TO_BE_ADMIN, ADMIN, SUPER_ADMIN }`** (TO_BE_ADMIN como rol explícito, spec §10). A la app mobile solo accede rol `EMPLOYEE` (otro rol → 403 `ROLE_NOT_ALLOWED`). `AuthUser` gana el campo `role`.
7. **Verificación en auth mobile (2026-09-16).** Todo login mobile — identifier+password y Google — exige OTP WhatsApp como segundo paso (`/auth/login` y `/auth/google` responden 202 + `challengeId`; los tokens solo salen de `/auth/otp/verify`). El registro mobile exige OTP WhatsApp + verificación de email por magic link: tras el OTP la cuenta queda creada pero sin tokens, bloqueada para login (403 `EMAIL_NOT_VERIFIED`) hasta confirmar el email. Admin web mantiene 2FA por código de email en login y registro (sin cambios). Detalle: `backend_api_gdes/docs/04-auth-y-seguridad.md`.

## Decisiones de integración (confirmadas por el humano, 2026-09-17)

Origen: propuestas `admin_web_app/docs/changes_proposals/20260917-p01..p05-*.md`. Primera ronda (mañana del 2026-09-17): solo decisiones ya confirmadas. Segunda ronda (misma fecha): el humano ratificó los diseños candidatos que abajo se marcan como **ratificado**. Lo que sigue pendiente se indica explícitamente y no es contrato.

8. **Consulta mensual de registros (P-01) — ratificado 2026-09-17.** La revisión de registros del mes usa una **matriz empleado–lugar**: solo filas con actividad en el mes (una ausencia cuenta como actividad; no se sintetizan filas sin actividad y no hay asignaciones permanentes) y paginación por **filas completas** — una página nunca corta una fila y cada fila trae los 28/29/30/31 días del mes. Detalle de intervalos/metadata bajo demanda al abrir el detalle, nunca una request por celda. Aprobado además:
   - Ruta `GET /api/v1/records/monthly` (ADMIN/SUPER_ADMIN): `month`+`year` obligatorios, `page` base 1, `pageSize` default 50 / máximo 100. Los tipos de la propuesta P-01 (`MonthlyQuery`, `Day`, `MonthlyRow`, `MonthlyResponse` con `meta.snapshotToken/snapshotExpiresAt/totals`) quedan aprobados tal cual; backend los materializa en `backend_api_gdes/docs/03-contratos-api.md`.
   - `siteId` filtra por la provincia **del lugar** (no la personal del empleado). Filtros de estado/revisión/origen/ausencia: conjunción sobre UN MISMO registro diario; la fila devuelve todos sus días, los no coincidentes con `matchesFilters=false` (no permiten crear duplicados). Totales de fila y totales globales sobre TODAS las filas seleccionadas, no solo la página.
   - Orden fijo: apellido, nombre, nombre de lugar, UUID de empleado, UUID de lugar; la collation la define backend.
   - **Snapshot de lectura** opaco ligado a usuario/filtros/orden, **TTL 15 minutos**: la primera página lo crea, las siguientes lo envían. Errores `410 MONTHLY_SNAPSHOT_EXPIRED` y `400 MONTHLY_SNAPSHOT_MISMATCH`, ambos `retryable=false` (caducidad → reiniciar desde página 1). Crear sobre un día EMPTY puede recibir `409 RECORD_ALREADY_EXISTS` por escritura posterior al snapshot: recuperar el registro, nunca sobrescribir. El snapshot no autoriza escrituras: el POST revalida unicidad y permisos actuales.
   - Evidencia pendiente de backend (ejecución, no decisión): ejemplos de febrero bisiesto, mes de 31 días, filas mixtas, cero filas, dos páginas y escritura concurrente.
9. **Sesión web admin (P-02) — parcialmente ratificado 2026-09-17.** Aprobado: refresh web en **cookie HttpOnly emitida por el backend**, access token **solo en memoria**; rutas nuevas `/auth/web/csrf`, `/auth/web/session`, `/auth/web/refresh`, `/auth/web/logout`; el login existente solo gana `rememberSession` con `client=ADMIN`; la respuesta 2FA web no lleva refresh en JSON; `sessionExpiresAt` es un límite absoluto que no se reinicia al rotar; ante respuesta de refresh perdida/ambigua → **relogin** (no se relaja la detección de reuso); mobile conserva su refresh en JSON sin cambios. Los tipos candidatos de P-02 quedan aprobados como base. Pendientes: orígenes exactos de CORS/cookies (se definen al momento del deploy), atributos definitivos de cookie, identificador de generación de sesión y mecanismo CSRF exacto (backend los propone y el humano los ratifica), y las pruebas de navegador de F-010.
10. **Solicitud de acceso admin (P-03) — ratificado 2026-09-17.** Ninguna creación de cuenta ni cambio de rol ocurre antes de **verificar el email** del solicitante; el formulario preserva los **diez campos** (nombre, apellido, email, contraseña, teléfono, DNI, legajo, domicilio, provincia, nacimiento). Aprobado además:
    - Se **amplía la ruta existente** `POST /auth/admin-access-request` (sin versionar). Challenge con código de 6 dígitos: **TTL 10 min, máximo 5 intentos, cooldown de reenvío 60 s**. Payload pendiente sin verificar: se elimina a las **72 h**. Link de decisión (aprobar/rechazar): expira a los **7 días**, GET solo muestra UI y exige confirmación explícita antes del POST; token de un solo uso.
    - Cuenta existente: se exige **contraseña actual** además del OTP; se preservan perfil y password (no se reemplazan por el del formulario). Email/DNI/legajo en conflicto con otra cuenta → `409 ADMIN_REQUEST_IDENTITY_CONFLICT`, sin fusionar. Discrepancias en datos no identitarios → advertir tras verificar y continuar, sin sobrescribir. Cuenta que pasa a INACTIVE con decisión pendiente → solicitud **cancelada**. Respuestas neutrales: nunca revelar existencia de cuentas ni rol antes de verificar.
    - Los tipos candidatos de P-03 quedan aprobados como base; backend publica DTOs completos, respuestas neutrales y catálogo de errores (`403 ADMIN_REQUEST_NOT_ELIGIBLE`, etc.).
11. **Registros, entidades y archivos (P-04) — ratificado 2026-09-17.**
    - **Completitud y proyección (B)**: WORK con ambos extremos → CLOSED, aporta la diferencia en minutos, COMPLETE si es único intervalo; WORK con un solo extremo → OPEN/SEMI_CLOSED, aporte 0, INCOMPLETE. ABSENCE sin extremos o con ambos → CLOSED, aporte 0, COMPLETE; con un solo extremo → OPEN/SEMI_CLOSED, aporte 0, INCOMPLETE. Total del registro = **suma de WORK CLOSED**; no existe campo de horas de ausencia. **Medianoche**: jornada que cruza 00:00 GMT-3 → dos registros (día A OPEN, día B SEMI_CLOSED; ambos INCOMPLETE, 0 minutos cerrados); sin cierre ni fusión automática. Algoritmo vigente: entrada agrega intervalo, salida cierra el último abierto del mismo registro diario; la suma incluye solapamientos (09:00/11:00/12:00/18:00 → **600 minutos**; corrige el ejemplo contradictorio de la spec §23).
    - **Escrituras (A)**: `POST /records` crea completo; `PATCH /records/{id}` corrige. Concurrencia por **`expectedVersion`** en el body → `409 RECORD_VERSION_CONFLICT` (`retryable=false`); la UI conserva el formulario y ofrece recargar/comparar, nunca sobrescribe. Operaciones de intervalo ADD/UPDATE; la operación DELETE ratificada se especifica en la decisión 13. PATCH omitido conserva, null borra solo nullables; identidad empleado/lugar/fecha **inmutable** en PATCH. En carga manual se **rechazan intervalos solapados** (los históricos proyectados no se tocan) y no se aceptan WORK sin ambos extremos ni registros sin intervalos. Motivo de ausencia **opcional** también en carga manual (los null se muestran como "sin motivo", sin inventarlo).
    - **Revisión**: la aprobación es una operación pura que conserva origen, horarios y eventos; no existe estado `REJECTED`. La corrección manual cambia la proyección a `MANUAL_LOADED`; luego puede aprobarse. La metadata de `AttendanceEvent` es inmutable: la edición manual no crea, actualiza ni borra eventos.
    - **Inactividad e historia (D)**: INACTIVE bloquea operaciones nuevas; la lectura histórica siempre se conserva; las **cargas retrospectivas** (registro de fecha pasada, planilla atrasada, documento) se permiten como corrección histórica; desactivación requiere confirmación y revalidación del estado al guardar.
    - **Archivos y búsquedas (E)**: **20 MiB (20 × 1024 × 1024 bytes)** por archivo, máximo 10 por request, extensiones pdf/jpg/jpeg/png/doc/docx/txt (backend valida contenido además de extensión); lote **atómico** con rollback de DB y bucket si algo falla; búsqueda por fileName y nombre/apellido/legajo del empleado; descarga con URL firmada de 15 min (vigente), sin persistir URLs vencidas; borrar documento sí, borrar planilla no.
    - **Métricas de Inicio (F)**: contadores del **mes seleccionado** (el dashboard tiene selector de mes y los enlaces llevan a la vista filtrada del mismo período): `pendingTimesheets`, `incompleteRecords`, `pendingReviewRecords`, `recordsWithAbsence` (registros con al menos una ABSENCE, no intervalos ni horas).
    - Tarea de backend (ejecución): materializar DTOs completos por recurso (users/clients/sites/workplaces/records/catalogs/timesheets/documents), política de contraseña compartida, validaciones (teléfono 10–13 dígitos, DNI 7–8), allowlists de filtros/sort, ejemplos y pruebas de concurrencia.
12. **Mapa de lugares de trabajo (P-05) — decisión humana actualizada 2026-09-18.** Admin usa **Google Maps Platform**: Maps JavaScript API y Places API (New), con `PlaceAutocompleteElement`, restringido a Argentina. Carga directa desde navegador con `VITE_GOOGLE_MAPS_API_KEY` pública, restringida por HTTP referrer y por API; no requiere proxy. Autocomplete solo centra/encuadra: la ubicación se confirma con clic, arrastre del marcador o coordenadas numéricas. Se persisten solo `latitude`, `longitude`, `radiusMeters` y `gpsAccuracyThreshold`; no dirección, Place ID, predicciones, viewport ni resultados de geocoder. Marker y Circle se sincronizan; atribución Google visible; no fallback a proveedores OSM públicos. Contrato HTTP de Workplace sin campos de ubicación textual. El costo/free tier citado al decidir es una estimación histórica y debe verificarse al configurar billing.
13. **Aprobación y corrección de intervalos (F-006) — ratificado 2026-09-19.** `ReviewStatus = NONE | PENDING | APPROVED | MANUAL_LOADED`; `IntervalReviewStatus = NONE | PENDING | APPROVED`. La aprobación pura usa `PATCH /api/v1/records/{id}/review` con `{ expectedVersion, reviewStatus: "APPROVED" }`, devuelve `{ data: RecordDetail }`, incrementa `version` y no altera origen, observaciones, horarios ni intervalos. Conflicto de versión → `409 RECORD_VERSION_CONFLICT` (`retryable=false`). La corrección `PATCH /api/v1/records/{id}` admite operación `DELETE` de un intervalo, además de ADD/UPDATE; exige `expectedVersion`, el intervalo debe pertenecer al registro y siempre debe quedar al menos uno (`422 RECORD_INTERVALS_REQUIRED`). El backend recalcula la proyección. `AttendanceEvent` sigue siendo evidencia inmutable; eliminar de la proyección no elimina eventos.
14. **Contratos frontend de empleados (P-06) y clientes/lugares (P-07) — ratificados 2026-09-17.** Las propuestas `admin_web_app/docs/changes_proposals/20260917-p06-contrato-empleados.md` y `20260917-p07-contrato-clientes-lugares.md` son la fuente de los DTOs/rutas/validaciones/errores aprobados para Admin. El backend debe materializar/alinear `GET/POST/PUT/PATCH` de `/users`, `/clients`, `/workplaces` y `/sites` allí definidos, incluidos estados, filtros, paginación, referencias y límites geográficos: `radiusMeters` entero entre 10 y 10.000; `gpsAccuracyThreshold` nullable, entero entre 1 y 1.000. No exponer `passwordHash`; no agregar dirección/Place ID al DTO Workplace. Hasta que backend actualice el doc 03, no afirmar que estos contratos están disponibles en API real.
15. **Detalle de registros y eventos (F-006) — aprobado para mocks el 2026-09-19.** Al abrir registro: `GET /api/v1/records/{id}` devuelve detalle, intervalos y referencias livianas a eventos automáticos; `GET /api/v1/attendance-events/{id}` devuelve metadata bajo demanda. Intervalos manuales no sintetizan eventos. La metadata es de solo lectura. La forma exacta de los DTOs publicados en la propuesta `20260919-f006-detalle-registro-eventos.md` debe confirmarse/materializarse por backend antes de integración real.
16. **Ventana de marcaciones offline tardías — ratificado el 2026-10-12.** El backend acepta una marcación si al recibirla han transcurrido como máximo 24 horas desde `occurredAt`: `receivedAt - occurredAt <= 24 h`, usando `receivedAt` asignado por el servidor (no un timestamp de recepción enviado por el cliente). Marcaciones más antiguas se rechazan. Backend debe materializar el error y su código en `docs/07-convenciones.md`, validar el límite y aportar pruebas de frontera para exactamente 24 horas y más de 24 horas. El manejo de timestamps futuros/clock skew no queda definido por esta decisión.

## Contratos relevados

> Los tipos originales de mobile (español, `{ success, message }`, etc.) quedan abajo como registro histórico del estado relevado. Los contratos vigentes son los de las decisiones anteriores + `backend_api_gdes/docs/03-contratos-api.md`.

### Sesión / usuario autenticado (mobile)

Fuente: `mobile_app_gdes/stores/authStore.ts`. Produce y consume: mobile (hoy solo local, persistido en AsyncStorage; no existe token). Es lo que el backend deberá devolver al autenticar.

```ts
export interface AuthUser {
  id: string;
  nombre: string;
  apellido: string;
  email: string;
  legajo: string;
}
```

### Marcación / registro horario (mobile)

Fuente: `mobile_app_gdes/types/api.ts`. Produce: mobile (empleado). Consumirá: backend → admin (revisión de registros).

```ts
export type RegisterAction = "entrada" | "salida" | "ausencia";

export interface RegisterRequest {
  workplaceId: string;
  action: RegisterAction;
  observation?: string;
  timestamp: string;
  // Location data
  latitude: number;
  longitude: number;
  accuracy: number;
  locationTimestamp: string;
}

export interface RegisterResponse {
  success: boolean;
  message: string;
  registrationId?: string;
}

// Error types
export interface ApiError {
  code: string;
  message: string;
}
```

Nota relevada (`mobile_app_gdes/docs/05`): `observation` viaja, pero el motivo de ausencia (enfermedad/franco/otros) queda en estado local y **no** se incorpora al request.

### Lugares de trabajo (mobile)

Fuente: `mobile_app_gdes/types/workplace.ts`. Producirá: backend (gestionado desde admin). Consume: mobile.

```ts
export interface Workplace {
  id: string;
  name: string;
  siteId: string;
  siteName: string;
  active: boolean;
}
```

### Planillas (mobile)

Fuente: `mobile_app_gdes/types/document.ts`. Produce: mobile (empleado). Consumirá: backend → admin (procesamiento de planillas).

```ts
export interface DocumentUploadRequest {
  workplace: string;
  months: string[];
  files: string[]; // Array of file URIs
  uploadedAt: string;
}

export interface DocumentUploadResponse {
  success: boolean;
  message: string;
  documentId?: string;
}
```

Nota relevada (`mobile_app_gdes/docs/02` y `05`): la UI envía `months: []` fijo y URIs locales de imagen; el lugar se muestra pero no es obligatorio para habilitar el envío.

### Documentos de contingencia / legajo (mobile)

Fuente: `mobile_app_gdes/types/document.ts`. Produce: mobile (empleado). Consumirá: backend → admin (legajo digital del empleado).

```ts
// Allowed file extensions for contingency documentation
export const ALLOWED_EXTENSIONS = [
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "docx",
  "doc",
  "txt",
] as const;

// A single attached file selected by the user
export interface SelectedFile {
  uri: string;
  name: string;
  type: string; // extension, e.g. "pdf"
  size: number; // bytes
}

export interface ContingencyUploadRequest {
  workplaceId: string | null;
  files: SelectedFile[];
  uploadedAt: string;
}

export interface ContingencyUploadResponse {
  success: boolean;
  message: string;
}
```

Nota relevada (`mobile_app_gdes/docs/02`): la UI envía `workplaceId: null` y no valida tamaño, duplicados ni cantidad.

### Modelos y convenciones sugeridos por la spec de admin

Fuente: `admin_web_app/docs/spec_definition.md` Parte 8. Son **sugerencias de la spec**, no contratos vigentes: la spec repite que "el formato final dependerá del backend".

DTO de API vs modelo de dominio (sección 88):

```ts
interface UserResponseDto {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}
```

```ts
interface User {
  id: string;
  fullName: string;
  email: string;
}
```

Enums centralizados (sección 89, copiados tal como aparecen en la spec):

```ts
enum UserRole {
  EMPLOYEE,
  ADMIN,
  SUPER_ADMIN
}

enum RecordStatus {
  COMPLETE,
  INCOMPLETE
}

enum ReviewStatus {
  NONE,
  PENDING,
  APPROVED,
  REJECTED, // enum histórico de la spec: retirado por decisión 13
  MANUAL_LOADED
}
```

La spec indica que también deben existir: `IntervalStatus`, `IntervalType`, `AccountStatus`, `TimesheetStatus`, `DocumentType`, `RecordOrigin`, `Site` (sin definición en la fuente — pendiente).

Convenciones REST sugeridas (secciones 81-86):

- Recursos: `/users`, `/records`, `/clients`, `/sites`, `/workplaces`, `/timesheets`, `/documents`, `/auth`.
- Paginación server-side: `?page=1&pageSize=25`, respuesta `{ items, pagination: { page, pageSize, totalItems, totalPages } }`.
- Filtros explícitos en la URL (ej. `GET /records?month=5&year=2026&siteId=123&employeeId=456&status=INCOMPLETE`); ordenamiento `?sortBy=lastName&order=asc`.
- El módulo de registros usa infinite scroll: paginación interna con `useInfiniteQuery()`, sin paginación visual.
- Respuesta exitosa sugerida: `{ "data": {...} }`; listados: `{ "data": [], "pagination": {} }`.
- Error uniforme sugerido: `{ "error": { "code": "USER_ALREADY_EXISTS", "message": "El usuario ya existe", "retryable": false } }`. El frontend no debe depender únicamente de `retryable`.

## Divergencias resueltas

Las 6 divergencias detectadas entre mobile y la spec de admin fueron resueltas por el humano el 2026-09-15 — ver "Decisiones de integración" arriba. Este registro histórico se mantiene solo como contexto.

## Pendiente de definir con el humano

Las decisiones de producto P-01, P-03 a P-07 y la política principal de F-006 están ratificadas. Los pendientes listados abajo son únicamente los puntos donde falta una definición humana o una propuesta técnica del backend; no deben convertirse en supuestos de integración.

- **P-02 / autenticación web:** falta que backend proponga un identificador de generación de sesión y un mecanismo CSRF exacto para que el humano los ratifique. Los orígenes concretos, atributos de cookie y pruebas de navegador se cierran cuando exista el despliegue web/API elegido.
- **Datos de perfil opcionales:** P-06 permite que Admin actualice `cuil`, `hireDate` y `position`; el alta no los incluye y `UserDetail` los devuelve nullable. La carga inicial/importación de valores históricos no está especificada y puede permanecer nula hasta su actualización por Admin.

Pendientes de integración (no son decisiones abiertas de producto):

- **P-02 / despliegue**: el humano prefiere mantener web y backend en proyectos Vercel separados, pero difiere la elección de dominios/orígenes finales hasta más adelante y sujeta auth a pruebas. Es propietario de `prolimpservicios.com`; `admin.prolimpservicios.com` es un candidato, no una decisión. Si Admin usa ese host pero API queda en `backend-gdes.vercel.app`, seguirá siendo cross-site. Si se mapea el proyecto backend a `api.prolimpservicios.com`, Admin y API serían same-site pero seguirían siendo cross-origin y necesitarían CORS. Vercel permite asignar dominios/subdominios propios a proyectos y requiere configurar/verificar DNS. Los dominios tentativos del backend son `https://backend-api-gdes-prod.vercel.app` y `https://backend-api-gdes-dev.vercel.app`; confirmar al desplegar. `vercel.app` figura en la Public Suffix List: subdominios distintos son sitios distintos, así que la cookie de API usada desde Admin es cross-site. `SameSite=None; Secure` es necesario para el envío cross-site, pero no evita que el navegador o sus ajustes/extensiones bloqueen o particionen cookies de terceros. CORS debe permitir solo orígenes exactos y credenciales; CORS no anula las políticas de cookies. Esto puede romper restauración/refresh de sesión en ciertos navegadores. Antes de cerrar P-02 hay que verificar los navegadores objetivo y documentar fallback. Alternativas a revisar si falla: dominios propios same-site para Admin/API, o proxy/BFF same-origin. Faltan URLs reales, atributos de cookie, identificador de generación de sesión y mecanismo CSRF exacto; backend propone generación/CSRF y el humano ratifica.
- **Backend**: materializar en docs y API las decisiones 8–16; publicar DTOs, catálogo de errores y ejemplos verificables. Particularmente P-01 mensual, P-02 web auth, P-03 solicitud admin, P-04 reglas, P-06/P-07 entidades y F-006 aprobación/detalle.
- **Estado de sincronización de propuestas al 2026-10-12**: P-01/P-03/P-04/P-05 y P-06/P-07 tienen decisión ratificada; P-02 está parcialmente ratificada y la preferencia humana es mantener proyectos Vercel separados, con dominios/orígenes aún por elegir y auth sujeta a pruebas; la ventana offline de 24 h quedó ratificada el 2026-10-12; F-006 aprobación/eliminación está ratificada y su propuesta de detalle está aprobada para mocks con DTO backend pendiente. Los archivos de admin `20260918-google-maps-synced-contract.md`, `20260919-f006-aprobacion-y-eliminacion-intervalos.md` y `20260919-f006-detalle-registro-eventos.md` requerían esta consolidación. No hay propuestas de cambio nuevas en los otros dos subrepos.
