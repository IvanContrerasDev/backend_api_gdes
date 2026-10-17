# 04 — Autenticación y seguridad

**Estado:** auth base implementada y aprobada: login password con OTP mobile/2FA admin, sesiones y JWT, refresh/logout mobile y web, preauth/CSRF. Providers log de desarrollo/test; Resend/Meta implementados, log bloqueado en producción. Registro, magic link, recuperación y Google implementados y aprobados; solicitud admin implementada y aprobada. Adaptadores reales de notificación implementados/aprobados; requieren provisionamiento externo. Detalle HTTP en 03; base web ratificada localmente con propuesta común pendiente de sync.

## Tokens

- **Access token**: JWT, 30 minutos. Claims: `sub` (userId), `role`, `type: "access"`.
- **Refresh token**: opaco (no JWT), 7 días, **rotación en cada uso** (spec Parte 2): cada `POST /auth/refresh` emite uno nuevo e invalida el anterior.
- **Detección de reuso**: si se presenta un refresh token ya rotado/revocado, se revoca toda la cadena del usuario y se responde 401 `REFRESH_TOKEN_REUSED`.
- Mobile: cada refresh rotado vence siete días después de su emisión; la sesión acompaña ese vencimiento deslizante. Web: límite absoluto inicial de siete días, que ninguna rotación ni "recordar sesión" extiende.
- Secrets distintos para access y refresh (`JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`).
- Mobile migra el almacenamiento a SecureStore/Keychain (hoy no guarda token — cambio pendiente en su app).

## Contraseñas

- Hash con **Argon2**.
- Política aprobada P-06 compartida: 12–128 caracteres, admite espacios y Unicode, sin reglas obligatorias de mayúsculas/símbolos; backend rechaza comunes/comprometidas. La validación actual de mobile difiere y deberá migrar, sin trasladarla como contrato vigente.
- Empleado creado por admin: contraseña inicial seteada por el admin, habilitado inmediato, sin cambio obligatorio ni verificación de email — `emailVerifiedAt` se setea en el alta (spec §11.1).
- Comprobación local implementada: corpus SecLists10k versionado con commit/checksum/LICENCIA en resources/passwords. Compara NFKC, case, espacios y sufijos simples sin cambiar el secreto original para Argon2; 12–128 puntos de código Unicode. Sin HIBP ni llamadas de red. No cubre todas las filtraciones; mantener lista actualizada es una limitación operativa explícita.
- La contraseña nunca se puede revisualizar (§11.1).

## Flujos

### 1. Login empleado (mobile) — email o legajo + password + OTP WhatsApp
1. `POST /auth/login` con `identifier` (email normalizado `trim().toLowerCase()` **o** legajo) + `password`, `client=MOBILE`.
2. Solo rol `EMPLOYEE`; cuenta `ACTIVE` obligatoria (INACTIVE bloquea todo, spec §6).
3. Email sin verificar (`emailVerifiedAt = null`) → 403 `EMAIL_NOT_VERIFIED`, **sin enviar OTP** (la app muestra la pantalla "revisá tu correo" y vuelve al login; ver flujo 4).
4. Credenciales válidas + email verificado → 202 con `challengeId` y envío de OTP de 6 dígitos por WhatsApp al `phone` registrado.
5. `POST /auth/otp/verify` → `{ user, tokens }`.

### 2. Login admin (web) — password + 2FA por email
1. `POST /auth/login` con `client=ADMIN`. Roles `ADMIN`/`SUPER_ADMIN` → 202 con `challengeId` y envío de código de 6 dígitos por email.
2. `POST /auth/login/2fa/verify` con `challengeId` + `code` → access en JSON y refresh en cookie HttpOnly; sin refresh JSON web. Bootstrap/refresh/logout usan /auth/web/* (03).
3. Código: 10 min de validez, máx. 5 intentos, un solo uso.
4. `TO_BE_ADMIN` → 403 `ADMIN_ACCESS_PENDING` con el mensaje exacto de spec §10.3.

### 3. Login Google (mobile) — OAuth real + OTP WhatsApp
1. La app usa Authorization Code + PKCE (`expo-auth-session`) y obtiene un `id_token` de Google.
2. `POST /auth/google` con `idToken` + `phone`: el backend verifica el token contra Google (audience = `GOOGLE_CLIENT_ID`) y busca el usuario por email. Si el email no está verificado → 403 `EMAIL_NOT_VERIFIED` (mismo caso que el flujo 1: la app informa que revise su correo y vuelve al login).
3. Email verificado → envío de OTP de 6 dígitos por WhatsApp al teléfono registrado.
4. `POST /auth/otp/verify` → tokens.

### 4. Registro de empleado (mobile) — OTP WhatsApp + verificación de email
1. `POST /auth/register` con los 10 campos. Valida unicidad global de email, legajo y DNI (spec §7). **No crea el `User` aún**: el payload queda en el challenge OTP.
2. Envía OTP por WhatsApp.
3. `POST /auth/otp/verify` → se crea el `User` (`role=EMPLOYEE`, `accountStatus=ACTIVE`, `emailVerifiedAt=null`), se envía el **email de verificación** (magic link con botón "confirmar", token firmado de un solo uso, 24 h) y se responde 202 `{ emailVerificationRequired: true }` — **sin tokens**.
4. El usuario toca "confirmar" en el email → `GET /auth/email/verify?token=...` marca `emailVerifiedAt` y redirige al deep link de mobile (`MOBILE_DEEP_LINK_SCHEME`).
5. Recién con el email verificado puede completar un login (flujos 1 y 3). Si intenta loguearse antes → 403 `EMAIL_NOT_VERIFIED` y puede pedir reenvío con `POST /auth/email-verification/resend`.
6. OTP: 6 dígitos, 10 min, reenvío con cooldown de 60 s.

### 5. Recuperación de contraseña (ambas apps)
1. `POST /auth/password-recovery` → respuesta neutra siempre (no revela si el email existe).
2. Email con enlace que contiene token firmado (1 h, un solo uso).
3. `POST /auth/password-reset` con token + nueva contraseña (misma política).
4. Al resetear se revocan todas las sesiones (access y refresh) y los challenges anteriores mediante generación de credenciales.

### 6. Alta de administradores

Flujo completo y DTOs en 03 (Solicitud admin): diez campos, challenge email antes de crear cuenta/cambiar rol, contraseña actual para existentes y perfil conservado. OTP 10 min/5 intentos/cooldown 60 s, payload temporal 72 h. Tras verificar se crea solicitud PENDING y se envían correos; decisión de un solo uso 7 días, GET solo muestra UI y POST confirma. Cuenta que pasa a INACTIVE cancela solicitud. No fusionar identidades ni degradar administradores. Regla ratificada: vencidaPENDING puede renovar enlace7d con NUEVAOTP sin cambiarid; tras rechazo/cancelación puede crear solicitud nueva con otraOTP y contraseña actual, cuentaACTIVE/rol elegible e historial intacto. Replay de challenge antiguo no renueva ni postula otra vez.

### Seguridad web aprobada para desarrollo y pruebas

Base ratificada por el humano: refresh en `__Host-gdes-refresh`, Secure, HttpOnly, Path=/, sin Domain; frontend y API same-site con CORS de origen explícito. Access en memoria, refresh rotativo, rememberSession y límite absoluto inicial de siete días. Sin recordar: cookie de sesión; al recordar: Max-Age hasta el vencimiento absoluto. SameSite=Lax es la configuración técnica para ese despliegue same-site. No se habilita fallback cross-site por suposición.

CSRF ligado a sesión previa al login, renovado al autenticar. Implementación prevista: secreto aleatorio de preauth en cookie HttpOnly `__Host-gdes-preauth` con los mismos atributos de transporte y token derivado por HMAC servido en `/auth/web/csrf`; header `X-CSRF-Token` y Origin exacto para login ADMIN, verify 2FA y mutaciones web. La sesión autenticada tiene identificador aleatorio persistido; el token CSRF se deriva de esa generación, no del refresh para permitir rotación coordinada. No se añade ningún campo al DTO público. Error de CSRF/origen mal formado usa 400 BAD_REQUEST; cookie/sesión inválida usa 401 INVALID_TOKEN. Los secretos no se devuelven en JSON.

Respuesta perdida/ambigua de refresh exige relogin. Logout online revoca la cadena e invalida cookies con los mismos atributos. Logout offline sigue siendo coordinación pendiente del frontend, sin garantía de revocación del servidor hasta recibir la petición. Orígenes concretos, dominios de producción y validación en navegadores reales quedan pendientes para despliegue/F-010. La base aprobada habilita desarrollo y pruebas locales, no certifica integración de producción.

### Verificación de email mobile

El humano ratificó TTL de 24 horas para el enlace de verificación de email. Token firmado de un solo uso, persistido únicamente como hash; no confundir con recuperación (1 h) ni decisión administrativa (7 días).

## Autorización

| Recurso | EMPLOYEE | TO_BE_ADMIN | ADMIN | SUPER_ADMIN |
|---|---|---|---|---|
| Endpoints mobile (`/workplaces`, `/attendance/*`, `/timesheets`, `/documents`, `/profile`) | ✔ | ✘ | ✘ | ✘ |
| Login admin web | ✘ | ✘ (403 `ADMIN_ACCESS_PENDING`) | ✔ | ✔ |
| Endpoints admin (`/records`, `/users`, `/clients`, `/sites`, `/workplaces` gestión, `/dashboard`) | ✘ | ✘ | ✔ | ✔ |

Notas:
- `TO_BE_ADMIN` es un rol explícito (cierra la divergencia 6 de contratos-api.md): la spec §10 lo trata como rol ("si existe lo pasa a toBeAdmin, si no lo crea con ese rol").
- Mobile no consumía roles (su `AuthUser` no tenía `role`): el contrato lo agrega y la app lo recibe, aunque no lo use aún.
- La validación definitiva de auth, permisos, roles e integridad es **siempre del backend** (spec §73/§87); el frontend es solo UX.
- Rate limiting en endpoints de auth (login, OTP, recovery): 429 `TOO_MANY_ATTEMPTS`.

## HTTPS y transporte

Todo el tráfico por HTTPS en producción. Los uploads multipart van por el mismo canal TLS al backend.

## Implementación auth base

`src/modules/auth/` persiste AuthChallenge, AuthSession, AuthRefreshToken y AuthRateLimit. Los refresh opacos solo se guardan como HMAC; access HS256 exige `sub`, `role`, `type`, expiración y `sid` de sesión vigente. Guard verifica usuario activo, rol vigente, email verificado MOBILE y sesión no revocada/vencida. ADMIN no hereda la restricción de verificación de email de mobile.

OTP seis dígitos/10 min/cinco intentos, un solo uso y cooldown mobile60 s. Intentos y revocaciones se confirman antes de responder error. Challenge ADMIN ligado a preauth original; GET csrf autenticado deriva de la sesión, preauth se borra al autenticar. No se permite un segundo login ADMIN mientras conserva cookie de sesión activa: logout previo. CSRF/Origin mal formado BAD_REQUEST; sin agregar campos DTO. Auth siempre no-store, incluidos errores; CORS con ADMIN_FRONTEND_URL exacto y credenciales. Cookies conservan Secure aun en desarrollo: probar navegador bajo HTTPS o localhost compatible; no hay fallback inseguro.

Rotación toma User → AuthSession; logout solo AuthSession; verificación Challenge → User → sesión nueva. Ese orden evita deadlock con desactivación User → sesiones (F-004). Reuso revoca la cadena de esa sesión de forma durable. Las rutas mobile no aceptan refresh ADMIN ni lo devuelven en JSON; logout mobile revoca únicamente la sesión identificada por el access.

Rate limit persistido y atómico (ventana10 min): login por IP100 y por identifier/cliente10; challenges por usuario/cliente10; verify IP200 y usuario/cliente20; resend IP50 y usuario5, además del máximo de cinco intentos por challenge. Reenviar o pedir challenge nuevo no reinicia el límite global de verificación. Valores técnicos para desarrollo, revisar con tráfico real antes del despliegue.

Secrets access/refresh distintos obligatorios al boot. Providers log redactan destinatarios y muestran solo códigos OTP deliberados de desarrollo; no envían mensajes reales. Adaptadores Resend/Meta implementados por configuración con transporte/errores/reintentos en06; las pruebas no enviaron mensajes reales. Las suites HTTP/PostgreSQL usan fixtures dedicadas, no credenciales de seed productivo. Validación reproducible en test/README.md; pruebas de navegador/producción son F-010 y no se sustituyen por tests HTTP.

Cierre F-002 con revisión independiente aprobada, build/lint y 22/22 pruebas HTTP/PostgreSQL (auth14 + estructura8), sin observaciones técnicas abiertas. Regresión de expiración tras lock User comprueba OTP_EXPIRED sin consumo ni sesión, y JSON malformado conserva BAD_REQUEST español/no-store.

## Registro, enlaces y Google — implementación F-008A

Registro conserva perfil validado y Argon2 en RegistrationChallenge separado; nunca contraseña plana. OTP6/10min/5intentos/cooldown60s y límites IP/identidad persistidos. Retención absoluta72h con purga al inicio y cada60s; payload null al consumo. Verificar crea User, consume OTP y persiste AuthLink+AuthEmailIntent en la misma transacción; responde202 sin esperar email. Expiración se revalida después de bloqueos y unicidad; un vencimiento tardío revierte toda creación.

AuthLink distingue EMAIL_VERIFICATION24h y PASSWORD_RESET1h, firma HS256 separada por propósito y hashDB. Se liga a usuario, credentialVersion y hash del email destino; editar email invalida enlaces previos. Destino verificación: API_PUBLIC_URL/api/v1/auth/email/verify;302 fijo a MOBILE_DEEP_LINK_SCHEME://email-verified?success=true. Recuperación: ADMIN_FRONTEND_URL/password-reset?token=... para ambas apps. API_PUBLIC_URL es origen puro configurado, defaultdev/test localhost3000; producción exige HTTPS explícito, sin confiar en Host/Forwarded. Integración de pantallas y deep links pendiente en las apps.

Reset bloquea User→Link/sesiones, incrementa User.credentialVersion y consume enlaces de recuperación; no adquiere challenges después de User. Login captura generación y contacto junto a la credencial comprobada. Verify/resend compara destinationHash y generación bajo Challenge→User: editar teléfono/email o cambiar contraseña invalida la prueba previa, sin rehabilitarla con resend.

Resend de verificación y recovery encolan una intención equivalente por cada email válido antes de202; no consultan identidad ni esperan proveedor de forma condicional. Worker procesa fuera de la respuesta y comprueba elegibilidad. Destinatario AES256-GCM cifrado; bearer no persistido, reconstruido idéntico desde metadatos del enlace. Intentos máximos3, lease60s con fencing, ciclo250ms/lote20 y TTL1h/24h. Namespace de clave/orígenes/proveedor/from aísla configuraciones: al rotar, drenar configuración anterior o solicitar enlace nuevo; no migra trabajos antiguos. Purga al iniciar y mientras proceso activo. Aceptación del proveedor no certifica entrega ni exactly-once.

Google usa google-auth-library10.5.0: firma, issuer, aud string exacto, exp estricto y email_verified=true. Solo EMPLOYEE ACTIVE existente con email local verificado; sin alta/fusión/cambio de perfil. El campo phone de entrada se valida, pero el OTP se envía exclusivamente al teléfono registrado. La verificación Google no sustituye OTP ni verificación local del email. Pruebas incluyen SDK real con RSA offline, sin cuentas externas.

## Solicitudes administrativas — implementación F-008C aprobada

AdminAccessChallenge separado guarda perfil/Argonhash, resultado seguro de política y prueba de hash/generación de credencial existente; jamás contraseña plana. Inicial verifica contra hash existente o dummy y crea hash temporal en ambos casos. La elegibilidad y los conflictos solo se revelan trasOTP. Retención72h desde creación, no extensible por resend, purga al inicio/cada60s y payloadnull al consumir. El OTP inicial/reenvío usa EmailProvider; recepción/decisión/resultado se encolan en la transacción de negocio.

Verify toma Challenge→lock de identidad normalizada→User→Request. Nuevo crea TO_BE_ADMIN; existente conserva perfil/password. Cambio de rol incrementa credentialVersion y revoca User→sesiones sin bloquear otros challenges. Revalida OTP después de esperas/índice único y antes de consumir; fallo tardío revierte User/request/notificaciones. Confirm toma User→Request y revisa hash/generación/email/estado/rol/expiry tras locks. Trigger de transición INACTIVE cancelaPENDING en el mismo commit; reactivación no revive token. No hay decidedBy ficticio: el token público no identifica a la persona que confirmó.

Una solicitud por usuario puede tener varios antecedentes, con índice parcial que permite soloPENDING no cancelada. Renovación tras nuevaOTP conservaid y aumenta decisionGeneration; re-postulación tras rechazo/cancelación usaidnuevo. Ambas exigen prueba vigente y cuentaACTIVE/rol elegible; replay consumido no dispara ninguna.

AdminAccessNotification persiste intención por request/generación/tipo/destinatario. Token ADMIN_DECISION7d HS256 domain-separated/hashDB; notificación reconstruye los mismos claims/iat/exp/jti, HTML escapado y clave de idempotencia. Sin bearer en claro, acceptedAt registra aceptación y no entrega. Namespace de secreto/configuración, lease60s/fencing e intentosmáximos3, ciclo250ms/lote20; TTL del envío≤24h y del enlace, acorde ventana de idempotencia de Resend. Elegibilidad se comprueba antes de enviar; solicitudes canceladas/renovadas o destinatarios fuera del rol no reciben capacidades pendientes. Configuración nueva no procesa jobs de otro namespace; no se promete entrega exactamenteuna vez. Requerimientos externos de dominio/plantilla/client y navegador siguen separados de la verificación técnica.
