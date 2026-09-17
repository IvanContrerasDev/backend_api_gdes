# F-002 — Auth base: login email/legajo + JWT con refresh rotativo

**Estado:** pending
**App(s):** backend
**Creada:** 2026-09-15

## Contexto

Primer feature funcional del backend. Mobile hoy autentica con credenciales fijas mock y sin token; este feature es el primer contrato real que mobile consumirá (su migración es F-010).

## Alcance

**Incluye:**
- `POST /auth/login` con `identifier` (email normalizado o legajo) + `password` + `client` (`MOBILE`/`ADMIN`), con validación de rol por cliente y de `accountStatus`.
- Emisión de access JWT (30 min) + refresh token opaco (7 días) persistido con hash.
- `POST /auth/refresh` con **rotación** y detección de reuso (revoca la cadena, 401 `REFRESH_TOKEN_REUSED`).
- `POST /auth/logout` (revoca refresh activo).
- `JwtAuthGuard` y `RolesGuard` funcionales + decorador de roles.
- Hash Argon2 de contraseñas + política de contraseña portada desde `mobile_app_gdes/utils/validations.ts`.
- Rate limiting básico en `/auth/login` (429 `TOO_MANY_ATTEMPTS`).

**NO incluye:**
- 2FA por email (admin) ni OTP WhatsApp (mobile) en el login (F-008). En esta feature el login con credenciales válidas emite tokens directamente, sin paso intermedio; F-008 lo convierte en 202 + `challengeId` sin cambiar el contrato final de tokens.
- Google OAuth, registro, verificación de email (magic link), recuperación, admin-access-request (F-008).
- Alta de usuarios (F-004): para probar, seed de un usuario EMPLOYEE de prueba.

## Referencias (fuente de verdad)

- Docs: `backend_api_gdes/docs/03-contratos-api.md` (sección Auth), `backend_api_gdes/docs/04-auth-y-seguridad.md` (tokens, flujos 1 y tabla de autorización), `backend_api_gdes/docs/07-convenciones.md` (códigos de error)
- Código: `mobile_app_gdes/utils/validations.ts` (política de contraseña), `mobile_app_gdes/stores/authStore.ts` (AuthUser)

## Criterios de aceptación

- [ ] Login con email o con legajo devuelve `{ data: { user, tokens } }` con `user` en inglés incluyendo `role`.
- [ ] `client=MOBILE` con rol distinto de `EMPLOYEE` → 403 `ROLE_NOT_ALLOWED`; cuenta INACTIVE → 403 `ACCOUNT_INACTIVE`.
- [ ] Refresh rota el token y reusar el anterior → 401 `REFRESH_TOKEN_REUSED` con la cadena revocada.
- [ ] Logout invalida el refresh activo.
- [ ] Endpoint protegido de prueba rechaza sin token (401) y acepta con access token válido.
- [ ] Errores con formato y códigos del catálogo de `docs/07-convenciones.md`.

## Notas de implementación

- Claims del access token: `sub`, `role`, `type: "access"`. Secrets separados para access/refresh.
- Respuesta de login admin (2FA pendiente de F-008): definir con el leader el placeholder exacto antes de implementar.

## Registro de implementación

(pendiente)

## Review

(pendiente)
