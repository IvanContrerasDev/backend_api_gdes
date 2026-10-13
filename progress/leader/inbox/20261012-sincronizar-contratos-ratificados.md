# Sincronizar contratos API ratificados (2026-10-12)

**Origen:** orchestrator de GdesProject  
**Estado:** pendiente de procesamiento por leader backend

## Contexto

El contrato común ya fue actualizado en `docs/arquitectura/contratos-api.md` y sincronizado desde el template. Al cotejarlo con `backend_api_gdes/docs/03-contratos-api.md` se encontraron contradicciones: la decisión 12 aún mostraba Geoapify; la revisión aún incluía `REJECTED`; faltaban contratos ratificados después del 2026-09-17. No se modificó documentación local de backend desde el orchestrator.

## Trabajo solicitado

1. Actualizar `docs/03-contratos-api.md` para materializar las decisiones comunes 8–16: matriz mensual con snapshot; auth web separada; solicitud admin verificada; reglas/DTOs P-04; entidades P-06/P-07; aprobación pura y DELETE de intervalos; detalle de registro/eventos bajo demanda.
2. Alinear `docs/02-modelo-de-datos.md`, `docs/04-auth-y-seguridad.md`, `docs/05-asistencia-eventos-y-registros.md` y `docs/07-convenciones.md` con esos contratos. En particular quitar `REJECTED` de estados de revisión de registros/intervalos (manteniendo el estado `REJECTED` de una solicitud de acceso administrativo, que es un dominio distinto).
3. Para P-06/P-07, usar las propuestas ratificadas de Admin disponibles en `admin_web_app/docs/changes_proposals/20260917-p06-contrato-empleados.md` y `20260917-p07-contrato-clientes-lugares.md` como especificación aprobada. No exponer hash/contraseña ni persistir dirección/Place ID.
4. Mantener la diferencia entre el contrato del evento móvil (`clientRequestId`, `absenceReason`) y la proyección de registros que consume Admin. No cambiar código ni decidir cambios nuevos de producto como parte de este trabajo documental.
5. Registrar en el documento las decisiones técnicas pendientes que requieran ratificación humana. Proponer, con riesgos y compatibilidad, identificador de generación de sesión y mecanismo CSRF para P-02; no asumirlos ni implementarlos como decisión aprobada. Los orígenes reales y atributos finales de cookie se cierran cuando exista despliegue/orígenes concretos.
6. Aplicar la decisión 16: límite inclusivo de 24 h desde `occurredAt` hasta `receivedAt` del servidor. Elegir/documentar el error contractual para eventos vencidos, validarlo en la frontera de 24 h y más allá, y mantener pendiente la política ante timestamps futuros/clock skew.
7. En P-02, registrar que el humano prefiere mantener proyectos Vercel separados, pero difiere el dominio final. Es propietario de `prolimpservicios.com` y considera `admin.prolimpservicios.com`; si el API continúa en `backend-gdes.vercel.app`, sigue cross-site; si se mapea a `api.prolimpservicios.com`, sería same-site pero cross-origin. Explicitar que cookies cross-site pueden bloquearse pese a `SameSite=None; Secure` y CORS; proponer fallback y matriz de navegadores antes de cerrar auth web.
8. Marcar como cerradas solo las contradicciones documentales resueltas; dejar explícitos los ejemplos/evidencias de ejecución aún pendientes para F-010.

## Resultado esperado

Actualizar `progress/leader/current.md` mientras se trabaja y dejar un resumen al terminar con rutas actualizadas, contradicciones cerradas y puntos que necesiten decisión humana. El leader backend conserva la propiedad de su backlog y sus task specs.
