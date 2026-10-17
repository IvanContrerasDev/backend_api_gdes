# Propuesta común — Dashboard mensual ratificado

Pendiente de incorporación y sync por orchestrator. No modificar contratos SYNCED en este repo.

Humano confirmó con captura docs/arquitectura/dashboardMetricsFrontendExample.png: GET /dashboard/metrics?month=<1..12>&year=<2000..9999>, solo ADMIN/SUPER_ADMIN. Sustituye el diseño /dashboard/summary. Respuesta {data:{pendingTimesheets,incompleteRecords,pendingReviewRecords,recordsWithAbsence,byProvince:[{id,name,pendingTimesheets,incompleteRecords,pendingReviewRecords,recordsWithAbsence}]}}. Totales generales del período y todas las provincias, incluso ceros. pendingTimesheets cuenta planillas PENDING por período; incompleteRecords cuenta registros INCOMPLETE; pendingReviewRecords cuenta PENDING; recordsWithAbsence cuenta registros con >=1 ABSENCE una vez. Las condiciones pueden coexistir. Provincia del lugar del registro/planilla, no domicilio del empleado. Registros usan snapshot siteId. No filtrar inactivos históricos. Filtros de destino conservan mes/año; navegación es responsabilidad frontend.

Motivo: reflejar las cuatro tarjetas y sus desgloses con datos reales, evitando duplicar ausencias o confundir fecha de subida con período de planilla.
