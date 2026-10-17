# 06 — Integraciones externas

**Estado:** interfaces EmailProvider/WhatsAppProvider, adapters log y adaptadores reales Resend/Meta implementados; estos últimos aprobados por revisión independiente. No se enviaron mensajes reales. Storage R2 implementado y aprobado por revisión independiente; Google aún no implementado. Producción rechaza log; usar adaptadores reales exige provisionar servicios y configuración.

Todas detrás de interfaces para poder mockear en dev/test. Config por variables de entorno (ver `01-arquitectura-y-stack.md`).

## 1. Resend (email) — `EmailProvider`

Interfaz: `sendEmail({ to, subject, html, idempotencyKey? })`. EMAIL_PROVIDER=log|resend. Log solo dev/test, redacta destinatario y muestra exclusivamente OTP de acceso deliberados. Resend usa POST /emails por HTTPS con Bearer, remitente EMAIL_FROM y transporte fetch por DI; timeout10s cubre headers y body, respuesta máxima16KiB y redirecciones rechazadas. Hasta3 intentos ante429/5xx/red, backoff250/500ms+jitter y misma Idempotency-Key/cuerpo. Una clave de negocio opcional identifica reintentos del mismo envío entre llamadas; si se omite, UUID por llamada. Respuesta con id significa aceptación del proveedor, no entrega al destinatario.

Emails del sistema (spec §9.2/§9.3/§10.2):

| # | Email | Disparo | Destinatario |
|---|---|---|---|
| 1 | Código 2FA | Login admin (cada login) | Admin |
| 2 | Recuperación de contraseña | `POST /auth/password-recovery` | Empleado o admin |
| 3 | Confirmación de solicitud recibida | Verificación del challenge admin | Solicitante |
| 4 | Solicitud de aprobación con links firmados aprobar/rechazar | Verificación del challenge admin | SuperAdmin |
| 5 | Resultado (aprobado → rol ADMIN / rechazado → rol EMPLOYEE) | Decisión del SuperAdmin | Solicitante |
| 6 | Verificación de email (magic link con botón "confirmar") | Registro mobile tras verificar OTP, y reenvíos (`/auth/email-verification/resend`) | Empleado |

## 2. Meta WhatsApp Cloud API — `WhatsAppProvider`

Interfaz: `sendOtp({ phone, code })`. WHATSAPP_PROVIDER=log|meta, independiente del selector email; modo mixto dev/test permitido. Meta usa endpoint HTTPS fijo Graph de versión explícita y plantilla AUTHENTICATION con body y botón copy-code URL index0 (mismo OTP). Un solo intento: timeout/fallo puede representar envío aceptado; sin idempotencia Meta no se promete exactly-once ni se repite automáticamente. El usuario puede pedir reenvío con cooldown existente. Éxito exige messages[0].id; aceptación no certifica entrega.

- Uso: OTP de 6 dígitos en registro de empleado, login con email/legajo + password y login Google (mobile).
- Requiere app de Meta, número verificado y **plantilla de mensaje** aprobada (los mensajes iniciados por el negocio exigen plantilla). Gestionar alta de la plantilla es tarea operativa previa al deploy.
- Config: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` numérico, `WHATSAPP_API_VERSION` (vN.N explícita vigente al provisionar), `WHATSAPP_OTP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANGUAGE` (ej.es_AR según plantilla aprobada). No asumir que el nombre/idioma de ejemplo ya existe en Meta.

## 3. Cloudflare R2 (storage de archivos) — `StorageService`

Proveedor elegido por el humano (2026-09-15): **Cloudflare R2**. Racional de elección: API S3-compatible y costo/egress esperado al decidir; tarifas y límites se verifican antes del deploy, sin prometer condiciones permanentes — se usa con el SDK estándar de AWS S3 apuntando al endpoint de R2, así que migrar a otro proveedor S3-compatible es solo cambiar variables de entorno.

Interfaz actual: `upload({key,path,size,contentType})`, `delete(key)`, `getSignedDownloadUrl(key)`→`{downloadUrl,expiresAt}`. R2StorageService usa AWS SDK v3 y presigner, claves únicas por versión, firma900s; namespace de destino derivado de endpoint+bucket. Timeout upload30s/delete10s y error503 STORAGE_UNAVAILABLE sin contenido upstream. No hay adaptador no-op exitoso ni flags fake de producción; pruebas usan servidor S3 compatible simulado.

- Config: `STORAGE_ENDPOINT` (endpoint S3 de la cuenta R2), `STORAGE_BUCKET`, `STORAGE_REGION=auto`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`.
- **Uploads proxificados por el backend** (MVP): el cliente sube `multipart/form-data` al endpoint; el backend valida (extensión + magic bytes, 20 MiB máx., diez archivos por lote atómico con rollback de DB/bucket) y persiste en el bucket. No se exponen URLs firmadas de subida en el MVP — centraliza validación y antivirus futuro.
- **Descargas con URL firmada** (15 min): `GET /timesheets/{id}/file` y `GET /documents/{id}/file` devuelven `{ data: { downloadUrl, expiresAt } }`.
- Claves incluyen empleado/recurso y UUID nuevo de versión antes del nombre validado; nunca sobrescribir clave anterior. Reemplazo conserva identidad DB pero genera key nueva. No usar ruta/nombre del cliente como temporal de filesystem.
- Reemplazo de planilla: validar/subir key nueva, publicar metadata PENDING con CAS y programar borrado anterior solo tras commit. Eliminación de documento elimina metadata y programa borrado físico. Journal StorageCleanupJob se crea ANTES de PUT, con namespace endpoint+bucket/lease; publica y cleanup coordinan locks. Worker comprueba referencias actuales y jamás borra key vigente; lease se valida con reloj fresco tras lock. DELETE/PUT/commit ambiguos y fallos de compensación se recuperan desde DB tras reinicio con backoff hasta1h. Consistencia física eventual ante fallo, sin prometer atomicidad distribuida perfecta.
- Worker interno necesita proceso Node activo; al reiniciar retoma jobs. Cambiar bucket/endpoint no migra objetos ni su journal: workers no consumen jobs de otro destino. Debe planearse una migración de storage antes de cambiar esa configuración con archivos existentes.
- Endpoint exige HTTPS en producción y no admite credentials/query/hash; HTTP solo loopback no productivo para pruebas. .env.example contiene placeholder válido, reemplazarlo antes de operar archivos. Capacidad de proxy/hosting para lotes de hasta200MiB pendiente de validar al desplegar. Ningún archivo se subió a R2 real durante desarrollo.

## 4. Google OAuth

- Mobile usa Authorization Code + PKCE (`expo-auth-session`) contra los endpoints de Google.
- El backend solo **verifica el `id_token`** (librería `google-auth-library`): signature, expiración y `aud === GOOGLE_CLIENT_ID`. No hay flujo server-side propio ni refresh tokens de Google.
- Config: `GOOGLE_CLIENT_ID`.

## Resumen de dependencias externas a provisionar antes del deploy

1. Cuenta Resend + dominio verificado (`EMAIL_FROM`).
2. App de Meta + número de WhatsApp Business + plantilla OTP aprobada.
3. Cuenta Cloudflare + bucket R2 + API token con permisos de lectura/escritura acotados al bucket.
4. `GOOGLE_CLIENT_ID` (Google Cloud Console, OAuth client para la app Expo).

## Fallos y validación de notificaciones

503 NOTIFICATION_UNAVAILABLE con mensaje español y retryable=true; nunca incluir cuerpo upstream, tokens, destinatarios ni credenciales en errores/logs. Selectores desconocidos/config real incompleta fallan al boot; producción rechaza cualquier log y exige ADMIN_FRONTEND_URL HTTPS. No hay llamadas de red al iniciar. Las pruebas usan transporte HTTP fake/loopback, sin envío a terceros. Fuentes del adaptador: [Resend Send Email](https://resend.com/docs/api-reference/emails/send-email), [idempotencia](https://resend.com/docs/dashboard/emails/idempotency-keys), [colección oficial Meta](https://www.postman.com/meta/whatsapp-business-platform/overview). No se certificó dominio, número/plantilla, entrega real ni despliegue.

Verificación actual de adaptadores: build/lint y105/105 pruebas completas, incluidas8 de providers, por implementer y reviewer independientes. Transporte HTTP simulado/loopback; producción operativa y entrega real permanecen por validar con servicios provisionados.

Verificación de archivos: suite conjunta135/135 (archivos30), build/lint/Prisma, nueve migraciones+seed desde DBvacía, imagen gdes-f007-review:local(74d8a89595c1) y smoke repetido por reviewer. SDK real carga/descarga firma900s/bytes/borrado204 frente a S3simulado, catálogo público200/guards401. Sin cuentas R2 reales ni modificaciones a base/volúmenes del usuario.
