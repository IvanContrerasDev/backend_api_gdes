# 02 — Modelo de datos

**Diseño aprobado, implementación parcial:** schema actual contiene User (con emailVerifiedAt), Site, Client, Workplace y auth base (AuthSession/AuthRefreshToken/AuthChallenge/AuthRateLimit). Gestión de empleados/perfil implementada; incluye AttendanceEvent/AttendanceRecord/Interval; incluye Timesheet como persistencia para métricas mensuales; incluye Document/uploads y StorageCleanupJob; registro/recuperación/Google implementados y aprobados; solicitud admin pendiente. OtpPurpose.LOGIN ya existe; ReviewStatus/IntervalReviewStatus sin REJECTED; AdminRequestStatus lo conserva. Nivel Prisma de diseño. Todos los ids son `uuid`. Timestamps `createdAt`/`updatedAt` en UTC en todas las entidades salvo que se indique lo contrario. **Timezone lógica del sistema: GMT-3 única** (spec admin §29/§76) — ver regla de fechas en `05-asistencia-eventos-y-registros.md`.

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
User 1──N RefreshToken / OtpCode / PasswordResetToken / EmailVerificationToken / AdminAccessRequest
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
| cuil | string? | nullable | Nullable; Admin puede actualizarlo (P-06), carga histórica inicial sin definir |
| hireDate | date? | nullable | Nullable; actualizable por Admin |
| position | string? | nullable | Nullable; actualizable por Admin |
| role | UserRole | required | Ver enums |
| accountStatus | AccountStatus | default ACTIVE | INACTIVE bloquea todo acceso y operación (spec §6/§11.4) |
| emailVerifiedAt | timestamp? | nullable | `null` hasta confirmar el email (magic link del registro mobile). Sin verificar → login bloqueado (403 `EMAIL_NOT_VERIFIED`) |

Unicidad email normalizada implementada por índice PostgreSQL lower(trim(email)), además del índice Prisma original. La migración no fusiona ni borra identidades históricas en conflicto. Campos nullables de perfil actualizables desde PATCH users; fechas validadas en GMT-3.

Nunca se elimina: se desactiva. Empleado creado por admin queda habilitado inmediato, sin verificación de email (`emailVerifiedAt` se setea en el alta) ni cambio de contraseña obligatorio (spec §11.1).

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

Implementado con migración `20261016000000_structure`. Índice único PostgreSQL por expresión normaliza mayúsculas/espacios del nombre; búsqueda separada usa unaccent. Nunca se elimina; INACTIVE conserva historial (spec §30).

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

Persistencia de estructura implementada: FK Client/Site, unicidad por cliente/provincia/nombre normalizado y checks de geometría en SQL. La creación/reasignación bloquea el cliente en transacción para coordinar su desactivación. Inactivar cliente no cambia status de sus lugares; el catálogo mobile excluye ambos estados inactivos.

### AttendanceEvent (append-only)

Evento atómico emitido por mobile. Las correcciones manuales de Admin no generan eventos; otros usos del enum EventOrigin.ADMIN no están definidos. Inmutable: nunca se actualiza ni se borra. Es la fuente de la proyección.

| Campo | Tipo | Constraint | Notas |
|---|---|---|---|
| id | uuid | PK | |
| userId | uuid | FK → User | |
| workplaceId | uuid | FK → Workplace | |
| recordId | uuid | FK → AttendanceRecord, required | Vínculo durable aun sin intervalo |
| type | AttendanceEventType | required | `CHECK_IN` / `CHECK_OUT` / `ABSENCE` |
| occurredAt | timestamp | required | Hora efectiva: servidor online; original del cliente offline validada al sincronizar (05) |
| receivedAt | timestamp | required | Hora de recepción en el servidor |
| clientSentAt | timestamp? | nullable | Hora actual del teléfono al sincronizar; null online |
| latitude | float | required | |
| longitude | float | required | |
| accuracy | float | required | Metros de precisión del fix GPS |
| locationTimestamp | timestamp | required | Hora del fix GPS (puede diferir de `occurredAt`) |
| observation | string? | nullable | |
| absenceReason | AbsenceReason? | nullable | Solo si `type = ABSENCE` |
| clientRequestId | string | unique | Clave de idempotencia generada por el cliente (cola offline) |
| origin | EventOrigin | required | `MOBILE` / `ADMIN` |
| deviceInfo | json? | nullable | Metadata original del dispositivo (spec §24) |
| responseMessage | string | required | Respuesta original para replay idempotente |

### AttendanceRecord (registro diario)

| Campo | Tipo | Constraint | Notas |
|---|---|---|---|
| id | uuid | PK | |
| userId | uuid | FK → User | |
| workplaceId | uuid | FK → Workplace | |
| clientId/siteId | uuid | FK → Client/Site | Snapshot del lugar al crear |
| date | date | required | Calculada en GMT-3 desde el evento |
| version | int | default 1 | Incrementa con cada evento/corrección/aprobación |
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
| sequence | int | unique(recordId,sequence) | Orden de creación por recepción, independiente de version |
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
| absenceEventId | uuid? | FK → AttendanceEvent | |

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

Persistencia implementada: AuthSession (usuario/cliente/rol/CSRF/remember/vencimiento/revocación), AuthRefreshToken (HMAC/generación/uso), AuthChallenge (LOGIN/GOOGLE_LOGIN/ADMIN_2FA, OTP hash, contacto destinationHash, credentialVersion, preauth, intentos/fechas), AuthRateLimit (keyHMAC/contador/ventana). User.credentialVersion invalida challenges previos sin adquirirlos al cambiar credenciales. Fechas técnicas explícitas; no se presupone updatedAt genérico.

RegistrationChallenge separado: perfil validado+passwordHash temporal, hashOTP, attempts/expiry/sent/consumed/createdAt; sin User antes del OTP y payload null al consumo, retenciónmáxima72h. AuthLink EMAIL_VERIFICATION24h/PASSWORD_RESET1h contiene userId, hash del token, emailHash, credentialVersion, createdAt/expiresAt/consumedAt. No existen tablas OtpCode/EmailVerificationToken/PasswordResetToken con los nombres del diseño inicial.

AuthEmailIntent persiste email cifrado AES256-GCM, purpose, linkId opcional, namespace de clave/configuración, intentos/nextAttemptAt/lockedUntil/completedAt/expiresAt. En registro se crea junto a User/consumoOTP/link. En endpoints neutros se crea sin lookup de usuario; worker resuelve elegibilidad y prepara una sola vez el enlace. Token firmado solo reconstruido a partir de metadatos, nunca almacenado en claro. Lease/fencing evita que un worker anterior cambie el resultado de una reclamación posterior.

AdminAccessRequest y challenge administrativo siguen pendientes F-008C: decisión PENDING/APPROVED/REJECTED7días; cancelación persistida por INACTIVE y renovación tras nueva prueba email ya ratificadas. No crean/cambian rol antes de OTP. Detalle normativo en03/04 y spec activo.

## Enums (definición central — cierra los pendientes de spec §89)

```ts
enum UserRole { EMPLOYEE, TO_BE_ADMIN, ADMIN, SUPER_ADMIN }
enum AccountStatus { ACTIVE, INACTIVE }
enum EntityStatus { ACTIVE, INACTIVE }              // Client, Workplace
enum RecordStatus { COMPLETE, INCOMPLETE }
enum ReviewStatus { NONE, PENDING, APPROVED, MANUAL_LOADED }
enum IntervalStatus { OPEN, CLOSED, SEMI_CLOSED }
enum IntervalType { WORK, ABSENCE }
enum IntervalReviewStatus { NONE, PENDING, APPROVED }
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
enum OtpPurpose { REGISTER, LOGIN, GOOGLE_LOGIN, ADMIN_2FA }
enum OtpChannel { WHATSAPP, EMAIL }
enum AdminRequestStatus { PENDING, APPROVED, REJECTED }
```

### Labels en español (para UI — los entregan las apps o un endpoint de catálogos)

- `AbsenceReason`: ILLNESS → Enfermedad, VACATION → Vacaciones, LEAVE → Licencia, ART → ART, OTHER → Otros. "Otros" no exige observación (§20).
- `DocumentType`: DNI → DNI, MEDICAL_CERTIFICATE → Certificado médico, CONTRACT → Contrato, ART → ART, EPP_DOCUMENTATION → Documentación EPP, MEDICAL_RECORD → Ficha médica, INTERNAL_RULES → Normas internas, ADDRESS_DECLARATION → Declaración de domicilio, OTHER → Otros.

Los catálogos son **fijos en código, no configurables** (spec Parte 5). El backend expone `GET /catalogs` para que las apps no dupliquen los labels.

## Formatos de archivo permitidos (planillas y documentos)

`pdf, jpg, jpeg, png, doc, docx, txt` — máx. **20 MiB (20 × 1024 × 1024 bytes)** por archivo (spec §39/§40). Se valida extensión **y** magic bytes en el backend.

## Concurrencia y validación de diseño

AttendanceRecord requiere version para expectedVersion y unicidad (userId, workplaceId, date). Aprobación y corrección incrementan versión; no se borran registros. Solo WORK CLOSED suma totalWorkMinutes; ver tabla de completitud en 05. radiusMeters entero 10–10000, gpsAccuracyThreshold null o entero 1–1000. Dirección/Place ID de Google no se persisten en Workplace. Validaciones/unicidades y DTOs públicos de P-06/P-07 en 03; no exponer passwordHash ni fileKey. Refresh web implementa expiración absoluta y CSRF ratificado en04.

Persistencia de asistencia implementada en20261016030000_attendance, aprobación independiente completada. Event.recordId conserva auditoría; los vínculos entry/exit/absence viven en Interval para permitir futuras correcciones sin reescribir eventos. Workplace con registros congela clientId/siteId bajo lock; snapshots no se reescriben.

### MonthlySnapshot (F-006 implementada y aprobada)

Tabla técnica: id UUID/token opaco, ownerId FK User, context canónico, payload JSON inmutable con filas/días/nombres/estados/totales, createdAt y expiresAt absoluto15min. Índices ownerId/expiresAt; sin updatedAt por inmutabilidad. Limpieza solo expirados. AttendanceRecord agrega índices date/userId/workplaceId y workplaceId para matriz/guard histórico. Los snapshots no autorizan escrituras.

### Persistencia de planillas y métricas implementada

Timesheet fue incorporado por F-009 (migración20261017000000_timesheets) para contar fuentes reales. Campos de diseño anteriores más fileExtension/fileSizeBytes, version1 y replacedById nullable; uploadedById identifica uploader original. Unicidad(employeeId,workplaceId,month,year,sequenceNumber), checks de mes1–12/año2000–9999/tamaño y secuencia positivos; índices período/status y lugar. Las rutas de archivos aún son F-007. Dashboard lee snapshot AttendanceRecord.siteId y provincia del lugar de Timesheet, con agregados en RepeatableRead.

### Archivos implementados y aprobados

Migraciones20261017010000_files y20261017011000_storage_cleanup_namespace: Timesheet agrega contentType y fileKey único; Document implementa campos de diseño con fileExtension/fileSizeBytes/contentType y relaciones employee/uploader/workplace(nullable), fileKey único e índices de consulta. StorageCleanupJob técnico conserva key única, namespace hash(endpoint+bucket), attempts,nextAttemptAt,createdAt/updatedAt; índice namespace/nextAttemptAt. Journal previo a PUT y cancelación atómica al publicar metadata; worker por destino, referencia actual y lease fresca tras lock impiden borrar objetos vigentes o publicar claves purgadas. Ver06 para recuperación/operación. Se congela cliente/provincia del lugar con registros o planillas.
