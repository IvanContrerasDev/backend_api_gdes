<!-- SYNCED-FROM-TEMPLATE: gestionado desde GdesProject/template/. NO EDITAR en este repo; proponé cambios en docs/changes_proposals/. -->

# Contratos entre apps

## Alcance y disponibilidad

Fuente canónica de los acuerdos de integración: una sección vigente por tema, con motivo breve. Los tres subrepos reciben copias idénticas desde `GdesProject/template/`. El detalle interno del backend vive en sus docs 02–07; las specs locales enlazan este contrato y no redefinen DTOs comunes.

**Estado comprobado en código al 2026-10-16:** mobile opera con mocks y sesión local; Admin tiene aplicación React con adaptadores mock/HTTP y módulos operativos mock; backend tiene bootstrap NestJS/Prisma, modelos User/Site y únicamente `GET /health`. `src/app.module.ts` no registra módulos de dominio y `src/main.ts` no aplica prefijo `/api/v1`. Las rutas de dominio de este documento son **diseño acordado pendiente de implementación**, no API disponible. La integración real y sus pruebas siguen pendientes.

Brechas de implementación: Prisma conserva `REJECTED` en enums de revisión, mientras el contrato lo excluye; su DocumentType usa INTERNAL_RULES frente a INTERNAL_POLICIES del mock Admin, sin mapping ratificado; Admin usa el enum de revisión de registro también en intervalos. Mobile conserva campos y respuestas locales distintos. No convertir esas diferencias en decisiones aprobadas ni modificar producto en una limpieza documental.

## Convenciones

- Base diseñada `/api/v1`; JSON con campos en inglés e interfaz y `error.message` en español. IDs de entidades UUID; timestamps ISO 8601 UTC; fechas civiles `YYYY-MM-DD` en GMT-3.
- Éxito `{ data: T }`; listas `{ data: T[], pagination: { page, pageSize, totalItems, totalPages } }`; error `{ error: { code, message, retryable } }`. El frontend considera también HTTP status, no solo `retryable`.
- `employeeId` en un usuario es su legajo string; en queries de recursos es UUID de User cuando se indica como filtro de empleado. No intercambiarlos.
- No exponer passwords/hashes, claves privadas de archivos o refresh web en respuestas de recursos.
- `UserRole = EMPLOYEE | TO_BE_ADMIN | ADMIN | SUPER_ADMIN`; mobile admite únicamente EMPLOYEE (otros → `403 ROLE_NOT_ALLOWED`); Admin admite ADMIN/SUPER_ADMIN. INACTIVE bloquea operaciones nuevas y conserva lectura histórica. Admin puede realizar cargas retrospectivas como corrección histórica; revalidar permisos y estado al guardar. No hay desactivación en cascada.

Motivo: mantener identidad y semántica iguales entre consumidores sin exponer modelos privados de persistencia.

## Autenticación mobile

- Usuario público: `{ id, firstName, lastName, email, employeeId, role }`. Mobile debe migrar los actuales `nombre/apellido/legajo` de `stores/authStore.ts` y su sesión AsyncStorage sin tokens.
- Login por identifier/password (`POST /auth/login`) o Google (`POST /auth/google`) responde 202 con challenge; ambos exigen OTP WhatsApp. Tokens solo tras `POST /auth/otp/verify`.
- Registro: OTP WhatsApp más email por magic link. Tras OTP existe cuenta sin tokens; login devuelve `403 EMAIL_NOT_VERIFIED` hasta confirmar email.
- Refresh mobile permanece en JSON mediante `/auth/refresh`, con almacenamiento seguro al implementar. No reutilizar transporte web.

Motivo: verificar posesión del teléfono en login y ambas vías de contacto en registro. Detalle de challenges/tokens y seguridad interna: `backend_api_gdes/docs/04-auth-y-seguridad.md` (diseño, no servicio disponible).

## Sesión web admin

**Base acordada; seguridad de despliegue aún incompleta.** Access solo en memoria, refresh en cookie HttpOnly emitida por backend. Login ADMIN conserva el challenge 2FA por email y admite `rememberSession`; ni 2FA ni refresh web devuelven refresh en JSON.

```ts
interface WebLogin {
  identifier: string;
  password: string;
  client: "ADMIN";
  rememberSession: boolean;
}
interface AuthUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  employeeId: string;
  role: "ADMIN" | "SUPER_ADMIN";
}
interface WebSession {
  user: AuthUser;
  sessionExpiresAt: string;
  rememberSession: boolean;
}
interface WebSessionResponse { data: WebSession }
interface WebTokenResponse {
  data: WebSession & {
    tokens: { accessToken: string; expiresIn: number };
  };
}
interface WebCsrfResponse { data: { csrfToken: string } }
```

| Ruta | Entrada / salida diseñada |
|---|---|
| POST `/auth/login` | `WebLogin` → 202 challenge; recordar elección en el challenge |
| POST `/auth/login/2fa/verify` | challenge/código del flujo admin → `WebTokenResponse` y cookie |
| GET `/auth/web/csrf` | `WebCsrfResponse`; bootstrap sin crear sesión autenticada |
| GET `/auth/web/session` | cookie → `WebSessionResponse`; no rota ni devuelve access |
| POST `/auth/web/refresh` | `{}` y cookie → `WebTokenResponse`; rota refresh, exige CSRF |
| POST `/auth/web/logout` | `{}` y cookie → 204; revoca esa sesión/cadena e invalida cookie con iguales atributos |

`expiresIn=1800`; `sessionExpiresAt` es límite absoluto inicial, no se reinicia al rotar. Respuesta perdida/ambigua de refresh exige relogin; no repetir el refresh previo ni relajar detección de reuso. 401 de session/refresh limpia estado y lleva a login; OTP inválido no dispara refresh. Auth/sesión usa `Cache-Control: no-store`.

Concurrencia: una promesa de refresh por pestaña y coordinación same-origin mediante Web Locks/BroadcastChannel; logout cancela requests y limpia usuario/Query/cache. Una respuesta anterior no restablece sesión cerrada. El backend debe resolver revocación/rotación transaccionalmente. La generación de sesión, fallback sin esas APIs, logout offline/recarga y otros orígenes siguen abiertos.

Despliegue: proyectos Vercel separados es la preferencia vigente; dominios/orígenes no elegidos. `prolimpservicios.com` pertenece al humano; `admin.prolimpservicios.com` y `api.prolimpservicios.com` son candidatos. Usar un API `*.vercel.app` desde el dominio propio sería cross-site; dos subdominios del dominio propio serían same-site pero cross-origin. CORS requiere allowlist exacta y credenciales. Cookies cross-site requieren `SameSite=None; Secure` y siguen sujetas a bloqueo/partición del navegador; CORS no lo evita.

**Pendientes por ratificar:** URLs reales, atributos/nombre/vida de cookie, emisión y rotación CSRF/preauth (incluido login CSRF), identificador de generación de sesión, comportamiento logout offline, navegadores/fallback. `__Host-gdes-refresh`, Path=/, sin Domain, cookie de sesión sin recordar y Max-Age hasta siete días al recordar son candidatos, no atributos finales aprobados. Backend propone y humano ratifica antes de integración real.

Motivo: limitar persistencia de credenciales web y conservar rotación estricta sin cambiar mobile. Mocks no demuestran cookies, CSRF ni coordinación real.

## Solicitud administrativa

Ampliar `POST /auth/admin-access-request` sin versionar. No crear cuenta ni cambiar rol antes de verificar email. Conservar diez campos:

```ts
interface AdminAccessRequest {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  phone: string;
  dni: string;
  employeeId: string;
  address: string;
  siteId: string;
  birthDate: string;
}
interface AdminAccessChallenge {
  data: {
    challengeId: string;
    expiresAt: string;
    resendAvailableAt: string;
    message: string;
  };
}
interface VerifyAdminAccess {
  challengeId: string;
  code: string;
}
interface ResendAdminAccess { challengeId: string }
interface AdminAccessSubmitted {
  data: { status: "PENDING"; message: string };
}
```

POST inicial y `/auth/admin-access-request/resend` → 202 `AdminAccessChallenge`; `/auth/admin-access-request/verify` con `VerifyAdminAccess` → `AdminAccessSubmitted`. Resend usa `ResendAdminAccess` y devuelve challenge completo para reemplazar el activo. Respuestas neutrales antes de verificar: sin existencia, perfil o rol; `birthDate` civil, `siteId` UUID y `employeeId` legajo string.

- Código de seis dígitos: TTL 10 min, máximo cinco intentos, cooldown 60 s; payload pendiente se elimina a las 72 h. Contraseñas nunca en texto persistido/logs; nueva contraseña hasheada en backend.
- Cuenta nueva: tras verificar, crear perfil completo TO_BE_ADMIN y solicitud PENDING transaccionalmente. Existente EMPLOYEE ACTIVE: exigir contraseña actual más OTP, preservar perfil/password; discrepancias no identitarias se advierten después de verificar y se continúa sin sobrescribir.
- Conflicto de email/DNI/legajo con otra cuenta: `409 ADMIN_REQUEST_IDENTITY_CONFLICT`; INACTIVE no se reactiva; ADMIN/SUPER_ADMIN no se degrada. No revelar elegibilidad antes de prueba de identidad; `403 ADMIN_REQUEST_NOT_ELIGIBLE` según catálogo backend por materializar.
- TO_BE_ADMIN con solicitud pendiente: no duplicar solicitud/correos. Revalidar identidad y estado en transacción. El cambio de rol bloquea también mobile y requiere control de rol actual/revocación, sin esperar un JWT antiguo.
- Después de verificar se envían correos de recepción y decisión. Link de decisión de un solo uso, TTL siete días: GET muestra UI, POST confirma aprobación/rechazo. Aprobar → ADMIN; rechazar → EMPLOYEE; INACTIVE mientras se espera → solicitud cancelada. No borrar cuenta.

Pendiente de detalle backend: reenvío sin extender indefinidamente retención, idempotencia ante respuesta perdida, catálogo completo de errores y UX de limpieza del token de URL. No asumir una estrategia técnica por estar propuesta.

Motivo: impedir cambios de rol por conocer un email y evitar decisiones involuntarias de scanners de correo.

## Empleados

Contrato de diseño aprobado para Admin y sus mocks; backend pendiente. ADMIN/SUPER_ADMIN pueden leer/escribir, sin DELETE, gestión de roles o reset de password por este recurso.

```ts
type AccountStatus = "ACTIVE" | "INACTIVE";

interface SiteReference {
  id: string;
  name: string;
}

interface UserListItem {
  id: string;
  firstName: string;
  lastName: string;
  employeeId: string;
  dni: string;
  email: string;
  phone: string;
  site: SiteReference;
  accountStatus: AccountStatus;
}

interface UserDetail extends UserListItem {
  address: string;
  birthDate: string;
  cuil: string | null;
  hireDate: string | null;
  position: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CreateUserInput {
  firstName: string;
  lastName: string;
  employeeId: string;
  dni: string;
  email: string;
  initialPassword: string;
  phone: string;
  address: string;
  siteId: string;
  birthDate: string;
}

interface UpdateUserInput {
  firstName?: string;
  lastName?: string;
  employeeId?: string;
  dni?: string;
  email?: string;
  phone?: string;
  address?: string;
  siteId?: string;
  birthDate?: string;
  cuil?: string | null;
  hireDate?: string | null;
  position?: string | null;
}
```
```ts
interface UserListQuery {
  search?: string;
  accountStatus?: AccountStatus;
  page?: number;
  pageSize?: number;
}
```

| Ruta | Request → response |
|---|---|
| GET `/users` | `UserListQuery` → `{ data: UserListItem[], pagination }` |
| GET `/users/{id}` | `{ data: UserDetail }` |
| POST `/users` | `CreateUserInput` → 201 `{ data: UserDetail }` |
| PATCH `/users/{id}` | `UpdateUserInput` → `{ data: UserDetail }` |
| PATCH `/users/{id}/account-status` | `{ accountStatus }` → `{ data: UserDetail }`; idempotente |
| GET `/sites` | `{ data: SiteReference[] }`; seis provincias habilitadas, por nombre, sin CRUD |

Listado: page=1, pageSize=25/máximo 100; search parcial case-insensitive sobre nombre/apellido/email/legajo/DNI; orden `lastName,firstName,id ASC`. Alta ACTIVE sin verificación de email ni cambio obligatorio de contraseña. PATCH omitido conserva; null solo limpia `cuil/hireDate/position`. Perfil opcional puede seguir nulo; importación inicial no definida. Desactivar exige confirmación.

Validaciones: nombres trim 1–100; legajo trim 1–50; DNI 7–8 dígitos; teléfono 10–13 dígitos; email trim/lowercase válido <=254; domicilio trim 1–200; siteId existente; nacimiento/ingreso fechas reales no futuras; CUIL null u 11 dígitos; puesto null o trim 1–100. Password inicial 12–128 caracteres, permite espacios/Unicode, sin composición obligatoria; backend rechaza comunes/comprometidas. Política compartida pendiente de implementación mobile/backend.

Errores no reintentables: `404 USER_NOT_FOUND`; `409 USER_EMAIL_ALREADY_EXISTS|USER_DNI_ALREADY_EXISTS|USER_EMPLOYEE_ID_ALREADY_EXISTS`; `400 INVALID_USER_DATA|INVALID_SITE|WEAK_PASSWORD`. DTO de recurso no expone rol ni credenciales; links usan UUID, no legajo/DNI.

Motivo: gestión de identidad completa sin mezclar permisos ni credenciales con edición de perfil.

## Clientes y lugares

Diseño aprobado ADMIN, distinto de la futura lista agrupada EMPLOYEE/mobile. Estado ACTIVE/INACTIVE, geometría CIRCLE; relaciones resueltas en respuestas para evitar N+1.

```ts
type EntityStatus = "ACTIVE" | "INACTIVE";
type WorkplaceShapeType = "CIRCLE";

// SiteReference se define en Empleados.
interface ClientReference {
  id: string;
  name: string;
  status: EntityStatus;
}

interface ClientListItem extends ClientReference {
  createdAt: string;
  updatedAt: string;
}

type ClientDetail = ClientListItem;

interface CreateClientInput {
  name: string;
}

interface UpdateClientInput {
  name: string;
}

interface WorkplaceListItem {
  id: string;
  name: string;
  client: ClientReference;
  site: SiteReference;
  status: EntityStatus;
  shapeType: WorkplaceShapeType;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  gpsAccuracyThreshold: number | null;
  createdAt: string;
  updatedAt: string;
}

type WorkplaceDetail = WorkplaceListItem;

interface CreateWorkplaceInput {
  clientId: string;
  siteId: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  gpsAccuracyThreshold: number | null;
}

interface UpdateWorkplaceInput {
  clientId: string;
  siteId: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  gpsAccuracyThreshold: number | null;
}
```

```ts
interface ClientListQuery {
  search?: string;
  status?: EntityStatus;
  page?: number;
  pageSize?: number;
}
```

```ts
interface WorkplaceListQuery {
  search?: string;
  clientId?: string;
  siteId?: string;
  status?: EntityStatus;
  page?: number;
  pageSize?: number;
}
```

| Recurso | Rutas y formas |
|---|---|
| clients | GET `/clients` con `ClientListQuery` → lista paginada; GET `/{id}` → detalle; POST con `CreateClientInput` → 201 detalle; PUT `/{id}` con `UpdateClientInput` → detalle; PATCH `/{id}/status` con `{ status }` → detalle |
| workplaces | GET `/workplaces` con `WorkplaceListQuery` → lista paginada; GET `/{id}` → detalle; POST con `CreateWorkplaceInput` → 201 detalle; PUT `/{id}` con `UpdateWorkplaceInput` → detalle; PATCH `/{id}/status` con `{ status }` → detalle |

Todas las respuestas usan `{ data }`, listas con pagination; page=1, pageSize=25/máximo 100. Búsqueda parcial case-insensitive sin exigir acentos en name; filtros AND, UUID exactos; orden `name,id ASC`. PUT reemplaza campos editables completos. Estado idempotente y separado, sin DELETE ni cascada; cliente puede no tener lugares. Cliente INACTIVE impide crear/reasignar y seleccionar sus lugares para operaciones nuevas aunque estos conserven ACTIVE. Mantener lectura y correcciones históricas; no reescribir relaciones históricas materializadas al mover un lugar.

Validaciones: nombres trim 1–120; cliente único global normalizando mayúsculas/espacios, lugar único por cliente/provincia/nombre normalizado. IDs existentes; latitud finita [-90,90], longitud [-180,180], radio entero [10,10000] m, umbral null o entero [1,1000] m. Centro elegido conscientemente, no un default arbitrario.

Errores no reintentables: `404 CLIENT_NOT_FOUND|WORKPLACE_NOT_FOUND`; `409 CLIENT_NAME_ALREADY_EXISTS|WORKPLACE_NAME_ALREADY_EXISTS|CLIENT_INACTIVE`; `400 INVALID_CLIENT_DATA|INVALID_WORKPLACE_DATA|INVALID_SITE|INVALID_GEO_CONFIGURATION`.

Mapa Admin: Google Maps JavaScript API + Places API (New), `PlaceAutocompleteElement` restringido a Argentina. Autocomplete solo centra; clic, arrastre o coordenadas confirman ubicación. Persistir únicamente lat/lon/radio/umbral, sin dirección, Place ID o resultados de geocoder. Marker/Circle e inputs sincronizados; atribución visible; clave pública `VITE_GOOGLE_MAPS_API_KEY` restringida por HTTP referrer/API. Sin proxy ni fallback OSM público. Error de proveedor no borra selección. Facturación se verifica al configurar, sin conservar estimaciones históricas como regla.

Motivo: editar configuración geográfica verificable sin convertir resultados del proveedor en datos de dominio.

## Asistencia

### Eventos y proyección

Mobile emite eventos atómicos CHECK_IN/CHECK_OUT/ABSENCE; backend persiste AttendanceEvent append-only y proyecta un registro por `(userId,workplaceId,date GMT-3)`. La marcación diseñada responde `{ data: { eventId, recordId, message } }`; errores usan envelope común. Tipos locales `RegisterRequest/RegisterResponse` de mobile todavía deben migrar; el código local no es contrato de red definitivo. Campos y pipeline internos: `backend_api_gdes/docs/05-asistencia-eventos-y-registros.md`.

| Intervalo | Estado | Trabajo cerrado | Completitud si único |
|---|---|---|---|
| WORK, inicio y fin | CLOSED | diferencia en minutos | COMPLETE |
| WORK, solo inicio / solo fin | OPEN / SEMI_CLOSED | 0 | INCOMPLETE |
| ABSENCE, sin extremos o ambos | CLOSED | 0 | COMPLETE |
| ABSENCE, solo inicio / solo fin | OPEN / SEMI_CLOSED | 0 | INCOMPLETE |

Total = suma de WORK CLOSED, sin horas de ausencia. Entrada agrega intervalo; salida cierra el último abierto del mismo día/lugar. Entradas 09:00/11:00 y salidas 12:00/18:00 producen 600 minutos, incluidos solapamientos históricos. Cruce de medianoche no se cierra/fusiona: dos registros OPEN/SEMI_CLOSED, ambos incompletos y cero trabajo cerrado. Motivo de ausencia opcional siempre; null se muestra “sin motivo”.

Ventana offline acordada inclusiva: `receivedAt` asignado por servidor menos `occurredAt <= 24 h`. Más antiguo devuelve `422 ATTENDANCE_EVENT_TOO_OLD`, `retryable=false` (diseño técnico documentado en catálogo backend, todavía sin implementación). Pendientes timestamps futuros/clock skew y pruebas de frontera; no usar recepción enviada por cliente. La cola offline mobile existe pero la UI aún la mantiene inactiva.

Motivo: preservar evidencia original y evitar completar jornadas o razones por inferencia.

### Consulta mensual

GET `/records/monthly`, ADMIN/SUPER_ADMIN, pagina filas completas empleado–lugar con actividad (ausencia cuenta), sin asignaciones permanentes ni filas sintéticas. Cada fila tiene todos los 28–31 días ordenados. EMPTY es ausencia confirmada en snapshot; PRESENT conserva ID incluso cuando no coincide; LOADING/ERROR son estados UI.

```ts
type RecordStatus = "COMPLETE" | "INCOMPLETE";
type ReviewStatus = "NONE" | "PENDING" | "APPROVED" | "MANUAL_LOADED";
interface MonthlyQuery {
  month: number;
  year: number;
  page?: number;
  pageSize?: number;
  siteId?: string;
  employeeId?: string;
  workplaceId?: string;
  clientId?: string;
  status?: RecordStatus;
  reviewStatus?: ReviewStatus;
  origin?: "AUTOMATIC" | "MANUAL";
  hasAbsence?: true;
  snapshotToken?: string;
}
type Day =
  | { date: string; state: "EMPTY" }
  | {
      date: string;
      state: "PRESENT";
      matchesFilters: boolean;
      record: {
        id: string;
        totalWorkMinutes: number;
        recordStatus: RecordStatus;
        reviewStatus: ReviewStatus;
        origin: "AUTOMATIC" | "MANUAL";
        hasAbsence: boolean;
        intervalCount: number;
      };
    };
interface MonthlyRow {
  employee: { id: string; firstName: string; lastName: string; employeeId: string };
  workplace: { id: string; name: string };
  client: { id: string; name: string };
  site: { id: string; name: string };
  days: Day[];
  totals: { monthWorkMinutes: number; matchingWorkMinutes: number };
}
interface MonthlyResponse {
  data: MonthlyRow[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  meta: {
    month: number;
    year: number;
    timeZone: "-03:00";
    snapshotToken: string;
    snapshotExpiresAt: string;
    totals: { monthWorkMinutes: number; matchingWorkMinutes: number };
  };
}
```

Mes/año obligatorios; page=1, pageSize=50/máximo 100; `siteId` provincia del lugar. Estado/revisión/origen/ausencia deben coincidir sobre **el mismo registro diario** para seleccionar fila; devolver todos sus días con `matchesFilters` por registro. Totales mensuales y coincidentes de fila/globales abarcan todas las filas seleccionadas, no solo página. Orden fijo apellido/nombre/lugar/UUID empleado/UUID lugar; collation backend pendiente.

Snapshot opaco ligado a usuario/filtros/orden, TTL 15 min: primera página crea, siguientes envían token. Mutación/actualización reinicia desde página 1 sin mezclar snapshots. `410 MONTHLY_SNAPSHOT_EXPIRED`, `400 MONTHLY_SNAPSHOT_MISMATCH`, ambos no reintentables. Snapshot no autoriza escrituras: POST revalida unicidad/permisos actuales; `409 RECORD_ALREADY_EXISTS` requiere recuperar registro sin sobrescribir.

Motivo: evitar filas partidas y fechas falsamente vacías por paginación o concurrencia. Backend debe probar febrero bisiesto, 31 días, cero filas, filas mixtas, dos páginas y escritura concurrente.

### Corrección y aprobación

`ReviewStatus = NONE | PENDING | APPROVED | MANUAL_LOADED`; `IntervalReviewStatus = NONE | PENDING | APPROVED`. No existe REJECTED para asistencia (sí puede existir para solicitudes administrativas).

```ts
type IntervalInput = {
  type: "WORK" | "ABSENCE";
  startTime: string | null;
  endTime: string | null;
  absenceReason: "ILLNESS" | "VACATION" | "LEAVE" | "ART" | "OTHER" | null;
  observations: string | null;
};
interface CreateRecord {
  userId: string;
  workplaceId: string;
  date: string;
  observations: string | null;
  intervals: IntervalInput[];
}
type IntervalChange =
  | { operation: "ADD"; interval: IntervalInput }
  | { operation: "UPDATE"; id: string; interval: IntervalInput }
  | { operation: "DELETE"; id: string };
interface UpdateRecord {
  expectedVersion: number;
  observations?: string | null;
  intervalChanges?: IntervalChange[];
}
interface ReviewRecord {
  expectedVersion: number;
  reviewStatus: "APPROVED";
}
```

POST `/records` crea con `CreateRecord` → 201 `{ data: RecordDetail }`; PATCH `/records/{id}` con `UpdateRecord` corrige → `{ data: RecordDetail }`. Identidad user/lugar/fecha inmutable. Omitido conserva; null limpia solo nullable; intervalos no mencionados se conservan. UPDATE/DELETE deben pertenecer al registro y quedar al menos uno (`422 RECORD_INTERVALS_REQUIRED`). Manual no admite WORK sin ambos extremos, registro vacío ni nuevos solapamientos; no invalida históricos proyectados. Campos derivados los calcula backend.

Toda corrección usa `expectedVersion`; incrementa versión y recalcula proyección MANUAL/MANUAL_LOADED, intervalos editados MANUAL, sin crear/editar/borrar AttendanceEvent. PATCH `/records/{id}/review` con `ReviewRecord` aprueba e incrementa versión conservando origen, datos, horarios e intervalos exactamente; devuelve detalle. No hay ruta aprobada de revisión individual de intervalos. Conflicto: `409 RECORD_VERSION_CONFLICT`, no reintentable; conservar formulario y ofrecer recargar/comparar.

Motivo: separar validación administrativa de corrección y evitar pérdida silenciosa de cambios/evidencia.

### Detalle y metadata bajo demanda

GET `/records/{id}` incluye relaciones/intervalos y referencias livianas a eventos; GET `/attendance-events/{id}` carga metadata al pedir más detalles. Intervalos manuales no sintetizan eventos. **Los DTOs siguientes están aprobados para mocks; publicación final backend pendiente.**

```ts
interface RecordDetail {
  id: string;
  date: string;
  employee: { id: string; firstName: string; lastName: string; employeeId: string };
  workplace: { id: string; name: string };
  client: { id: string; name: string };
  site: { id: string; name: string };
  totalWorkMinutes: number;
  recordStatus: "COMPLETE" | "INCOMPLETE";
  reviewStatus: "NONE" | "PENDING" | "APPROVED" | "MANUAL_LOADED";
  origin: "AUTOMATIC" | "MANUAL";
  hasAbsence: boolean;
  observations: string | null;
  version: number;
  intervals: RecordInterval[];
  createdAt: string;
  updatedAt: string;
}

interface RecordInterval {
  id: string;
  type: "WORK" | "ABSENCE";
  status: "OPEN" | "SEMI_CLOSED" | "CLOSED";
  startTime: string | null;
  endTime: string | null;
  absenceReason: "ILLNESS" | "VACATION" | "LEAVE" | "ART" | "OTHER" | null;
  observations: string | null;
  origin: "AUTOMATIC" | "MANUAL";
  reviewStatus: RecordDetail["reviewStatus"];
  attendanceEvents: Array<{
    id: string;
    type: "CHECK_IN" | "CHECK_OUT" | "ABSENCE";
    occurredAt: string;
  }>;
}

interface AttendanceEventDetail {
  id: string;
  recordId: string;
  intervalId: string;
  type: "CHECK_IN" | "CHECK_OUT" | "ABSENCE";
  occurredAt: string;
  receivedAt: string;
  origin: "MOBILE" | "ADMIN";
  observation: string | null;
  location: {
    latitude: number;
    longitude: number;
    accuracyMeters: number;
    capturedAt: string;
  } | null;
  metadata: Record<string, string | number | boolean | null>;
}
```

La forma mock usa `RecordDetail["reviewStatus"]` también en intervalos; es una brecha frente al enum IntervalReviewStatus acordado, no permiso para introducir MANUAL_LOADED en intervalos del contrato final. Metadata escalar de solo lectura; distinguir null/desconocido. Confirmar con backend nombres finales, nullabilidad para históricos, vínculos de eventos tras borrar intervalos y usos de origin ADMIN (las correcciones no generan eventos).

UI: detalle por doble clic o Enter/Espacio, `recordId` en query, diálogo accesible con Escape; carga/error/reintento independientes por detalle/evento. No consultar eventos por celda durante render.

## Archivos y métricas

Acuerdos vigentes, todavía sin backend de dominio:

- Planillas requieren `workplaceId`; contingencia admite `workplaceId: null`. Mobile aún usa `DocumentUploadRequest.workplace`, months vacío y URIs locales: no es subida HTTP real.
- 20 MiB (20 × 1024 × 1024 bytes) por archivo, máximo 10 por request; pdf/jpg/jpeg/png/doc/docx/txt, validar contenido en backend además de extensión. Lote atómico con rollback DB/bucket. No inferir que proxy/hosting acepta hasta 200 MiB sin probar transporte.
- Búsqueda por fileName y nombre/apellido/legajo del empleado. Descarga vigente `{ data: { downloadUrl } }` con firma 15 min; pedir firma nueva al reintentar, no persistir URLs vencidas. Añadir `expiresAt` obligatorio es propuesta abierta.
- Borrar documento sí, planilla no. Reemplazo no borra original hasta confirmar archivo nuevo válido. Edición de documento: nombre visible/tipo. Sin OCR, registros generados ni vínculo automático con ausencias.
- Métricas del mes seleccionado: `pendingTimesheets`, `incompleteRecords`, `pendingReviewRecords`, `recordsWithAbsence`; esta última cuenta registros con >=1 ABSENCE, no intervalos/horas. Enlaces conservan período/filtro. Alcance provincial pendiente.

Motivo: coherencia de archivos y contadores sin atribuir transporte real ni decisiones nuevas a mocks.

DTOs completos de planillas/documentos/metrics, `expiresAt`, preservación de estado al reemplazar, auditoría/concurrencia, multipart, filtros y scope provincial son **propuesta pendiente**, en `admin_web_app/docs/changes_proposals/20260919-f007-f009-planillas-legajos-metricas.md`. Sus modelos implementados están en `admin_web_app/src/types/{timesheets,documents,dashboard}.ts`; el mock actual de métricas exige además `byProvince`, todavía sin ratificación contractual. No duplicarlos como contratos aprobados.

## Pendientes de decisión e integración

- Auth mobile: TTL del magic link de email (24 h en diseño backend) requiere confirmación; no confundir con ventana offline ratificada. Catálogo de ausencia debe aclarar equivalencia de “franco” en UI mobile, sin inventar mapping a VACATION/LEAVE.
- Sesión web: cerrar los puntos de seguridad/despliegue en su sección antes de F-010; un adaptador HTTP y un mock no prueban autenticación.
- Archivos/métricas: resolver la propuesta abierta; contador global actual y matriz UI por provincia predeterminada no garantizan el mismo conjunto.
- Asistencia: precisión segundos/milisegundos, límites de día, igualdad inicio=fin, fechas futuras, máximo de intervalos/observaciones, clock skew, eventos offline desordenados y vínculos históricos requieren definición técnica/validación. No ratificar límites elegidos solo en mock.
- Catálogos: exposición pública/privada, etiquetas y reenvío 2FA ADMIN deben publicarse con permisos/códigos concretos. No inferir compatibilidad con resend mobile.
- Admin HTTP: `src/services/http-service-adapter.ts` descarta el prefijo de base al resolver paths absolutos, no agrega Authorization/CSRF y serializa JSON, no FormData; completar antes de integración. Registro solo valida localmente y auth no implementa todavía renovación/concurrencia completas.
- Backend: implementar dominio, migrar enums y materializar ejemplos/errores/pruebas; mobile: migrar modelos/envelopes y habilitar flujos acordados; Admin: alinear adaptadores y resolver brechas antes de integración real. Estos pendientes son ejecución, no motivo para conservar propuestas resueltas.
