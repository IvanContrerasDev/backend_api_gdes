# Registros: auditoría de intervalos y estructura histórica

Origen: respuestas humanas explícitas de esta sesión backend. Estado: pendiente de incorporación al contrato común y sync; copia local SYNCED sin editar.

Destino Detalle y metadata: RecordInterval.reviewStatus usa NONE/PENDING/APPROVED. MANUAL_LOADED solo registro; intervalo corregido origin MANUAL. AttendanceEventDetail.intervalId pasa a string|null: al quitar intervalo, evento original permanece vinculado a recordId y el detalle puede devolver null. No crear eventos de correcciones manuales.

Destino Clientes y lugares/Consulta mensual: el humano rechazó dividir filas por cliente/provincia histórica y eligió impedir cambios de clientId/siteId del workplace cuando exista cualquier registro. Mantener fila mensual empleado–lugar. Nombre/geometría pueden editarse; relaciones idénticas son idempotentes. Guard bajo lock Workplace, compatible con ingesta y futuros POST manuales, evita TOCTOU. Error existente400 INVALID_WORKPLACE_DATA con mensaje específico, sin nuevo código. Snapshots del record conservados como auditoría.

Motivo: conservar evidencias originales y evitar atribuir trabajo anterior a un nuevo cliente/provincia. Consolidar detalle técnico en03/05 y retirar solo tras incorporación/sync verificados.

Destino Corrección y aprobación: carga manual se separa por día GMT-3, admitiendo endTime exactamente00:00 del día siguiente. El cliente carga cada tramo diario; no creación implícita multirregistro. Validar solapamientos WORK y ABSENCE con ambos extremos. Intersecciones históricas se conservan o reducen; no crear/ampliar intersecciones por pares/rango. Tramos contiguos no se solapan. Decisiones humanas ratificadas en esta sesión.
