# Documentación del backend

Estado real: F-001 bootstrap implementada; solo GET /health está registrado, sin prefijo. Auth, recursos de negocio, integraciones y API /api/v1 siguen pendientes. Evidencia de código y limitaciones actuales en 01; detalle HTTP de diseño en 03. La documentación diferencia requisitos aprobados de implementación efectiva.

Leer 01 arquitectura/stack; 02 modelo; 03 HTTP/DTOs; 04 auth; 05 asistencia; 06 integraciones; 07 convenciones/errores. Acuerdos cross-app y racional en [contrato común](arquitectura/contratos-api.md); política documental en [flujo común](convenciones/flujo-de-trabajo.md).

Cada tema conserva decisión vigente y racional breve, con código como evidencia de comportamiento real. No se acumulan historiales. Propuestas temporales se retiran tras consolidación y sync verificado; tasks/inbox solo mientras activos. Lo no decidido permanece etiquetado y se consulta.

Pendientes: seguridad/despliegue web P-02, confirmación DTO detalle F-006, ejemplos/pruebas de API real, Docker y ratificación TTL magic link mobile (ver 03/04 y progress/leader/current.md). Backlog: feature_list.json; leader conserva propiedad de features y specs.
