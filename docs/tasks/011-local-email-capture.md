# F-011 — Captura local de correo para probar flujos de autenticación

**Estado:** in_progress
**App(s):** backend
**Creada:** 2026-11-08

Artefacto temporal: al cerrar, consolidar decisión vigente y motivo en docs oficiales, actualizar referencias y eliminar spec/plan.

## Contexto

El registro mobile crea el usuario sin sesión y envía un enlace de verificación, pero el provider log vigente oculta el enlace completo. Como el login mobile rechaza cuentas sin email verificado, no se puede completar el flujo registrar → verificar → iniciar sesión en el entorno local. La URL de API actual de runtime apunta a `http://localhost:3000`, que en Android refiere al propio teléfono y no al host de desarrollo.

## Alcance

**Incluye:**
- Provider `EmailProvider` local, solo dev/test, que captura el mensaje completo (incluidos enlaces reales) en un buzón local persistente sin enviar a proveedores externos.
- El transporte local aprobado para este entorno es Mailpit HTTP `POST /api/v1/send`, llamado con Node 24 `fetch` nativo y credenciales dedicadas al Send API; el endpoint queda solo en red interna de Compose. La UI usa autenticación independiente.
- Una forma controlada de consultar el buzón y abrir desde Android el enlace real de verificación. El runtime actual `gdes-api` debe cambiar de `API_PUBLIC_URL=http://localhost:3000` a `http://192.168.100.59:3000` (o la IP LAN confirmada al operar) y recrearse solo cuando la configuración de B-02 esté lista, sin reiniciar ni alterar PostgreSQL.
- Rechazo del selector local/log en producción y errores/configuración que no filtren bearer links, contenido HTML, destinatarios ni secretos a logs generales.
- Aislar namespace/destino local de outbox auth y solicitudes administrativas; conservar TTL, idempotencia, fencing, claves estables y `acceptedAt` únicamente tras aceptación del capturador.
- Pruebas de verificación de email, recuperación y correos de solicitudes administrativas con contenido/link capturado, reinicio del buzón y capturador no disponible; ningún envío externo.

**NO incluye:**
- Envíos a Resend/otros proveedores, llamadas de prueba a terceros o cambiar configuración productiva.
- Cambios en mobile/Admin ni bypass del estado de email verificado, OTP, sesión o protecciones existentes.
- Ejecutar pruebas/migraciones sobre la DB manual del usuario o exponer enlaces bearer en logs generales.

## Referencias (fuente de verdad)

- Docs: `docs/06-integraciones.md`, `docs/04-auth-y-seguridad.md`, `docs/03-contratos-api.md`, `docs/arquitectura/contratos-api.md`, `README.md`, `test/README.md`, `progress/leader/integracion-local-entorno.md`.
- Inbox: `progress/leader/inbox/20261102-integracion-local.md` (B-02, decisión humana autorizada el 2026-11-04).
- Inbox de runtime LAN: `progress/leader/inbox/20261109-api-public-url-lan.md` (el contenedor actual sigue usando localhost aunque API/Metro son accesibles por LAN).
- Código: `src/modules/notifications/`, `src/modules/auth/auth-links.service.ts`, `src/modules/auth/auth.service.ts`, `src/modules/auth/admin-access-notifications.service.ts`, `src/modules/auth/admin-access.service.ts`, `src/config/env.validation.ts`, `docker-compose.yml`, tests auth/providers/outbox.
- Backlog: F-011/B-02 en `feature_list.json`.

## Criterios de aceptación

- [ ] En dev/test, el provider local acepta correos completos y permite leerlos desde un buzón persistente controlado en el host; el flujo permite abrir en Android el enlace real de verificación y completar el deep link al volver a la app.
- [ ] El `gdes-api` runtime termina configurado con `API_PUBLIC_URL=http://192.168.100.59:3000` (o la IP LAN vigente confirmada), y el enlace recibido desde Android abre la API; nunca se incluye `/api/v1` ni se deriva de `Host`/`Forwarded`.
- [ ] El modo local no envía mensajes fuera del entorno, y proveedor/outbox local es rechazado en producción; los providers reales mantienen sus reglas actuales.
- [ ] La captura conserva idempotencia, outbox/TTL/fencing y aceptación real; reinicio del stack no pierde mensajes capturados, y fallo/indisponibilidad del capturador no marca mensajes como aceptados.
- [ ] Emails de verificación, recuperación, 2FA y solicitudes administrativas usan destino/namespace aislado local según corresponda; se pueden inspeccionar enlaces necesarios sin escribir bearer links/cuerpos/tokens en logs generales.
- [ ] Regresiones de auth/providers/outbox, build y lint pasan; reviewer independiente aprueba los criterios. Las pruebas no contactan servicios externos ni usan la DB manual.

## Notas de implementación

- Plan de implementación vigente: `docs/tasks/011-local-email-capture-plan.md`.
- Mailpit documenta el envío HTTP JSON como alternativa SMTP y autenticación dedicada para Send API; se elige para evitar instalar dependencias desde un registry no accesible en el entorno. Referencias oficiales: `https://mailpit.axllent.org/docs/api-v1/`, `https://mailpit.axllent.org/docs/usage/sending-messages/`, `https://mailpit.axllent.org/docs/configuration/http/`.
- F-012/B-03 cerró con aprobación independiente y suite aislada 199/199 el 2026-11-09; F-011 puede avanzar por el flujo local.
- Alinear la elección de buzón/transportes y exposición LAN con el guardrail de privacidad de links bearer: que la lectura sea posible desde Android no autoriza un buzón abierto a toda la red; documentar controles de acceso y mantener los datos capturados en almacenamiento local persistente.
- El destino de verificación se deriva de `API_PUBLIC_URL` y luego redirige por `MOBILE_DEEP_LINK_SCHEME`; conservar el endpoint/contrato existente.
- Al operar el runtime manual: revisar `.env` sin imprimir secretos, cambiar solo `API_PUBLIC_URL` al origen LAN confirmado y recrear API (`docker compose up -d --force-recreate api`). No ejecutar sobre entornos productivos.
- El cambio operativo solo recrea el contenedor `api`; preservar el contenedor, volumen y datos de PostgreSQL. Verificar `/health` y solo el valor no secreto `API_PUBLIC_URL` en el contenedor; no mostrar otras variables de entorno.

## Registro de implementación

Correcciones de reviewer implementadas: validación Mailpit independiente de Resend y validación de `EMAIL_FROM`; pruebas de configuración inválida, selección/rechazo en producción y timeout/indisponibilidad redacted; regresión auth verifica intención incompleta ante fallo; regresión admin verifica `acceptedAt`/`completedAt` ausentes y retry tras fallo. `docs/README.md` y `test/README.md` distinguen captura local implementada del smoke runtime LAN pendiente. Reverificación posterior al veredicto: fuente y `dist/config/env.validation.js` condicionan `RESEND_API_KEY` solo a `resend`; secuencia fresca `npm run build` → `node test/notification-providers.e2e.cjs` pasó 13/13 y `npm run lint` pasó. El 12/13 reportado no se reprodujo con los artefactos recién compilados y no requirió otro cambio de código. No hay `TEST_DATABASE_URL` ni contenedor de test disponible, y Docker engine no está disponible, por lo que las suites HTTP/PostgreSQL de auth/admin no se ejecutaron; no se usó DB manual. No se ejecutó Docker runtime. Falta smoke con Mailpit/API/DB del entorno y confirmar el cambio operativo a `API_PUBLIC_URL` LAN recreando solo `gdes-api`; preservar PostgreSQL. Requiere review independiente antes de cierre.

## Review

### Veredicto vigente
- Veredicto: aprobados los dos ítems previos de correcciones (0 ítems pendientes en esta revisión).
- Evidencia ejecutada por reviewer en esta ronda, después de compilar: `npm run build` PASS; `node test/notification-providers.e2e.cjs` 13/13 PASS; `npm run lint` PASS. El validador actual limita `RESEND_API_KEY` a `EMAIL_PROVIDER=resend`. No se usó DB ni se hicieron solicitudes a servicios externos.
- Ítems:
  1. Resuelto: cobertura de configuración Mailpit, independencia de Resend, selector y bloqueo en producción, timeout/indisponibilidad con errores redactados. Se revisó el código de regresión auth/admin para dejar intents incompletas ante fallo y permitir retry; no se ejecutaron sus suites HTTP/PostgreSQL en esta ronda porque no hay `TEST_DATABASE_URL`, por tanto no se reportan como pasadas.
  2. Resuelto: `test/README.md` y `docs/README.md` describen la captura local Mailpit implementada y mantienen separado el smoke integrado LAN pendiente.
- Pendiente de cierre F-011, separado de estos dos ítems aprobados: no se probó Docker/Mailpit/API en runtime ni se confirmó `API_PUBLIC_URL` LAN; tampoco se pudieron correr suites auth/admin con PostgreSQL. El orchestrator debe registrar el valor LAN vigente y recrear solo `gdes-api`, preservando PostgreSQL; no afirmar el flujo Android/Admin integrado hasta entonces.
