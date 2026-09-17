<!-- SYNCED-FROM-TEMPLATE: gestionado desde GdesProject/template/. NO EDITAR en este repo; proponé cambios en docs/changes_proposals/. -->

# Contratos entre apps — fuente de verdad de integración

> Regla: cuando mobile o admin hablen con el backend, los nombres, tipos y formas de estos contratos mandan. Cambiar un contrato exige actualizar este archivo EN LA MISMA TAREA y avisar al leader.

## Estado actual

**Backend definido (2026-09-15):** el diseño completo está en `backend_api_gdes/docs/` (stack, modelo de datos, endpoints, auth, asistencia, integraciones, convenciones). Mobile y admin siguen operando con mocks hasta su implementación.

Este archivo queda como **índice de contratos y registro de decisiones de integración**; el detalle endpoint-por-endpoint vive en `backend_api_gdes/docs/03-contratos-api.md`, que materializa estas decisiones.

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
    - **Escrituras (A)**: `POST /records` crea completo; `PATCH /records/{id}` corrige. Concurrencia por **`expectedVersion`** en el body → `409 RECORD_VERSION_CONFLICT` (`retryable=false`); la UI conserva el formulario y ofrece recargar/comparar, nunca sobrescribe. Operaciones de intervalo ADD/UPDATE (sin DELETE); PATCH omitido conserva, null borra solo nullables; identidad empleado/lugar/fecha **inmutable** en PATCH. En carga manual se **rechazan intervalos solapados** (los históricos proyectados no se tocan) y no se aceptan WORK sin ambos extremos ni registros sin intervalos. Motivo de ausencia **opcional** también en carga manual (los null se muestran como "sin motivo", sin inventarlo).
    - **Revisión (B)**: la revisión pura (APPROVED/REJECTED sin editar datos) conserva origen y horarios — no convierte el registro en MANUAL; un rechazado corregido pasa a MANUAL_LOADED y puede aprobarse de nuevo; el rechazado permanece visible y editable. Metadata de eventos (AttendanceEvent) inmutable: la edición manual no crea, actualiza ni borra eventos.
    - **Inactividad e historia (D)**: INACTIVE bloquea operaciones nuevas; la lectura histórica siempre se conserva; las **cargas retrospectivas** (registro de fecha pasada, planilla atrasada, documento) se permiten como corrección histórica; desactivación requiere confirmación y revalidación del estado al guardar.
    - **Archivos y búsquedas (E)**: **20 MiB (20 × 1024 × 1024 bytes)** por archivo, máximo 10 por request, extensiones pdf/jpg/jpeg/png/doc/docx/txt (backend valida contenido además de extensión); lote **atómico** con rollback de DB y bucket si algo falla; búsqueda por fileName y nombre/apellido/legajo del empleado; descarga con URL firmada de 15 min (vigente), sin persistir URLs vencidas; borrar documento sí, borrar planilla no.
    - **Métricas de Inicio (F)**: contadores del **mes seleccionado** (el dashboard tiene selector de mes y los enlaces llevan a la vista filtrada del mismo período): `pendingTimesheets`, `incompleteRecords`, `pendingReviewRecords`, `recordsWithAbsence` (registros con al menos una ABSENCE, no intervalos ni horas).
    - Tarea de backend (ejecución): materializar DTOs completos por recurso (users/clients/sites/workplaces/records/catalogs/timesheets/documents), política de contraseña compartida, validaciones (teléfono 10–13 dígitos, DNI 7–8), allowlists de filtros/sort, ejemplos y pruebas de concurrencia.
12. **Mapa de lugares de trabajo (P-05) — ratificado 2026-09-17.** Requisito: mapa real con búsqueda de dirección, marcador movible y círculo en metros; no se sustituye por campos lat/lon ni se dibuja geografía a mano. Proveedor elegido: **Geoapify** (tiles + geocoding/autocomplete) con **Leaflet o MapLibre GL** (elección del renderizador: detalle técnico del leader admin). Decisiones asociadas: acceso **directo desde el navegador** con clave pública restringida por dominio (sin proxy backend); free tier (3.000 créditos/día, uso comercial permitido) con atribución visible obligatoria; Geoapify **permite persistir** las coordenadas confirmadas en la DB (requisito del flujo buscar → confirmar → guardar). Riesgo conocido: numeración de puerta OSM irregular en ciudades medianas/chicas de Argentina — si la validación con direcciones reales (F-010) falla, la contingencia aprobada es evaluar Mapbox o Google. Límites numéricos de radio/umbral GPS: los define backend al materializar el DTO de Workplace (P-04).

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
  REJECTED,
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

- ~~Endpoints concretos (rutas, métodos, códigos de error)~~ → definidos en `backend_api_gdes/docs/03-contratos-api.md`.
- ~~Autenticación real~~ → `backend_api_gdes/docs/04-auth-y-seguridad.md` (JWT 30 min + refresh 7 días con rotación, 2FA email admin, OTP WhatsApp en todo login mobile, verificación de email por magic link en el registro, Google OAuth).
- ~~Storage de archivos~~ → `backend_api_gdes/docs/06-integraciones.md` (Cloudflare R2, S3-compatible; upload proxificado, descarga con URL firmada).
- ~~Resolución de divergencias~~ → resueltas arriba.
- ~~Enums sin definir~~ → definidos en `backend_api_gdes/docs/02-modelo-de-datos.md`.
- ~~Contratos de entidades admin~~ → definidos en `backend_api_gdes/docs/02-modelo-de-datos.md` y `03-contratos-api.md`.

Pendientes menores abiertos (no bloquean el diseño):

- Pendientes tras la ratificación 2026-09-17 de P-01..P-05 (`admin_web_app/docs/changes_proposals/`): **dominios tentativos del backend** (2026-09-17, a confirmar en el deploy): producción `https://backend-api-gdes-prod.vercel.app`, test `https://backend-api-gdes-dev.vercel.app`. Advertencia: `vercel.app` está en la Public Suffix List — si la web admin vive en otro subdominio de `vercel.app`, cookie y CORS son **cross-site** (`SameSite=None; Secure`, con riesgo de bloqueo de cookies de terceros en navegadores); evaluar dominio propio o despliegue same-site al definir el deploy. Siguen pendientes: orígenes de la **web admin** (allowlist CORS), identificador de generación de sesión y mecanismo CSRF exacto (los propone backend y los ratifica el humano), atributos definitivos de cookie, y límites numéricos de radio/umbral GPS de workplaces. Lo demás de P-01 a P-05 quedó ratificado en las decisiones 8–12; backend materializa DTOs, ejemplos y catálogo de errores. Proveedor de mapas ya elegido: Geoapify (decisión 12).
- Campos de perfil `cuil`, `hireDate`, `position`: existen en el mock de mobile pero no en el alta de la spec admin — quedan nullable en `User` hasta confirmar origen de carga.
- Ventana máxima para marcaciones offline tardías: sin límite en MVP.
