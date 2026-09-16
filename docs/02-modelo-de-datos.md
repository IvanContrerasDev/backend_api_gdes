# 02 — Modelo de datos

Nivel Prisma. Todos los ids son `uuid`. Timestamps `createdAt`/`updatedAt` en UTC en todas las entidades salvo que se indique lo contrario. **Timezone lógica del sistema: GMT-3 única** (spec admin §29/§76) — ver regla de fechas en `05-asistencia-eventos-y-registros.md`.

## Diagrama de relaciones

```
Site 1──N User
Site 1──N Workplace
Client 1──N Workplace
User 1──N AttendanceEvent
User 1──N AttendanceRecord
Workplace 1──N AttendanceRecord
AttendanceRecord 1──N Interval
Interval N──0..1 AttendanceEvent (entryEvent / exitEvent)
User 1──N Timesheet
Workplace 1──N Timesheet
User 1──N Document
User 1──N RefreshToken / OtpCode / PasswordResetToken / AdminAccessRequest
```

NO existe asignación fija `User ↔ Workplace` (spec §8): la relación es indirecta vía registros.

## Entidades

### User

| Campo | Tipo | Constraint | Notas |
|---|---|---|---|
| id | uuid | PK | |
| firstName | string | required | |
| lastName | string | required | |
| email | string | unique, lowercase | Login con `trim().toLowerCase()` |
| passwordHash | string | required | Argon2 |
| phone | string | required | 10–13 dígitos |
| dni | string | unique | 7–8 dígitos |
| employeeId | string | unique | Legajo. También usable como credencial de login |
| address | string | required | Domicilio |
| birthDate | date | required | |
| siteId | uuid | FK → Site | Provincia del empleado (spec §29.1) |
| cuil | string? | nullable | Solo existe en el mock de perfil de mobile; origen de carga a confirmar |
| hireDate | date? | nullable | Ídem |
| position | string? | nullable | Ídem (puesto) |
| role | UserRole | required | Ver enums |
| accountStatus | AccountStatus | default ACTIVE | INACTIVE bloquea todo acceso y operación (spec §6/§11.4) |

Nunca se elimina: se desactiva. Empleado creado por admin queda habilitado inmediato, sin verificación de email ni cambio de contraseña obligatorio (spec §11.1).

### Site (provincia)

| Campo | Tipo | Constraint |
|---|---|---|
| id | uuid | PK |
| name | string | unique |

Seed inicial (las 6 provincias que mobile ya tiene fijas en `constants/data.ts`): San Juan, Mendoza, Catamarca, La Rioja, Salta, San Luis. Es tabla (no enum) porque `Site 1:N User` y `Site 1:N Workplace` necesitan FK.

### Client

| Campo | Tipo | Constraint |
|---|---|---|
| id | uuid | PK |
| name | string | required |
| status | EntityStatus | default ACTIVE |

Nunca se elimina; INACTIVE conserva historial (spec §30).

### Workplace

| Campo | Tipo | Constraint | Notas |
|---|---|---|---|
| id | uuid | PK | |
| clientId | uuid | FK → Client, required | Pertenencia obligatoria (spec §31.1) |
| siteId | uuid | FK → Site, required | |
| name | string | required | |
| shapeType | ShapeType | default CIRCLE | Única forma en MVP |
| latitude | float | required | Centro del círculo |
| longitude | float | required | |
| radiusMeters | int | required | |
| gpsAccuracyThreshold | int? | nullable | Umbral de precisión GPS en metros (ej. 30). Si se supera → revisión PENDING |
| status | EntityStatus | default ACTIVE | No se elimina |

### AttendanceEvent (append-only)

Evento atómico emitido por mobile (o cargado por admin). Inmutable: nunca se actualiza ni se borra. Es la fuente de la proyección.

| Campo | Tipo | Constraint | Notas |
|---|---|---|---|
| id | uuid | PK | |
| userId | uuid | FK → User | |
| workplaceId | uuid | FK → Workplace | |
| type | AttendanceEventType | required | `CHECK_IN` / `CHECK_OUT` / `ABSENCE` |
| occurredAt | timestamp | required | Hora del evento según el dispositivo (ISO 8601 UTC) |
| receivedAt | timestamp | required | Hora de recepción en el servidor |
| latitude | float | required | |
| longitude | float | required | |
| accuracy | float | required | Metros de precisión del fix GPS |
| locationTimestamp | timestamp | required | Hora del fix GPS (puede diferir de `occurredAt`) |
| observation | string? | nullable | |
| absenceReason | AbsenceReason? | nullable | Solo si `type = ABSENCE` |
| clientRequestId | string | unique | Clave de idempotencia generada por el cliente (cola offline) |
| origin | EventOrigin | required | `MOBILE` / `ADMIN` |
| deviceInfo | json? | nullable | Metadata del dispositivo (spec §24) |

### AttendanceRecord (registro diario)

| Campo | Tipo | Constraint | Notas |
|---|---|---|---|
| id | uuid | PK | |
| userId | uuid | FK → User | |
| workplaceId | uuid | FK → Workplace | |
| date | date | required | Calculada en GMT-3 desde el evento |
| totalWorkMinutes | int | default 0 | Suma de intervalos `WORK` cerrados; ABSENCE no suma (spec §14) |
| recordStatus | RecordStatus | required | `COMPLETE` / `INCOMPLETE` — deriva de los intervalos (§15) |
| reviewStatus | ReviewStatus | default NONE | Ver enums (§16) |
| origin | RecordOrigin | required | `MANUAL` si al menos un intervalo es manual (§17) |
| observations | string? | nullable | |
| | | unique(userId, workplaceId, date) | Un registro por día por lugar (§8/§12) |

Prohibido eliminar registros (§26).

### Interval

| Campo | Tipo | Constraint | Notas |
|---|---|---|---|
| id | uuid | PK | |
| recordId | uuid | FK → AttendanceRecord | |
| type | IntervalType | required | `WORK` / `ABSENCE` (§19) |
| startTime | timestamp? | nullable | Opcional en `ABSENCE` (§19) |
| endTime | timestamp? | nullable | Opcional en `ABSENCE` |
| intervalStatus | IntervalStatus | required | `OPEN` / `CLOSED` / `SEMI_CLOSED` (§21) |
| reviewStatus | IntervalReviewStatus | default NONE | Sin `MANUAL_LOADED` a nivel intervalo (§22) |
| origin | RecordOrigin | required | `AUTOMATIC` / `MANUAL` |
| absenceReason | AbsenceReason? | nullable | |
| observations | string? | nullable | |
| entryEventId | uuid? | FK → AttendanceEvent | Metadata del evento de entrada (§24) |
| exitEventId | uuid? | FK → AttendanceEvent | |

### Timesheet (planilla)

| Campo | Tipo | Constraint | Notas |
|---|---|---|---|
| id | uuid | PK | |
| employeeId | uuid | FK → User | |
| workplaceId | uuid | FK → Workplace, required | Spec §39.3 |
| month | int | 1–12 | |
| year | int | required | |
| sequenceNumber | int | required | Secuencial por (employeeId, workplaceId, month, year); sin unicidad en la combinación (§39.1) |
| status | TimesheetStatus | default PENDING | `PENDING` / `LOADED` / `ERROR` (§39.2) |
| fileKey | string | required | Clave en el bucket (R2) |
| fileName | string | required | |
| uploadedBy | uuid | FK → User | Quién cargó (§39.4) |

No se elimina (§39.5). Reemplazar el archivo borra el anterior del bucket permanentemente. La carga NO genera registros automáticamente (soporte documental; la carga de registros es manual).

### Document (legajo digital)

| Campo | Tipo | Constraint | Notas |
|---|---|---|---|
| id | uuid | PK | |
| employeeId | uuid | FK → User | |
| workplaceId | uuid? | FK → Workplace, nullable | Opcional (cargas de contingencia desde mobile llegan sin lugar) |
| type | DocumentType | required | Catálogo fijo (§40.2) |
| format | string | required | Extensión |
| fileName | string | required | Nombre visible, editable (§40.4) |
| fileKey | string | required | Clave en el bucket (R2) |
| uploadedBy | uuid | FK → User | |

Sí se puede eliminar (con confirmación en UI, §40.5). No se vincula técnicamente a ausencias/registros (§38.2).

### Tablas de auth

- `RefreshToken`: id, userId, tokenHash, expiresAt, rotatedAt?, revokedAt?, replacedById? — rotación con detección de reuso.
- `OtpCode`: id, userId? (null en registro, donde el usuario todavía no existe), codeHash, purpose (`REGISTER` / `GOOGLE_LOGIN` / `ADMIN_2FA`), channel (`WHATSAPP` / `EMAIL`), payload json? (datos del registro hasta verificar), expiresAt, attempts, consumedAt?.
- `PasswordResetToken`: id, userId, tokenHash, expiresAt, consumedAt? — un solo uso.
- `AdminAccessRequest`: id, userId, status (`PENDING` / `APPROVED` / `REJECTED`), decisionTokenHash (links firmados del email al SuperAdmin), expiresAt, decidedAt?, decidedBy?.

## Enums (definición central — cierra los pendientes de spec §89)

```ts
enum UserRole { EMPLOYEE, TO_BE_ADMIN, ADMIN, SUPER_ADMIN }
enum AccountStatus { ACTIVE, INACTIVE }
enum EntityStatus { ACTIVE, INACTIVE }              // Client, Workplace
enum RecordStatus { COMPLETE, INCOMPLETE }
enum ReviewStatus { NONE, PENDING, APPROVED, REJECTED, MANUAL_LOADED }
enum IntervalStatus { OPEN, CLOSED, SEMI_CLOSED }
enum IntervalType { WORK, ABSENCE }
enum IntervalReviewStatus { NONE, PENDING, APPROVED, REJECTED }
enum RecordOrigin { AUTOMATIC, MANUAL }
enum AttendanceEventType { CHECK_IN, CHECK_OUT, ABSENCE }
enum EventOrigin { MOBILE, ADMIN }
enum TimesheetStatus { PENDING, LOADED, ERROR }
enum ShapeType { CIRCLE }
enum AbsenceReason { ILLNESS, VACATION, LEAVE, ART, OTHER }
enum DocumentType {
  DNI, MEDICAL_CERTIFICATE, CONTRACT, ART, EPP_DOCUMENTATION,
  MEDICAL_RECORD, INTERNAL_RULES, ADDRESS_DECLARATION, OTHER
}
enum OtpPurpose { REGISTER, GOOGLE_LOGIN, ADMIN_2FA }
enum OtpChannel { WHATSAPP, EMAIL }
enum AdminRequestStatus { PENDING, APPROVED, REJECTED }
```

### Labels en español (para UI — los entregan las apps o un endpoint de catálogos)

- `AbsenceReason`: ILLNESS → Enfermedad, VACATION → Vacaciones, LEAVE → Licencia, ART → ART, OTHER → Otros. "Otros" no exige observación (§20).
- `DocumentType`: DNI → DNI, MEDICAL_CERTIFICATE → Certificado médico, CONTRACT → Contrato, ART → ART, EPP_DOCUMENTATION → Documentación EPP, MEDICAL_RECORD → Ficha médica, INTERNAL_RULES → Normas internas, ADDRESS_DECLARATION → Declaración de domicilio, OTHER → Otros.

Los catálogos son **fijos en código, no configurables** (spec Parte 5). El backend expone `GET /catalogs` para que las apps no dupliquen los labels.

## Formatos de archivo permitidos (planillas y documentos)

`pdf, jpg, jpeg, png, doc, docx, txt` — máx. **20 MB** por archivo (spec §39/§40). Se valida extensión **y** magic bytes en el backend.
