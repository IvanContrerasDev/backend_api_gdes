# 05 — Asistencia: eventos y registros

El corazón del sistema. Reconcilia los dos modelos que relevó `contratos-api.md` (divergencia 2, resuelta por el humano):

- **Mobile emite eventos atómicos**: el empleado solo registra que ingresó o que se fue (`entrada`/`salida`/`ausencia` con un timestamp cada uno).
- **Admin ve un registro diario** por `(userId, workplaceId, date)` compuesto por **intervalos** (spec §8/§12–§17). La mayoría de los registros tienen un solo intervalo (entró y se fue); los turnos cortados son la excepción.

El backend guarda **ambos**: eventos append-only como fuente de verdad auditable, y el registro diario con intervalos como proyección derivada.

## Pipeline de ingesta

`POST /attendance/events` → todo en **una transacción**:

1. **Idempotencia**: si ya existe un `AttendanceEvent` con ese `clientRequestId`, devolver 200 con el resultado original (`eventId`, `recordId`, `message`). Nunca duplicar. Esto soporta la cola offline de mobile (`offlineRegisterService` reintenta hasta éxito, sin límite).
2. **Validaciones** de negocio (ver abajo).
3. **Persistir el evento** (`AttendanceEvent`, inmutable) con `receivedAt` del servidor.
4. **Proyección**: localizar o crear el `AttendanceRecord` de `(userId, workplaceId, date)` donde `date` se calcula convirtiendo `occurredAt` a **GMT-3** (zona única del sistema; un evento a las 23:30 UTC del 15/09 cuenta para el 15/09 GMT-3).
5. Aplicar el **algoritmo de construcción de intervalos** (spec §23):
   - `CHECK_IN` → siempre crea un intervalo `WORK` nuevo con `startTime`, `intervalStatus=OPEN`, `entryEventId=evento`.
   - `CHECK_OUT` → completa el **último intervalo abierto** (`endTime`, `intervalStatus=CLOSED`, `exitEventId=evento`). Si no hay abierto → crea un intervalo solo con salida, `SEMI_CLOSED`.
   - `ABSENCE` → crea intervalo `ABSENCE` (inicio/fin opcionales; el admin puede completarlos luego, §19) con `absenceReason` si vino.
6. **Recalcular el registro**: `totalWorkMinutes` (suma de intervalos `WORK` cerrados; ABSENCE no suma, §14), `recordStatus` (todo cerrado → `COMPLETE`; algún `OPEN`/`SEMI_CLOSED` → `INCOMPLETE`, §15), `origin` (`MANUAL` si al menos un intervalo es manual, §17).
7. Responder 201 con `{ eventId, recordId, message }`.

## Marcaciones tardías y timestamps

- Se aceptan eventos con `occurredAt` en el pasado (sincronización offline). No hay ventana máxima definida en MVP; si hiciera falta, se configura por env (pendiente solo si aparece el caso).
- `occurredAt` (hora del dispositivo) es el tiempo **oficial** del evento; `receivedAt` y `locationTimestamp` quedan persistidos para auditoría. Si la hora del dispositivo está visiblemente corrupta (futuro lejano), se rechaza con 422 `INVALID_TIMESTAMP` (futuro > 5 min).

## Validaciones GPS (spec §16/§33.3/§47)

Al ingerir, sobre el workplace del evento:

1. Distancia al centro del círculo (`latitude`, `longitude`, `radiusMeters`):
   - Dentro del círculo → OK.
   - Fuera del círculo pero dentro del **margen de tolerancia** (`GEOFENCE_TOLERANCE_METERS`, default 100 m) → se **acepta** y el registro queda `reviewStatus=PENDING`.
   - Fuera del margen → 403 `OUT_OF_WORKPLACE_AREA`.
2. Precisión: si `accuracy` supera el `gpsAccuracyThreshold` del workplace (cuando está configurado) → se **acepta** y el registro queda `reviewStatus=PENDING`.

`PENDING` nunca bloquea la marcación del empleado: es una señal para revisión del admin (§16).

## Estado actual del empleado

`GET /attendance/status` deriva `isWorking` del estado real: hay intervalo `WORK` `OPEN` en el registro de hoy (GMT-3) → `isWorking=true` con `since=startTime` y el `workplaceId`. Reemplaza el booleano en memoria de mobile (su deuda #13).

## Edición y revisión por admin (spec §25/§26)

- Edición total: corregir horarios, agregar intervalos, crear registros desde cero (`POST /records`).
- Toda intervención del admin sobre un registro automático marca `reviewStatus=MANUAL_LOADED` y `origin=MANUAL` (§16/§17).
- Los intervalos creados/editados por admin tienen `origin=MANUAL` y **no** generan `AttendanceEvent` (los eventos son la huella de las marcaciones reales; la carga manual vive solo en la proyección).
- Aprobación/rechazo: `PATCH /records/{id}/review`. Un `REJECTED` sigue visible, destacado y editable, y puede volver a `APPROVED` tras corrección (§16).
- **Prohibido eliminar registros** (§26).
- `Interval.reviewStatus` (§22) permite revisión a nivel intervalo cuando haga falta granularidad.

## Qué queda del lado de mobile (cambios pendientes en su app)

- `RegisterRequest` pasa a inglés y al contrato `POST /attendance/events`: `action` → `type`, `timestamp` → `occurredAt`, **agregar `clientRequestId`** (usar el `id` de su cola offline) y **`absenceReason`** (hoy el motivo queda en estado local — su deuda #9).
- `RegisterResponse { success, message, registrationId }` → `{ data: { eventId, recordId, message } }`.
- Activar la suscripción de conectividad para disparar `syncPendingRegisters()` (hoy el import está comentado — su deuda #8).
