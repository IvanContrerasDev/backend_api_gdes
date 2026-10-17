# 06 — Integraciones externas

**Estado:** interfaces EmailProvider/WhatsAppProvider, adapters log y adaptadores reales Resend/Meta implementados; estos últimos aprobados por revisión independiente. No se enviaron mensajes reales. Storage/Google aún no implementados. Producción rechaza log; usar adaptadores reales exige provisionar servicios y configuración.

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

Interfaz: `upload({ key, body, contentType })`, `delete({ key })`, `getSignedDownloadUrl({ key, expiresIn })`.

- Config: `STORAGE_ENDPOINT` (endpoint S3 de la cuenta R2), `STORAGE_BUCKET`, `STORAGE_REGION=auto`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`.
- **Uploads proxificados por el backend** (MVP): el cliente sube `multipart/form-data` al endpoint; el backend valida (extensión + magic bytes, 20 MiB máx., diez archivos por lote atómico con rollback de DB/bucket) y persiste en el bucket. No se exponen URLs firmadas de subida en el MVP — centraliza validación y antivirus futuro.
- **Descargas con URL firmada** (15 min): `GET /timesheets/{id}/file` y `GET /documents/{id}/file` devuelven `{ data: { downloadUrl } }`.
- Layout de claves: `timesheets/{employeeId}/{year}-{month}/{timesheetId}/{fileName}` y `documents/{employeeId}/{documentId}/{fileName}`.
- Reemplazo de planilla: subir nueva clave y **borrar la anterior del bucket** (spec §39.5). Eliminación de documento: borrar clave (§40.5).

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
