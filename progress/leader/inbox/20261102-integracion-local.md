# Integración local — instrucciones al leader backend

**Estado:** ejecución autorizada por el humano el 2026-11-04. Paquetes incorporados al backlog F-010–F-013; F-010/B-01 implementado y aprobado; configuración vigente en `../integracion-local-entorno.md` y docs01/06/README. El inbox conserva entregables B-02–B-04 y coordinación G-01/Q-01 aún abiertos; no reemplaza task specs ni aprueba implementaciones.

## Objetivo y decisiones del humano

Integrar backend, Admin y mobile contra API/DB reales, con Android físico en la misma LAN y dependencias locales para archivos y correo. Dominios/CDN/provisión de producción fuera de esta etapa. Sí resolver conectividad local, cookies y enlaces necesarios. Conservar stack y proveedores de producción.

## Referencias

- Plan cross-app temporal: `GdesProject/progress/orchestrator/integracion-local-plan.md` (desde la raíz de este repo: `../progress/orchestrator/integracion-local-plan.md`). Paquetes propios **B-01–B-04** y participación en **G-01/Q-01**.
- Contrato autocontenido: `docs/arquitectura/contratos-api.md`; detalle HTTP `docs/03-contratos-api.md`, integración `docs/06-integraciones.md`, preparación aislada `test/README.md`.
- Roles/ciclo: `.agents/agents/leader.md` y `docs/convenciones/flujo-de-trabajo.md`.

## Trabajo que debe planificar el leader

1. **B-01: stack local reproducible** con PostgreSQL y storage S3 compatible persistente, inicialización de bucket y readiness. Elegir herramientas/versiones mantenidas al escribir spec. API/DB ya tienen dominios implementados: no reabrir F-001–F-009 por suposición de bootstrap. Completar compose/env/SDK para diferenciar dirección interna y URL firmada alcanzable por PC/Android; no cambiar hostname después de firmar. El constructor actual rechaza HTTP fuera de loopback: excepción de desarrollo explícita, producción HTTPS intacta. Health/catalog público 200 y protegido 401; pruebas de bytes y restart sin pérdida.
2. **B-02: correo local completo** mediante `EmailProvider`, capturador/bandeja sin envío externo y selector rechazado en producción. El provider log actual solo revela OTP y no sirve para probar enlaces manualmente. Conservar outbox/TTL/idempotencia; actualizar namespace/destino en workers de auth/solicitudes para no mezclar intenciones. WhatsApp puede conservar provider log, validando OTP real en backend.
3. **B-03: fixture local opt-in y documentación**. Cuentas por rol ya existen; agregar escenario cliente/lugar con centro GPS configurado conscientemente para la ubicación del teléfono. No resetear contraseñas/datos manuales en cada reinicio: revisar seed actual. Comprobar `/catalogs` anónimo, `/sites` protegido, workplaces EMPLOYEE no paginado, challenges reales, status, uploads por rol y `/file`. Entregar ejemplos saneados y comandos de ejecución/prueba aislada.
4. **Q-01: validación con consumidores**: evento Android aparece en matriz Admin, archivo Android se descarga desde Admin, correos locales permiten alta/reset/decisión y sesiones respetan rol/estado. Evidencia en `progress/reviewer/current.md`, docs de su tema y comunicación por archivos.
5. **B-04: contingencia contractual.** El acuerdo común menciona excepción de lugar null, pero `uploadInput` exige UUID para toda planilla y el esquema la vincula obligatoriamente a lugar. El humano confirmó conservar contingencia con lugar null y ajustar backend: materializar esa excepción sin volver a pedir un lugar. Incluir migración no destructiva, DTOs nullables, consulta/descarga y atribución de métricas ratificados; planilla ordinaria sigue exigiendo lugar. Probar ambos casos.

## Dependencias y contratos

- Coordinar URLs con Admin/Mobile por archivos: `API_PUBLIC_URL` debe abrirse desde Android; `ADMIN_FRONTEND_URL` debe coincidir con Origin usado y generar enlaces alcanzables. Mantener cookie Secure/HttpOnly/SameSite=Lax y CSRF: no usar CORS abierto ni cookie insegura como atajo. Si HTTP localhost no funciona en el navegador elegido, resolver HTTPS local.
- `GET /auth/web/csrf` antes de login/2FA/refresh/logout. Login real ADMIN devuelve `twoFactorRequired,challengeId`, no `expiresAt,message`; son los consumidores los que deben dejar de exigir campos mock.
- Descargas oficiales `/timesheets/:id/file` y `/documents/:id/file`; multipart con bytes y límites contractuales. No agregar aliases `/download` solo para ocultar la incompatibilidad del cliente.
- G-01 sigue abierto: filtros/DTOs/validaciones de documentos de propuesta Admin, reintentos multipart ambiguos y otras decisiones señaladas en contrato. Documentar evidencia y proponer cambios al orchestrator; código existente no ratifica esos pendientes. Entorno/auth pueden avanzar sin resolver todos los filtros.
- B-01 habilita A-01/M-01 y archivos; B-02 habilita A-03/M-03; B-03 habilita escenarios compartidos. No condicionar todo el backend a que ambos frontends estén terminados.

Crear features/specs y gestionar implementer/reviewer solo dentro de este repo. No editar SYNCED ni otros repos. Ninguna mutación Git sin confirmación. Al cerrar, consolidar docs y eliminar este inbox cuando todos sus pendientes estén cubiertos.

Definiciones ratificadas para la integración: todos los enlaces de contadores abren vista global sin provincia automática; franco significa jornada libre sin obligación de trabajar, sin equivalencia automática con vacaciones/licencia/incumplimiento. Alinear representación de franco sin asumir efectos nuevos en métricas.

Secuencia ya definida en la spec Admin: empleado–lugar–mes–año; reemplazo conserva número/identidad. Documentos ya permiten cambiar tipo y nombre visible. No reabrir esas capacidades; quedan validaciones precisas y la semántica de reintento cuando se pierde la respuesta, aún sin ratificar.
