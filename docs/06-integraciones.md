# 06 — Integraciones externas

Todas detrás de interfaces para poder mockear en dev/test. Config por variables de entorno (ver `01-arquitectura-y-stack.md`).

## 1. Resend (email) — `EmailProvider`

Interfaz: `sendEmail({ to, subject, html })`. En dev: implementación `log` que escribe en consola (config `EMAIL_PROVIDER=log`).

Emails del sistema (spec §9.2/§9.3/§10.2):

| # | Email | Disparo | Destinatario |
|---|---|---|---|
| 1 | Código 2FA | Login admin (cada login) | Admin |
| 2 | Recuperación de contraseña | `POST /auth/password-recovery` | Empleado o admin |
| 3 | Confirmación de solicitud recibida | `POST /auth/admin-access-request` | Solicitante |
| 4 | Solicitud de aprobación con links firmados aprobar/rechazar | `POST /auth/admin-access-request` | SuperAdmin |
| 5 | Resultado (aprobado → rol ADMIN / rechazado → rol EMPLOYEE) | Decisión del SuperAdmin | Solicitante |
| 6 | Verificación de email (magic link con botón "confirmar") | Registro mobile tras verificar OTP, y reenvíos (`/auth/email-verification/resend`) | Empleado |

## 2. Meta WhatsApp Cloud API — `WhatsAppProvider`

Interfaz: `sendOtp({ phone, code })`. En dev: implementación `log` (config `WHATSAPP_PROVIDER=log`).

- Uso: OTP de 6 dígitos en registro de empleado, login con email/legajo + password y login Google (mobile).
- Requiere app de Meta, número verificado y **plantilla de mensaje** aprobada (los mensajes iniciados por el negocio exigen plantilla). Gestionar alta de la plantilla es tarea operativa previa al deploy.
- Config: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`.

## 3. Cloudflare R2 (storage de archivos) — `StorageService`

Proveedor elegido por el humano (2026-09-15): **Cloudflare R2**. Motivos: egress (descargas) gratis siempre, free tier permanente de 10 GB, gestión trivial y **API 100% S3-compatible** — se usa con el SDK estándar de AWS S3 apuntando al endpoint de R2, así que migrar a otro proveedor S3-compatible es solo cambiar variables de entorno.

Interfaz: `upload({ key, body, contentType })`, `delete({ key })`, `getSignedDownloadUrl({ key, expiresIn })`.

- Config: `STORAGE_ENDPOINT` (endpoint S3 de la cuenta R2), `STORAGE_BUCKET`, `STORAGE_REGION=auto`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`.
- **Uploads proxificados por el backend** (MVP): el cliente sube `multipart/form-data` al endpoint; el backend valida (extensión + magic bytes, 20 MB máx.) y persiste en el bucket. No se exponen URLs firmadas de subida en el MVP — centraliza validación y antivirus futuro.
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
