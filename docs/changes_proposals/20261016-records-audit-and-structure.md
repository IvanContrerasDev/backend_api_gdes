# Registros: auditoría de intervalos y estructura histórica

Origen: respuestas humanas explícitas de esta sesión backend. Estado: pendiente de incorporación al contrato común y sync; copia local SYNCED sin editar.

Destino Detalle y metadata: RecordInterval.reviewStatus usa NONE/PENDING/APPROVED. MANUAL_LOADED solo registro; intervalo corregido origin MANUAL. AttendanceEventDetail.intervalId pasa a string|null: al quitar intervalo, evento original permanece vinculado a recordId y el detalle puede devolver null. No crear eventos de correcciones manuales.

Destino Clientes y lugares/Consulta mensual: el humano rechazó dividir filas por cliente/provincia histórica y eligió impedir cambios de clientId/siteId del workplace cuando exista cualquier registro. Mantener fila mensual empleado–lugar. Nombre/geometría pueden editarse; relaciones idénticas son idempotentes. Guard bajo lock Workplace, compatible con ingesta y futuros POST manuales, evita TOCTOU. Error existente400 INVALID_WORKPLACE_DATA con mensaje específico, sin nuevo código. Snapshots del record conservados como auditoría.

Motivo: conservar evidencias originales y evitar atribuir trabajo anterior a un nuevo cliente/provincia. Consolidar detalle técnico en03/05 y retirar solo tras incorporación/sync verificados.

Destino Corrección y aprobación: carga manual se separa por día GMT-3, admitiendo endTime exactamente00:00 del día siguiente. El cliente carga cada tramo diario; no creación implícita multirregistro. Validar solapamientos WORK y ABSENCE con ambos extremos. Intersecciones históricas se conservan o reducen; no crear/ampliar intersecciones por pares/rango. Tramos contiguos no se solapan. Decisiones humanas ratificadas en esta sesión.

Publicación técnica backend F-006: DTO de detalle común confirmado con los ajustes anteriores; metadata escalar y mapping completo publicados en03 (clientRequestId/clientSentAt reservados de DB; deviceInfoJson conserva JSON original si anidado/colisión). Snapshot persistido PostgreSQL15min absoluto con orden COLLATE C; referencias a implementación y pruebas reales en03/05. Incorporar al común la disponibilidad final tras review, sin convertir los mocks anteriores en evidencia de integración.

Destino Asistencia/revisión: humano ratificó que cualquier evento nuevo CHECK_IN/CHECK_OUT/ABSENCE sobre APPROVED lo devuelve a PENDING transaccionalmente y aumenta versión; origin MANUAL se conserva. Reintentos idempotentes y eventos rechazados no modifican aprobación. La aprobación corresponde a los datos vigentes al aprobar, no a fichadas futuras.
