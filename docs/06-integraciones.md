# 06 — Integraciones externas

**Estado:** interfaces EmailProvider/WhatsAppProvider, adapters log y adaptadores reales Resend/Meta implementados; estos últimos aprobados por revisión independiente. No se enviaron mensajes reales. Storage R2 implementado y aprobado por revisión independiente; Google implementado y aprobado. Producción rechaza log; usar adaptadores reales exige provisionar servicios y configuración.

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

Interfaz actual: `upload({key,path,size,contentType})`, `delete(key)`, `getSignedDownloadUrl(key)`→`{downloadUrl,expiresAt}`. R2StorageService usa AWS SDK v3 y presigner, claves únicas por versión, firma900s; namespace de destino derivado de endpoint+bucket. Timeout upload30s/delete10s y error503 STORAGE_UNAVAILABLE sin contenido upstream. No hay adaptador no-op exitoso ni flags fake de producción; pruebas de regresión usan servidor S3 compatible simulado y el smoke local opt-in usa SeaweedFS real.

- Config: `STORAGE_ENDPOINT` (endpoint interno para PUT/DELETE y namespace), `STORAGE_PUBLIC_ENDPOINT` opcional (default interno; cliente separado firma con host final alcanzable sin reescribir URL), `STORAGE_ALLOW_INSECURE_HTTP` (string true/false, default false), `STORAGE_BUCKET`, `STORAGE_REGION=auto`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`.
- **Uploads proxificados por el backend** (MVP): el cliente sube `multipart/form-data` al endpoint; el backend valida (extensión + magic bytes, 20 MiB máx., diez archivos por lote atómico con rollback de DB/bucket) y persiste en el bucket. No se exponen URLs firmadas de subida en el MVP — centraliza validación y antivirus futuro.
- **Descargas con URL firmada** (15 min): `GET /timesheets/{id}/file` y `GET /documents/{id}/file` devuelven `{ data: { downloadUrl, expiresAt } }`.
- Claves incluyen empleado/recurso y UUID nuevo de versión antes del nombre validado; nunca sobrescribir clave anterior. Reemplazo conserva identidad DB pero genera key nueva. No usar ruta/nombre del cliente como temporal de filesystem.
- Reemplazo de planilla: validar/subir key nueva, publicar metadata PENDING con CAS y programar borrado anterior solo tras commit. Eliminación de documento elimina metadata y programa borrado físico. Journal StorageCleanupJob se crea ANTES de PUT, con namespace endpoint+bucket/lease; publica y cleanup coordinan locks. Worker comprueba referencias actuales y jamás borra key vigente; lease se valida con reloj fresco tras lock. DELETE/PUT/commit ambiguos y fallos de compensación se recuperan desde DB tras reinicio con backoff hasta1h. Consistencia física eventual ante fallo, sin prometer atomicidad distribuida perfecta.
- Worker interno necesita proceso Node activo; al reiniciar retoma jobs. Cambiar bucket/endpoint no migra objetos ni su journal: workers no consumen jobs de otro destino. Debe planearse una migración de storage antes de cambiar esa configuración con archivos existentes.
- Ambos endpoints exigen HTTP(S), sin credentials/query/hash. Producción exige HTTPS y rechaza el flag HTTP habilitado; HTTP Docker/LAN solo se permite con STORAGE_ALLOW_INSECURE_HTTP=true en NODE_ENV=development/test. Se conserva HTTP loopback no productivo sin flag. Validación compartida entre boot y construcción directa del adaptador. Cambiar solo endpoint público conserva namespace/jobs; cambiar endpoint interno/bucket requiere migración de archivos. .env.example contiene placeholder válido, reemplazarlo antes de operar archivos. Capacidad de proxy/hosting para lotes de hasta200MiB pendiente de validar al desplegar. Ningún archivo se subió a R2 real durante desarrollo.

## 4. Google OAuth

- Mobile usa Authorization Code + PKCE (`expo-auth-session`) contra los endpoints de Google.
- El backend solo **verifica el `id_token`** (librería `google-auth-library`): signature, issuer, expiración estricta, email_verified=true y aud string exactamente GOOGLE_CLIENT_ID. No hay flujo server-side propio ni refresh tokens de Google.
- Config: `GOOGLE_CLIENT_ID`.

## Resumen de dependencias externas a provisionar antes del deploy

1. Cuenta Resend + dominio verificado (`EMAIL_FROM`).
2. App de Meta + número de WhatsApp Business + plantilla OTP aprobada.
3. Cuenta Cloudflare + bucket R2 + API token con permisos de lectura/escritura acotados al bucket.
4. `GOOGLE_CLIENT_ID` (Google Cloud Console, OAuth client para la app Expo).
5. Antes de habilitar solicitudes administrativas, provisionar al menos un SUPER_ADMIN ACTIVE con email operativo. Los destinatarios de decisión se seleccionan al crear la intención; no se crea un superadmin ni una contraseña universal automáticamente.

## Fallos y validación de notificaciones

503 NOTIFICATION_UNAVAILABLE con mensaje español y retryable=true; nunca incluir cuerpo upstream, tokens, destinatarios ni credenciales en errores/logs. Selectores desconocidos/config real incompleta fallan al boot; producción rechaza cualquier log y exige ADMIN_FRONTEND_URL HTTPS. No hay llamadas de red al iniciar. Las pruebas usan transporte HTTP fake/loopback, sin envío a terceros. Fuentes del adaptador: [Resend Send Email](https://resend.com/docs/api-reference/emails/send-email), [idempotencia](https://resend.com/docs/dashboard/emails/idempotency-keys), [colección oficial Meta](https://www.postman.com/meta/whatsapp-business-platform/overview). No se certificó dominio, número/plantilla, entrega real ni despliegue.


Auth avanzado usa intención email durable cifrada, namespace/fencing y enlaces reconstruidos con key/cuerpo estables para reintentos; detalles operativos y rotación en04. Las respuestas neutras y registro202 no esperan al proveedor; un fallo diferido no revierte el usuario ni pierde la intención. Tres intentos máximos por intención dentro del TTL, sin garantía de entrega. No mezclar con OTP WhatsApp síncrono.

Solicitudes administrativas (implementadas y aprobadas): correos OTP inicial/reenvío por EmailProvider, y recepción/decisión/resultado por outboxDB transaccional. Links de frontend fijos con confirmaciónPOST, HTML escapado; snapshot estable de contenido y clave por generación/recipient, hasta3 intentos y TTLmáximo24h (respetando idempotenciaResend), no siete días de reenvíos automáticos. Persistir acceptedAt solo tras aceptación; no equivale a entrega. Sin correos reales durante pruebas. Detalles de cancelación/renovación/re-postulación y namespaces en04.

Modo log de desarrollo: muestra OTP únicamente para los asuntos conocidos de login2FA y verificación de solicitud administrativa, con destinatario redactado. No imprime HTML, enlaces de verificación/recuperación/decisión ni bearer tokens. Para probar manualmente esos enlaces hace falta configurar email real del entorno; las suites usan captura por DI y no relajan esta regla productiva.

## Storage local de integración (B-01)

SeaweedFS mononodo4.52, imagen `chrislusf/seaweedfs:4.52` con digest SHA256 fijado en compose. Fuentes oficiales verificadas: [release4.52](https://github.com/seaweedfs/seaweedfs/releases/tag/4.52), [licencia Apache-2.0 del tag](https://github.com/seaweedfs/seaweedfs/blob/4.52/LICENSE) y [flags mini del tag](https://github.com/seaweedfs/seaweedfs/blob/4.52/weed/command/mini.go). Se usa `mini -dir=/data` con IP storage, S3 puerto8333, volúmenes de128MiB/max4; telemetry/WebDAV/Iceberg/Lance deshabilitados y solo puerto S3 publicado. Las credenciales dev habilitan autenticación; `S3_BUCKET=gdes-dev` inicializa bucket privado idempotentemente. /data conserva también filerldb2, IAM y metadata, necesario al recrear contenedores. HeadBucket firmado antes de API comprueba bucket/credenciales, no solo puerto TCP.

`STORAGE_ENDPOINT=http://storage:8333`, público de referencia `http://localhost:8333`, región us-east-1 y opt-in HTTP local. Para teléfono sustituir público por IP LAN del PC antes de firmar; comandos, puertos y transporte en README.md. No modifica R2 productivo. Bucket/objeto anónimo y firma vencida deben rechazarse; prueba reproducible `test/runtime-local.smoke.cjs` y procedimiento en test/README.md. Admin por LAN sigue requiriendo validación HTTPS/cookies con su leader; pruebas HTTP no certifican navegador/Android.

Verificación vigente B-01: revisión independiente aprobada, build/lint/Prisma y 193/193 pruebas sin fallos ni omisiones; smoke real API/PostgreSQL/SeaweedFS PASS en proyecto aislado desde DB vacía. Bytes/firma900s, anónimo/vencido403, recreación con metadata/objetos persistentes y fallo503 sin reemplazar original verificados. No se modificaron DB/volúmenes previos ni se enviaron notificaciones externas. Procedimiento en test/README.md; navegador/Android y proveedores de producción pendientes.
