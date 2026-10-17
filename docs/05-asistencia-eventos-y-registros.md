# 05 — Asistencia: eventos y registros

**Estado:** ingesta/proyección/status implementados y aprobados tras revisión independiente. Endpoints admin y matriz mensual F-006 implementados y aprobados tras revisión independiente. Decisión humana vigente: hora efectiva del servidor online y orden de recepción; offline con occurredAt y clientSentAt conforme reglas siguientes. Contrato común en arquitectura/contratos-api.md; HTTP y DTOs en 03.

El corazón del sistema. Reconcilia los dos modelos que relevó `contratos-api.md` (divergencia 2, resuelta por el humano):

- **Mobile emite eventos atómicos**: el empleado solo registra que ingresó o que se fue (`entrada`/`salida`/`ausencia`). El servidor asigna la hora online; el flujo offline conserva la hora original y aporta hora actual del teléfono para validar el reloj al sincronizar.
- **Admin ve un registro diario** por `(userId, workplaceId, date)` compuesto por **intervalos** (spec §8/§12–§17). La mayoría de los registros tienen un solo intervalo (entró y se fue); los turnos cortados son la excepción.

El backend guarda **ambos**: eventos append-only como fuente de verdad auditable, y el registro diario con intervalos como proyección derivada.

## Pipeline de ingesta

`POST /attendance/events` → todo en **una transacción**:

1. **Idempotencia**: si ya existe un `AttendanceEvent` con ese `clientRequestId`, devolver 200 con el resultado original (`eventId`, `recordId`, `message`). Nunca duplicar. Esto soporta la cola offline de mobile (`offlineRegisterService` reintenta hasta éxito, sin límite).
2. **Validaciones** de negocio (ver abajo).
3. **Persistir el evento** (`AttendanceEvent`, inmutable): `receivedAt` siempre del servidor; `occurredAt` online del servidor y offline de la marcación original tras validar ventana y reloj de sincronización.
4. **Proyección**: localizar o crear el `AttendanceRecord` de `(userId, workplaceId, date)` donde `date` se calcula convirtiendo la hora efectiva (`occurredAt`, con procedencia online/offline) a **GMT-3** (zona única del sistema; un evento a las 23:30 UTC del 15/09 cuenta para el 15/09 GMT-3).
5. Aplicar el **algoritmo de construcción de intervalos** (spec §23):
   - `CHECK_IN` → siempre crea un intervalo `WORK` nuevo con `startTime`, `intervalStatus=OPEN`, `entryEventId=evento`.
   - `CHECK_OUT` → completa el **último intervalo abierto** (`endTime`, `intervalStatus=CLOSED`, `exitEventId=evento`). Si no hay abierto → crea un intervalo solo con salida, `SEMI_CLOSED`.
   - `ABSENCE` → crea intervalo `ABSENCE` (inicio/fin opcionales; el admin puede completarlos luego, §19) con `absenceReason` si vino.
6. **Recalcular el registro**: `totalWorkMinutes` (suma de intervalos `WORK` cerrados; ABSENCE no suma, §14), `recordStatus` (todo cerrado → `COMPLETE`; algún `OPEN`/`SEMI_CLOSED` → `INCOMPLETE`, §15), `origin` (`MANUAL` si al menos un intervalo es manual, §17).
7. Responder 201 con `{ eventId, recordId, message }`.

## Hora del servidor, recepción y cola offline

Decisión humana vigente: online usa hora efectiva del servidor. En el flujo offline el request aporta hora de marcación (`occurredAt`) y hora actual del teléfono al sincronizar (`clientSentAt`); esta última no puede adelantarse más de dos minutos respecto de `receivedAt`, asignado por servidor. Esta excepción permite conservar la hora de marcación offline. Mantener ambas procedencias explícitas; no presentar una hora de cliente como certificada por servidor.

Procesar en orden de recepción, sin reconstruir intervalos ordenándolos por hora cliente. Se conserva la ventana offline aprobada de hasta 24 h; la aclaración humana no la retiró. No se exige conexión para toda marcación. La comprobación del reloj al sincronizar limita el adelanto actual, pero no demuestra por sí sola cuándo ocurrió la marcación original.

Contrato F-005: clientSentAt presente distingue offline y exige occurredAt; sin clientSentAt se asigna hora online del servidor. No imponer límite simétrico al reloj atrasado. El último WORK OPEN es el último creado por recepción/proyección, no el de mayor hora original. locationTimestamp se conserva como metadata del fix, sin convertirlo en hora efectiva. Rechazo del adelanto actual >2 min usa INVALID_TIMESTAMP; frontera inclusiva a probar. Caso ratificado: salida anterior al startTime del último OPEN creado por recepción conserva un nuevo SEMI_CLOSED y registro PENDING; mantiene entrada OPEN, sin minutos negativos ni reconstrucción. No se busca otro abierto para cambiar el criterio de último recibido. Implementación F-005 lista, aprobación independiente completada.

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

- Edición: corregir horarios, agregar/actualizar/eliminar intervalos (conservar al menos uno e identidad diaria inmutable), crear registros desde cero (`POST /records`).
- Toda corrección de datos/observaciones del admin sobre un registro automático marca `reviewStatus=MANUAL_LOADED` y `origin=MANUAL` (§16/§17).
- Los intervalos creados/editados por admin tienen `origin=MANUAL` y **no** generan `AttendanceEvent` (los eventos son la huella de las marcaciones reales; la carga manual vive solo en la proyección).
- Aprobación pura: `PATCH /records/{id}/review` con expectedVersion y reviewStatus=APPROVED. Conserva origen, horarios, observaciones e intervalos. No existe REJECTED. Conflicto de versión devuelve 409 RECORD_VERSION_CONFLICT.
- **Prohibido eliminar registros** (§26).
- `Interval.reviewStatus` (§22) permite revisión a nivel intervalo cuando haga falta granularidad.

## Qué queda del lado de mobile (cambios pendientes en su app)

- `RegisterRequest` pasa a inglés y al contrato `POST /attendance/events`: `action` → `type`, `timestamp` → `occurredAt`, **agregar `clientRequestId`** (usar el `id` de su cola offline) y **`absenceReason`** (hoy el motivo queda en estado local — su deuda #9).
- `RegisterResponse { success, message, registrationId }` → `{ data: { eventId, recordId, message } }`.
- Activar la suscripción de conectividad para disparar `syncPendingRegisters()` (hoy el import está comentado — su deuda #8).

## Completitud vigente y casos de referencia

| Tipo/extremos | Intervalo | Minutos | Registro si único intervalo |
|---|---|---|---|
| WORK ambos | CLOSED | diferencia | COMPLETE |
| WORK solo inicio | OPEN | 0 | INCOMPLETE |
| WORK solo fin | SEMI_CLOSED | 0 | INCOMPLETE |
| ABSENCE ninguno o ambos | CLOSED | 0 | COMPLETE |
| ABSENCE solo inicio | OPEN | 0 | INCOMPLETE |
| ABSENCE solo fin | SEMI_CLOSED | 0 | INCOMPLETE |

Total = suma WORK CLOSED, sin campo de horas de ausencia. Entrada 09:00, entrada 11:00, salida 12:00, salida 18:00 cierra 11–12 y 09–18: 600 min aun con solapamientos. No reescribir históricos; nuevas cargas manuales rechazan solapamientos, WORK incompletos y registros sin intervalos. Motivo de ausencia opcional siempre.

Medianoche GMT-3: entrada 2026-09-18T02:50:00Z y salida 2026-09-18T03:10:00Z producen dos registros (17/09 OPEN; 18/09 SEMI_CLOSED), INCOMPLETE, 0 min cerrados. No cerrar ni fusionar automáticamente. Estos casos tienen cobertura HTTP/PostgreSQL real en test/attendance.e2e.cjs, incluidos offline fuera de orden, fronteras exactas de tiempo, concurrencia e ingesta atómica.

Revisión individual de intervalos fuera del incremento actual: no inferir ruta. Correcciones históricas para entidades inactivas permitidas, con revalidación; operaciones nuevas bloqueadas, lectura conservada.

Regla humana de estructura: un workplace con registros no puede cambiar cliente ni provincia. El bloqueo se verifica bajo lock Workplace para no competir con la primera ingesta; snapshots client/site del record conservan contexto. Esto mantiene una única fila mensual empleado–lugar. Detalle admin ratificado: intervalos sin MANUAL_LOADED; evento conserva recordId y puede tener intervalId null tras eliminar su intervalo (F-006 implementada y aprobada).

Reglas manuales F-006 ratificadas (implementadas y aprobadas): separar turnos por día GMT-3; cada tramo pertenece a su registro diario y puede terminar exactamente a00:00 del día siguiente. Validar solapamientos de todos los intervalos con horarios, WORK y ABSENCE. Una corrección conserva o reduce intersecciones históricas, pero no las amplía ni crea otras; comparar por pares y rango de intersección. Tramos contiguos no se solapan. No invalidar históricos no modificados.

Transición efectiva vigente al ingresar nuevos eventos: si no hay señal GPS/fuera de orden, conserva reviewStatus previo, incluso APPROVED/MANUAL_LOADED; origin MANUAL se conserva. GPS/fuera de orden marca PENDING. Replay no muta nada. Propuesta adicional de volver PENDING tras cualquier evento nuevo a un registro APPROVED consultada al humano, sin aprobación aún; no se implementa por inferencia ni condiciona el alcance de corrección/matriz ya ratificado.
