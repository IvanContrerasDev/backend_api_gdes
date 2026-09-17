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

- Campos de perfil `cuil`, `hireDate`, `position`: existen en el mock de mobile pero no en el alta de la spec admin — quedan nullable en `User` hasta confirmar origen de carga.
- Ventana máxima para marcaciones offline tardías: sin límite en MVP.
