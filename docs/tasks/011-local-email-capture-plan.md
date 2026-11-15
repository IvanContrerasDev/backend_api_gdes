# F-011 Local Email Capture Implementation Plan

> **Para el harness local:** implementar esta feature en una sesión del implementer-backend, documentar en `progress/implementer/current.md`, y pedir revisión independiente al terminar. No hacer commits ni mutaciones Git.

**Objetivo:** completar registro, verificación de email y login desde Android con mensajes capturados localmente y enlaces reales alcanzables por LAN.

**Arquitectura:** Mailpit conserva mensajes en SQLite sobre un volumen local. El provider backend usa Node 24 `fetch` nativo para publicar mensajes JSON al endpoint HTTP `/api/v1/send` por la red interna de Compose, con credenciales dedicadas al Send API y sin requerir instalar un cliente SMTP. La UI se expone en la interfaz LAN configurable con autenticación separada; el endpoint de envío no se publica al host. La API genera URLs desde `API_PUBLIC_URL` LAN y no muestra bearer links en logs. El backend selecciona el provider local solo en development/test; los workers conservan fencing/TTL y separan namespaces locales de cualquier provider/destino anterior.

**Stack:** NestJS/TypeScript, `EmailProvider`, Node global `fetch` (sin dependencia npm de transporte), Docker Compose, Mailpit v1.32.0 (o release estable posterior verificada al implementar, pin de digest), PostgreSQL/Prisma.

**Spec:** `docs/tasks/011-local-email-capture.md`.

## Restricciones globales

- El provider local no puede transmitir correo fuera de Compose ni configurarse en production.
- `API_PUBLIC_URL` para el runtime actual es `http://192.168.100.59:3000`; actualizar solo con IP LAN confirmada si cambia y recrear API.
- Hoy el contenedor aún usa `http://localhost:3000`; cuando el provider/mailbox esté listo, actualizar la configuración documentada y recrear solo `gdes-api`, preservando DB.
- El buzón contiene enlaces bearer: exponer la UI solo por interfaz configurada y con autenticación; no publicar el endpoint HTTP de envío en el host ni imprimir correo/link/token/body en logs.
- Persistir Mailpit en volumen local; reiniciar sin borrar el volumen conserva capturas.
- Mantener idempotencia/outbox/TTL/fencing y `acceptedAt` únicamente tras respuesta exitosa del endpoint local; separar destinos/namespace en auth y solicitudes.
- No enviar correo real, no tocar DB manual y no hacer Git.

## Foco de revisión

1. Apertura desde Android con URL LAN incorrecta o cambiada: fallo visible sin usar `localhost` ni `Host`/`Forwarded`.
2. UI de buzón sin autenticación o endpoint de envío expuesto: build/runtime no debe abrir estas superficies por defecto.
3. Capturador detenido o timeout: intención/outbox no se marca aceptada y se respeta el límite de reintentos.
4. Cambiar provider o destino manteniendo mensajes pendientes: workers no cruzan captura local y Resend ni alteran contenido/idempotency key.
5. Selector `mailpit` en production: debe fallar al boot; producción sigue restringida a proveedores reales.

## Tareas

### Tarea 1: servicio Mailpit persistente y red local controlada

**Archivos:** `docker-compose.yml`, `.env.example`, `README.md`, posiblemente script de creación de archivo de autenticación (no guardar contraseñas reales).

- [ ] Añadir Mailpit con versión estable/digest verificados en fuentes oficiales y persistencia SQLite en volumen Compose.
- [ ] No publicar SMTP ni el puerto HTTP de Mailpit al host; el servicio solo integra por red Docker.
- [ ] Configurar autenticación Send API dedicada y separada de las credenciales de UI; no usar `accept-any`.
- [ ] Publicar la UI únicamente en el bind address configurable y añadir autenticación; documentar cómo usar IP LAN actual desde Android, sin imprimir credenciales.
- [ ] Verificar `docker compose config` con placeholders y documentar detención/reinicio sin `down -v`.

Referencias oficiales: [Docker](https://mailpit.axllent.org/docs/install/docker/), [HTTP API v1](https://mailpit.axllent.org/docs/api-v1/), [envío por HTTP y auth dedicada](https://mailpit.axllent.org/docs/usage/sending-messages/), [UI auth](https://mailpit.axllent.org/docs/configuration/http/), [persistencia SQLite](https://mailpit.axllent.org/docs/configuration/email-storage/), [releases](https://github.com/axllent/mailpit/releases). Mailpit documenta envío HTTP JSON para clientes sin SMTP nativo y permite credenciales separadas para `/api/v1/send`; Node 24 incluye `fetch` global. Esta variante evita depender de una instalación npm bloqueada y conserva aceptación explícita del capturador.

### Tarea 2: provider HTTP local y selector seguro

**Archivos:** `src/modules/notifications/notifications.service.ts`, `notifications.module.ts`, `src/config/env.validation.ts`, tests de providers.

- [ ] Implementar `MailpitEmailProvider implements EmailProvider`; `sendEmail(input: EmailInput): Promise<void>` debe aceptar subject/HTML completos mediante `POST /api/v1/send` y resolver solo con respuesta exitosa de Mailpit.
- [ ] Configurar `EMAIL_PROVIDER=mailpit` y URL/credenciales de Send API por env, solo `development|test`; validar destino interno y rechazar producción.
- [ ] Preservar selección y comportamiento actuales de `resend`/`log`; `WhatsAppProvider` sigue independiente.
- [ ] Añadir pruebas unitarias con fetch mock de aceptación, payload con destinatario/HTML/link, fallo HTTP/timeout, configuración inválida y rechazo en production; nunca hacer red externa.

### Tarea 3: aislar outboxes por provider/destino y validar flujos

**Archivos:** `src/modules/auth/auth-links.service.ts`, `src/modules/auth/admin-access-notifications.service.ts`, tests de auth avanzada/admin access/outbox.

- [ ] Incluir el identificador de provider y destino local efectivo en el hash de namespace de `AuthEmailIntent` y `AdminAccessNotification`, para que los workers no procesen intenciones dirigidas a otro transporte.
- [ ] Mantener mensajes/body/key estables para los reintentos del mismo evento; no cambiar límites actuales de TTL, attempts o fencing.
- [ ] Probar verificación de email, recuperación, 2FA y solicitudes administrativas con capturas locales del provider; verificar restart del servicio y caída/restauración del capturador cuando el runtime Compose esté disponible.
- [ ] Confirmar que los logs redaccionan el destinatario y excluyen HTML, enlaces y tokens; no hay llamadas a Resend.

### Tarea 4: flujo Android y documentación operativa

**Archivos:** `README.md`, `docs/06-integraciones.md`, `docs/04-auth-y-seguridad.md` solo si cambia la decisión vigente, `test/README.md`, tests de Compose si existen.

- [ ] Documentar los comandos para setear `API_PUBLIC_URL=http://192.168.100.59:3000` y la bind IP LAN de la UI con acceso autenticado; recrear únicamente API/capturador donde aplique.
- [ ] Orchestrator verifica el runtime `gdes-api` usa el `API_PUBLIC_URL` LAN actual y recrea solo API una vez preparada la configuración, sin tocar/resetear PostgreSQL.
- [ ] Documentar cómo abrir el mensaje desde Android, tocar el enlace y volver al deep link `gdes://email-verified?...` de Expo Go.
- [ ] Documentar límites de seguridad/control de acceso y purga local de mensajes; no poner tokens/credenciales de ejemplo reales.
- [ ] Correr build/lint y regresiones pertinentes sobre una DB dedicada; el reviewer independiente verifica cada criterio y confirma que no hubo envíos externos.

## Handoff

El implementer reporta solo `{task_spec, progress_file, status}`. Si necesita decisión no inferible de contrato/spec, deja pregunta en `progress/implementer/current.md` y devuelve `blocked`; leader no implementa código.
