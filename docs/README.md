# Documentación del backend

Estado real: bootstrap y estructura F-003 implementados (clientes, lugares y provincias en /api/v1 con JWT y roles), /health sin prefijo. Auth base implementada con OTP/2FA, sesiones/refresh/CSRF; producción pendiente de providers reales F-008. Empleados/perfil implementados; ingesta/proyección/status de asistencia implementados; registros admin y matriz mensual implementados/aprobados; archivos y dashboard pendientes. Evidencia de código, verificación y limitaciones actuales en 01; detalle HTTP en 03. La documentación distingue requisitos aprobados de implementación efectiva.

Leer 01 arquitectura/stack; 02 modelo; 03 HTTP/DTOs; 04 auth; 05 asistencia; 06 integraciones; 07 convenciones/errores. Acuerdos cross-app y racional en [contrato común](arquitectura/contratos-api.md); política documental en [flujo común](convenciones/flujo-de-trabajo.md).

Cada tema conserva decisión vigente y racional breve, con código como evidencia de comportamiento real. No se acumulan historiales. Propuestas temporales se retiran tras consolidación y sync verificado; tasks/inbox solo mientras activos. Lo no decidido permanece etiquetado y se consulta.

Pendientes: dominios/despliegue web y navegadores P-02, pruebas de los dominios aún no implementados y compose completo. Seguridad web para desarrollo y TTL magic link 24 h ratificados en 04; propuesta común pendiente de sync. Backlog: feature_list.json; leader conserva propiedad de features y specs.
