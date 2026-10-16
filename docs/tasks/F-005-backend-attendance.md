# F-005 — Ingesta de asistencia y proyección

**Estado:** blocked (preparación pendiente de respuesta humana; implementación no iniciada)
**App(s):** backend
**Creada:** 2026-10-16

## Contexto y referencias

Implementar POST /attendance/events y GET /attendance/status EMPLOYEE, según docs/03, docs/05, docs/07, modelo02 y contrato común Asistencia/Eventos. Las decisiones humanas locales de hora online/offline y orden de recepción en05 prevalecen sobre la copia común aún no sincronizada; propuesta en changes_proposals/20261016-attendance-server-time.md. Leer AGENTS/skills y rol implementer antes de código.

## Alcance

Eventos append-only idempotentes, registros diarios con intervalos automáticos y GPS. No endpoints admin, edición/revisión manual, matriz, documentos o métricas. No modificar historial ni agregar rutas para probar auth.

## Tiempo y flujo aprobado

- receivedAt siempre asignado por servidor una vez al aceptar el evento; jamás recibido del cliente. Online (sin clientSentAt) usa esa misma hora como occurredAt efectivo, aunque el DTO legado incluya occurredAt de dispositivo.
- Offline se identifica por clientSentAt presente: exige occurredAt original y clientSentAt actual del teléfono al restablecer conexión, ambos ISO válidos. Persistir su procedencia claramente: receivedAt del servidor, occurredAt original offline, clientSentAt metadata del cliente. Nada permite al cliente fijar receivedAt.
- clientSentAt - receivedAt <=120000 ms inclusivo. No imponer límite simétrico a reloj atrasado: el humano solo ratificó adelanto máximo. occurredAt no puede ser posterior a clientSentAt; rechazo422 INVALID_TIMESTAMP no reintentable. Ventana anterior de hasta24h se conserva para offline (receivedAt-occurredAt<=86400000 ms inclusivo); exceso422 ATTENDANCE_EVENT_TOO_OLD. Reintento idempotente se resuelve antes de estas validaciones, después de auth/propiedad.
- Proyección en orden de recepción/procesamiento serializado, no reconstruir por hora cliente. Fecha diaria GMT-3 del occurredAt efectivo, sin fusionar medianoche.
- Pendiente respuesta humana: salida cuyo occurredAt antecede la entrada abierta recibida antes. Propuesta conservadora: no cerrar con duración negativa, crear SEMI_CLOSED y marcar PENDING, conservando entrada OPEN; alternativa rechazo INVALID_TIMESTAMP. No implementar ese caso por suposición.

## Criterios de aceptación

- [ ] Modelos/migración AttendanceEvent, AttendanceRecord, Interval con FKs, timestamps y unicidad global clientRequestId, record(userId,workplaceId,date). Nada DELETE/UPDATE público de eventos/registros. Enums de revisión sin REJECTED conforme diseño aprobado; AdminRequestStatus.REJECTED se conserva.
- [ ] HTTP protegido con JWT/sesión EMPLOYEE; revalidar cuenta activa y lugar/cliente activos dentro de transacción. Lugar inexistente/inactivo404 WORKPLACE_NOT_FOUND, cliente inactivo409 CLIENT_INACTIVE. No aceptar campo userId para actuar por otro.
- [ ] Una transacción persiste evento y proyección. Serializar por User y mantener orden User→Workplace→Client compatible con F-002/F-003/F-004; chequear nuevo estado luego de locks. Recalcular record y guardar IDs estables de respuesta.
- [ ] Idempotencia:201 primer evento,200 replay mismo usuario con IDs/message originales aun vencida ventana o cambiado payload. RequestId ajeno nunca revela respuesta/identidad:403 ROLE_NOT_ALLOWED. Competencia de requests iguales genera un solo evento/proyección; el perdedor devuelve replay tras confirmar transacción ganadora, no500/409 Prisma.
- [ ] CHECK_IN siempre nuevo WORK OPEN. CHECK_OUT cierra último WORK OPEN creado por orden de recepción/proyección del mismo día/lugar (no el de mayor startTime), o crea WORK SEMI_CLOSED. Conservar orden interno estable incluso si createdAt empata; no depender del orden implícito SQL. ABSENCE crea intervalo sin extremos CLOSED y motivo opcional. Ninguna ausencia suma trabajo. Casos cronológicos ambiguos requieren respuesta anterior.
- [ ] recordStatus COMPLETE si todos CLOSED; de otro modo INCOMPLETE. Total entero de minutos = floor(suma duración de WORK CLOSED en milisegundos/60000), evitando pérdidas por truncar cada intervalo. origin AUTOMATIC en esta feature. Versión interna inicial1/incremento por evento prepara expectedVersion futuro, sin nuevo campo HTTP.
- [ ] Snapshot clientId/siteId del record al crearlo para conservar relaciones históricas si el workplace se mueve; nunca reescribir snapshot de registro existente. No ampliar DTO público pendiente de F-006.
- [ ] GPS Haversine sobre configuración actual bloqueada: círculo inclusivo OK; fuera pero <=radio+tolerancia acepta PENDING; fuera de tolerancia403 OUT_OF_WORKPLACE_AREA sin evento/proyección. Accuracy superior a umbral no nulo acepta PENDING. PENDING es señal, no bloqueo. Validar coordenadas finitas/rangos, accuracy finita no negativa, DTO/enums/timestamps válidos con errores422 españoles. Metadata locationTimestamp/deviceInfo se conserva como cliente, no hora efectiva.
- [ ] GET /attendance/status deriva WORK OPEN de hoy GMT-3; isWorking false/since null/workplaceId null sin abiertos. Si varios, seleccionar de forma determinista startTime desc,id desc (no cerrar automáticamente otro lugar). No estado en memoria.
- [ ] HTTP/DB real: permisos, medianoche, múltiples entradas/salidas (600min aprobado), ausencia, sin salida, GPS, atomicidad, replay/otra identidad/concurrencia, online hora servidor y offline clientSentAt, desactivación concurrente. Pruebas de función de tiempo con receivedAt controlado demuestran exactamente24h/+1ms y2min/+1ms; no alterar reloj desde request ni falsear guard. Suites auth/structure/users, build/lint y Prisma validate/deploy/generate pasan.

## Operación y entrega

Branch actual feature/implement_mvp, sin git/subagentes desde implementer. DB exclusiva de tests indicada en test/README; no reset de producción ni usuarios seed ficticios. Build/lint normales, sockets node --test elevados sin compilar elevado (permisos dist). Mantener current del implementer, registro aquí y handoff a reviewer. No editar docs canónicas/SYNCED/feature_list.

## Registro de implementación

(pendiente)

## Review

(pendiente)
