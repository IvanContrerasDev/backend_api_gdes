<!-- SYNCED-FROM-TEMPLATE: gestionado desde GdesProject/template/. NO EDITAR en este repo; proponé cambios en docs/changes_proposals/. -->

# Contratos entre apps

## Alcance y disponibilidad

Fuente canónica de los acuerdos de integración: una sección vigente por tema, con motivo breve. Los tres subrepos reciben copias idénticas desde `GdesProject/template/`. El detalle interno del backend vive en sus docs 02–07; las specs locales enlazan este contrato y no redefinen DTOs comunes.

**Estado comprobado en código al 2026-10-17:** mobile conserva flujos operativos con mocks/sesión local; Admin conserva módulos operativos mock con adaptador HTTP parcial; backend implementa y prueba las features F-001–F-009, incluidas autenticación, estructura, asistencia, matriz mensual, métricas, archivos y solicitudes administrativas. La API backend está disponible para integración; esto no demuestra que los clientes estén integrados ni que proveedores/dominios de producción estén provisionados. Ver `backend_api_gdes/docs/README.md` y los contratos HTTP en `backend_api_gdes/docs/03-contratos-api.md`.

Brechas de implementación: Admin conserva `INTERNAL_POLICIES` en el mock frente a `INTERNAL_RULES` en el contrato/backend y usa el enum de revisión de registro también en intervalos. Mobile conserva campos y respuestas locales distintos. No convertir esas diferencias en decisiones aprobadas ni modificar producto en una limpieza documental.

## Convenciones

- Base diseñada `/api/v1`; JSON con campos en inglés e interfaz y `error.message` en español. IDs de entidades UUID; timestamps ISO 8601 UTC; fechas civiles `YYYY-MM-DD` en GMT-3.
- Éxito `{ data: T }`; listas `{ data: T[], pagination: { page, pageSize, totalItems, totalPages } }`; error `{ error: { code, message, retryable } }`. El frontend considera también HTTP status, no solo `retryable`.
- `employeeId` en un usuario es su legajo string; en queries de recursos es UUID de User cuando se indica como filtro de empleado. No intercambiarlos.
- No exponer passwords/hashes, claves privadas de archivos o refresh web en respuestas de recursos. Si el proveedor de notificaciones falla, responder `503 NOTIFICATION_UNAVAILABLE`, `retryable=true`, con mensaje español sin datos upstream; los endpoints de auth no emiten tokens cuando falla el envío síncrono requerido. Aceptación del proveedor no equivale a entrega.
- `UserRole = EMPLOYEE | TO_BE_ADMIN | ADMIN | SUPER_ADMIN`; mobile admite únicamente EMPLOYEE (otros → `403 ROLE_NOT_ALLOWED`); Admin admite ADMIN/SUPER_ADMIN. INACTIVE bloquea operaciones nuevas y conserva lectura histórica. Admin puede realizar cargas retrospectivas como corrección histórica; revalidar permisos y estado al guardar. No hay desactivación en cascada.

Motivo: mantener identidad y semántica iguales entre consumidores sin exponer modelos privados de persistencia.

## Autenticación mobile

- Usuario público: `{ id, firstName, lastName, email, employeeId, role }`. Mobile debe migrar los actuales `nombre/apellido/legajo` de `stores/authStore.ts` y su sesión AsyncStorage sin tokens.
- Login por identifier/password (`POST /auth/login`) o Google (`POST /auth/google`) responde 202 con challenge; ambos exigen OTP WhatsApp. Tokens solo tras `POST /auth/otp/verify`.
- Registro: OTP WhatsApp más email por magic link. Tras OTP existe cuenta sin tokens; login devuelve `403 EMAIL_NOT_VERIFIED` hasta confirmar email. El magic link vence a las 24 h; recuperación vence a 1 h. La política de contraseña de nueva cuenta es local, 12–128 caracteres Unicode; no consulta HIBP ni otra lista remota. La cobertura de la lista local es limitada.
- Refresh mobile permanece en JSON mediante `/auth/refresh`, con almacenamiento seguro al implementar. No reutilizar transporte web.

Enlaces y reenvíos se ligan a propósito, usuario, generación de credenciales y hash del email destino. Cambiar el email invalida enlaces anteriores; cambiar contraseña revoca sesiones/refresh y challenges anteriores. OTP se liga al contacto destino vigente; reenviar no rehabilita una prueba antigua. Endpoints neutros persisten la misma intención para cualquier dirección válida y responden 202 sin consulta condicional de existencia; registro crea la intención de email en la transacción de cuenta y consumo OTP. El proveedor se configura explícitamente; no afirmar que la entrega real está certificada. En desarrollo, Resend usa idempotencia estable; Meta no reintenta automáticamente un resultado ambiguo y el reenvío respeta cooldown de 60 s.

La verificación usa `API_PUBLIC_URL/api/v1/auth/email/verify?token=...` y redirige con 302 a `MOBILE_DEEP_LINK_SCHEME://email-verified?success=true`. Recuperación abre `ADMIN_FRONTEND_URL/password-reset?token=...` para ambas apps. `API_PUBLIC_URL` es origen configurado, nunca derivado de `Host`/`Forwarded`; en producción debe configurarse explícitamente con HTTPS. Dominios de producción y pantallas/deep links de los clientes siguen pendientes.

Motivo: verificar posesión del teléfono en login y ambas vías de contacto en registro. Detalle de challenges/tokens y seguridad interna: `backend_api_gdes/docs/04-auth-y-seguridad.md`.

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

Para desarrollo y pruebas queda ratificada la cookie refresh `__Host-gdes-refresh` con `Secure`, `HttpOnly`, `Path=/` y sin `Domain`; frontend y API same-site con CORS de origen explícito; CSRF ligado a preauth y renovado al autenticar; ante refresh ambiguo se exige relogin. Se usa `SameSite=Lax`, cookie de sesión sin `Max-Age` y duración absoluta de hasta siete días al recordar. El token CSRF deriva por HMAC del preauth/generación de sesión; `Origin` debe coincidir exactamente. CSRF mal formado devuelve `400 BAD_REQUEST`; sesión inválida, `401 INVALID_TOKEN`. No se agregan campos DTO.

**Pendiente de despliegue/integración:** dominios/orígenes de producción, navegadores soportados y comportamiento de fallback/logout offline. El acuerdo de desarrollo no certifica despliegue.

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
- Cuenta nueva: tras verificar, crear perfil completo TO_BE_ADMIN y solicitud PENDING transaccionalmente. Existente EMPLOYEE ACTIVE: exigir contraseña actual más OTP, preservar perfil/password; discrepancias no identitarias se advierten después de verificar y se continúa sin sobrescribir. El POST inicial valida una contraseña sintáctica de 1–128 caracteres Unicode para toda identidad; una cuenta existente prueba su contraseña actual incluso si es legada. La política nueva de 12–128 y lista local se aplica solo después del OTP al crear cuenta nueva, para evitar revelar existencia antes de probar el email. OTP completa `emailVerifiedAt` solo si aún es null y conserva fecha previa, perfil y hash existentes.
- Conflicto de email/DNI/legajo con otra cuenta: `409 ADMIN_REQUEST_IDENTITY_CONFLICT`; INACTIVE no se reactiva; ADMIN/SUPER_ADMIN no se degrada. No revelar elegibilidad antes de prueba de identidad; `403 ADMIN_REQUEST_NOT_ELIGIBLE` según catálogo backend por materializar.
- TO_BE_ADMIN con solicitud pendiente: no duplicar solicitud/correos. Revalidar identidad y estado en transacción. El cambio de rol bloquea también mobile y requiere control de rol actual/revocación, sin esperar un JWT antiguo.
- Después de verificar se envían correos de recepción y decisión. Link de decisión de un solo uso, TTL siete días: GET muestra UI, POST confirma aprobación/rechazo. Aprobar → ADMIN; rechazar → EMPLOYEE; INACTIVE mientras se espera → solicitud cancelada. No borrar cuenta.

Una solicitud PENDING cuyo enlace de decisión venció puede renovarse por siete días tras nueva verificación OTP del email del solicitante, conservando la solicitud y generando token/hash nuevos; los anteriores quedan invalidados. Mientras el enlace siga vigente no se duplican solicitudes ni correos de recepción/decisión. Un challenge consumido no se puede reutilizar. Antes de renovar se revalidan contraseña actual, identidad, cuenta ACTIVE y elegibilidad TO_BE_ADMIN; solicitudes canceladas o decididas no se reactivan. Cada generación permite una sola notificación de decisión. Tras rechazo o cancelación se permite una nueva solicitud solo con OTP fresco, contraseña actual, cuenta ACTIVE y rol elegible; se conserva la fila anterior. Una solicitud aprobada mantiene ADMIN y no puede volver a postularse. Challenges concurrentes se serializan para mantener una sola solicitud PENDING y sus notificaciones.

La confirmación continúa siendo `POST /auth/admin-access/confirm` con token y decisión, sin JWT adicional; el GET del frontend solo presenta confirmación. Replay/cancelación devuelve `409 REQUEST_ALREADY_DECIDED`, token vencido `410 TOKEN_EXPIRED` e inválido `401 INVALID_TOKEN`. La cancelación por INACTIVE es interna y reactivar la cuenta no revive la solicitud. Notificaciones persistentes distinguen aceptación del proveedor de entrega y no almacenan bearer.

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

Online, el servidor asigna `occurredAt`. Offline, el cliente envía la hora original de marcación en `occurredAt` y la hora actual del teléfono al sincronizar en `clientSentAt`; esta última no puede adelantarse más de dos minutos al servidor. `receivedAt` siempre lo asigna el servidor. Se procesan eventos por orden de recepción, sin reconstruir secuencias según la hora del cliente. La ventana inclusiva admite `receivedAt - occurredAt <= 24 h`; eventos más antiguos devuelven `422 ATTENDANCE_EVENT_TOO_OLD`, `retryable=false`. Sin `clientSentAt`, el evento sigue la ruta online con hora efectiva del servidor; no se impone límite simétrico al atraso. La comprobación del reloj actual no certifica la hora original. La cola offline existe en mobile, pero su UI aún está inactiva.

Si una salida recibida antes que la última entrada abierta intenta cerrar el intervalo, no se restaura el orden por hora cliente ni se calcula trabajo negativo: se crea un nuevo intervalo `SEMI_CLOSED`, se mantiene la entrada `OPEN` y el registro queda `PENDING`.

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

POST `/records` crea con `CreateRecord` → 201 `{ data: RecordDetail }`; PATCH `/records/{id}` con `UpdateRecord` corrige → `{ data: RecordDetail }`. Identidad user/lugar/fecha inmutable. Omitido conserva; null limpia solo nullable; intervalos no mencionados se conservan. UPDATE/DELETE deben pertenecer al registro y quedar al menos uno (`422 RECORD_INTERVALS_REQUIRED`). La carga manual se divide por día GMT-3; cada tramo diario se envía por separado y se admite `endTime=00:00` del día siguiente, sin creación implícita de varios registros. No se admiten WORK sin ambos extremos, registros vacíos ni solapamientos nuevos; validación aplica a WORK y ABSENCE por ambos extremos. Intersecciones históricas pueden conservarse o reducirse, pero no ampliarse ni crearse por pares/rango; tramos contiguos no se solapan. Campos derivados los calcula backend.

Toda corrección usa `expectedVersion`; incrementa versión y recalcula proyección MANUAL/MANUAL_LOADED, intervalos editados MANUAL, sin crear/editar/borrar AttendanceEvent. PATCH `/records/{id}/review` con `ReviewRecord` aprueba e incrementa versión conservando origen, datos, horarios e intervalos exactamente; devuelve detalle. No hay ruta aprobada de revisión individual de intervalos. Un evento nuevo CHECK_IN/CHECK_OUT/ABSENCE sobre un registro APPROVED lo devuelve a PENDING y aumenta versión dentro de la misma transacción. Reintentos idempotentes y eventos rechazados no cambian la aprobación; esta representa los datos vigentes al momento de aprobar, no fichadas futuras. Conflicto: `409 RECORD_VERSION_CONFLICT`, no reintentable.

Motivo: separar validación administrativa de corrección y evitar pérdida silenciosa de cambios/evidencia.

### Detalle y metadata bajo demanda

GET `/records/{id}` incluye relaciones/intervalos y referencias livianas a eventos; GET `/attendance-events/{id}` carga metadata al pedir más detalles. Intervalos manuales no sintetizan eventos. Los DTOs siguientes son el contrato publicado y probado por backend.

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
  reviewStatus: "NONE" | "PENDING" | "APPROVED";
  attendanceEvents: Array<{
    id: string;
    type: "CHECK_IN" | "CHECK_OUT" | "ABSENCE";
    occurredAt: string;
  }>;
}

interface AttendanceEventDetail {
  id: string;
  recordId: string;
  intervalId: string | null;
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

`MANUAL_LOADED` solo existe en el registro, no en intervalos. Metadata es escalar y de solo lectura; `intervalId` puede ser null cuando se quitó el intervalo, mientras el evento conserva su `recordId`. `clientRequestId` y `clientSentAt` se reservan de la metadata pública; el JSON original anidado o con colisiones se conserva como `deviceInfoJson`.

UI: detalle por doble clic o Enter/Espacio, `recordId` en query, diálogo accesible con Escape; carga/error/reintento independientes por detalle/evento. No consultar eventos por celda durante render.

## Archivos y métricas

`GET /catalogs` es público y devuelve solo provincias `{value,label}` y tipos fijos de ausencia/documento; no expone empleados, clientes ni lugares. El catálogo de documentos usa `INTERNAL_RULES` (“Normas internas”). Planillas requieren `workplaceId` salvo contingencia con null. Cargas multipart admiten 1–10 archivos de hasta 20 MiB inclusivos cada uno, extensiones pdf/jpg/jpeg/png/doc/docx/txt y validación de contenido. Un lote se publica todo-o-nada. Admin y empleado tienen envelopes de subida distintos: admin recibe objetos `created` completos; mobile conserva `timesheetIds`/`documentIds` y `message`. Para documentos, `workplaceId` es opcional.

Descargas de archivos devuelven `{ data: { downloadUrl, expiresAt } }`, con `expiresAt` en ISO 8601 UTC; la firma dura 15 minutos y se solicita nuevamente al reintentar. No persistir URL vencida. Documento puede eliminarse; planilla no. Reemplazar una planilla conserva identidad, empleado, lugar, período, secuencia, uploader y fecha original; crea auditoría de reemplazante, vuelve a `PENDING` e incrementa versión con `expectedVersion`; una versión obsoleta devuelve `409 FILE_VERSION_CONFLICT`. Un fallo al guardar la nueva carga conserva el archivo anterior. Los objetos no se publican hasta confirmar metadata; la limpieza física fallida se recupera mediante journal persistido y puede ser eventualmente consistente. Al fallar una operación de almacenamiento se devuelve `503 STORAGE_UNAVAILABLE`, `retryable=true`, sin detalles del proveedor.

Los cambios de `clientId` o `siteId` de un lugar se bloquean bajo lock si existe cualquier registro o planilla; nombres y geometría sí se pueden editar. Relaciones idénticas son idempotentes. El dashboard es `GET /dashboard/metrics?month=&year=`, solo ADMIN/SUPER_ADMIN, reemplaza `/dashboard/summary`; mes 1–12, año 2000–9999; parámetros inválidos devuelven `422 VALIDATION_ERROR`. Devuelve `pendingTimesheets`, `incompleteRecords`, `pendingReviewRecords`, `recordsWithAbsence` y `byProvince` con los mismos cuatro contadores para todas las provincias, incluso ceros. Totales y desgloses corresponden al mes seleccionado; planillas usan período, registros su fecha civil GMT-3. Ausencias cuenta cada registro una vez aunque tenga varios intervalos; condiciones pueden coexistir. Provincia viene del snapshot del registro o del lugar de la planilla, no del empleado. No excluir datos históricos inactivos. Los destinos de navegación conservan mes/año.

Motivo: preservar auditoría y atribución histórica, facilitar cargas de ambas apps y alinear los contadores con sus destinos provinciales.

## Pendientes de decisión e integración

- Auth mobile: integración de clientes y dominios de producción pendientes. El catálogo de ausencia debe aclarar equivalencia de “franco” en UI mobile, sin inventar mapping a VACATION/LEAVE.
- Sesión web: dominios de despliegue, navegadores/fallback y validación de integración permanecen pendientes; el acuerdo de desarrollo no certifica despliegue.
- Archivos/métricas: filtros, permisos por vista, secuencias y coherencia entre navegación y alcance de contadores para Admin siguen pendientes de ratificación común; los mocks no resuelven esas decisiones. Ver `admin_web_app/docs/changes_proposals/20260919-f007-f009-planillas-legajos-metricas.md`.
- Asistencia: precisión segundos/milisegundos, límites de día, igualdad inicio=fin, fechas futuras, máximo de intervalos/observaciones, validación de clock skew y comportamiento de cola en la UI requieren definición técnica/validación. No ratificar límites elegidos solo en mock.
- Catálogos: el alcance público de provincias y tipos fijos de ausencia/documento está definido; queda pendiente el catálogo/etiquetado y reenvío 2FA de ADMIN con permisos y códigos concretos. No inferir compatibilidad con resend mobile.
- Admin HTTP: `src/services/http-service-adapter.ts` descarta el prefijo de base al resolver paths absolutos, no agrega Authorization/CSRF y serializa JSON, no FormData; completar antes de integración. Registro solo valida localmente y auth no implementa todavía renovación/concurrencia completas.
- Backend: integración de clientes y despliegue; mobile: migrar modelos/envelopes y habilitar flujos acordados; Admin: alinear adaptadores y resolver brechas antes de integración real. Estos pendientes son ejecución, no motivo para conservar propuestas resueltas.
