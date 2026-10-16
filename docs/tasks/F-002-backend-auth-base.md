# F-002 — Auth base: login email/legajo + JWT con refresh rotativo

**Estado:** pending
**App(s):** backend
**Creada:** 2026-09-15

## Vigencia y dependencia contractual

Tarea pendiente, conservada como preparación de auth base. 03 exige OTP mobile y 2FA web, refresh web HttpOnly separado; no se permite un endpoint público transitorio que omita factores. Leader debe acotar la infraestructura de F-002 y su dependencia de F-008 antes de dispatch; no representa integración disponible. Tipar roles de guard/decorador con UserRole de @prisma/client (follow-up de F-001). Catálogo/rutas finales en 03/04/07 prevalecen.

## Contexto

Primer feature funcional del backend. Mobile hoy autentica con credenciales fijas mock y sin token; la infraestructura de esta feature soportará el contrato final que mobile consumirá (su migración es F-010).

## Alcance

**Incluye:**
- `POST /auth/login` con `identifier` (email normalizado o legajo) + `password` + `client` (`MOBILE`/`ADMIN`), con validación de rol por cliente y de `accountStatus`.
- Infraestructura de emisión de access JWT (30 min) + refresh opaco (7 días) persistido con hash, invocada solo después de verificar todos los factores del flujo final.
- `POST /auth/refresh` con **rotación** y detección de reuso (revoca la cadena, 401 `REFRESH_TOKEN_REUSED`).
- `POST /auth/logout` (revoca refresh activo).
- `JwtAuthGuard` y `RolesGuard` funcionales + decorador de roles.
- Hash Argon2 y política aprobada P-06 en docs/03 y 04: 12–128 caracteres, espacios/Unicode, sin composición obligatoria; rechazo de comunes/comprometidas. Mobile debe alinearse.
- Rate limiting básico en `/auth/login` (429 `TOO_MANY_ATTEMPTS`).

**NO incluye:**
- Proveedores 2FA email/OTP WhatsApp de F-008. Coordinar con leader el límite entre features: login público siempre responde challenge 202 y no emite tokens antes del segundo factor; infraestructura parcial no habilita omitirlo.
- Google OAuth, registro, verificación de email (magic link), recuperación, admin-access-request (F-008).
- Alta de usuarios (F-004): para probar, seed de un usuario EMPLOYEE de prueba.

## Referencias (fuente de verdad)

- Docs: `backend_api_gdes/docs/03-contratos-api.md` (sección Auth), `backend_api_gdes/docs/04-auth-y-seguridad.md` (tokens, flujos 1 y tabla de autorización), `backend_api_gdes/docs/07-convenciones.md` (códigos de error)
- Código: `mobile_app_gdes/utils/validations.ts` (evidencia local pendiente de alinear con política común), `mobile_app_gdes/stores/authStore.ts` (AuthUser)

## Criterios de aceptación

- [ ] Login con email/legajo respeta challenge 202; tokens únicamente tras OTP/2FA con user en inglés y role, conforme al contrato final. Verificar infraestructura sin publicar bypass de factores.
- [ ] `client=MOBILE` con rol distinto de `EMPLOYEE` → 403 `ROLE_NOT_ALLOWED`; cuenta INACTIVE → 403 `ACCOUNT_INACTIVE`.
- [ ] Refresh rota el token y reusar el anterior → 401 `REFRESH_TOKEN_REUSED` con la cadena revocada.
- [ ] Logout invalida el refresh activo.
- [ ] Endpoint protegido de prueba rechaza sin token (401) y acepta con access token válido.
- [ ] Errores con formato y códigos del catálogo de `docs/07-convenciones.md`.

## Notas de implementación

- Claims del access token: `sub`, `role`, `type: "access"`. Secrets separados para access/refresh.
- Alcance de infraestructura F-002 frente a proveedores F-008 requiere preparación del leader; no inventar una respuesta auth temporal incompatible.

## Registro de implementación

(pendiente)

## Review

(pendiente)
