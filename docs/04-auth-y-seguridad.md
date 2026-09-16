# 04 — Autenticación y seguridad

## Tokens

- **Access token**: JWT, 30 minutos. Claims: `sub` (userId), `role`, `type: "access"`.
- **Refresh token**: opaco (no JWT), 7 días, **rotación en cada uso** (spec Parte 2): cada `POST /auth/refresh` emite uno nuevo e invalida el anterior.
- **Detección de reuso**: si se presenta un refresh token ya rotado/revocado, se revoca toda la cadena del usuario y se responde 401 `REFRESH_TOKEN_REUSED`.
- "Recordar sesión": no extiende nada por encima de 7 días; la sesión vive hasta el límite del refresh.
- Secrets distintos para access y refresh (`JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`).
- Mobile migra el almacenamiento a SecureStore/Keychain (hoy no guarda token — cambio pendiente en su app).

## Contraseñas

- Hash con **Argon2**.
- Política igual a la que mobile ya valida en cliente (`utils/validations.ts`): reutilizar esas reglas en el servidor (mínimo de longitud, mayúscula, minúscula, número y símbolo — trasladar la regla exacta desde el código mobile al implementar).
- Empleado creado por admin: contraseña inicial seteada por el admin, habilitado inmediato, sin cambio obligatorio ni verificación de email (spec §11.1).
- La contraseña nunca se puede revisualizar (§11.1).

## Flujos

### 1. Login empleado (mobile) — email o legajo + password
1. `POST /auth/login` con `identifier` (email normalizado `trim().toLowerCase()` **o** legajo) + `password`, `client=MOBILE`.
2. Solo rol `EMPLOYEE`; cuenta `ACTIVE` obligatoria (INACTIVE bloquea todo, spec §6).
3. Éxito → `{ user, tokens }`.

### 2. Login admin (web) — password + 2FA por email
1. `POST /auth/login` con `client=ADMIN`. Roles `ADMIN`/`SUPER_ADMIN` → 202 con `challengeId` y envío de código de 6 dígitos por email.
2. `POST /auth/login/2fa/verify` con `challengeId` + `code` → tokens.
3. Código: 10 min de validez, máx. 5 intentos, un solo uso.
4. `TO_BE_ADMIN` → 403 `ADMIN_ACCESS_PENDING` con el mensaje exacto de spec §10.3.

### 3. Login Google (mobile) — OAuth real + OTP WhatsApp
1. La app usa Authorization Code + PKCE (`expo-auth-session`) y obtiene un `id_token` de Google.
2. `POST /auth/google` con `idToken` + `phone`: el backend verifica el token contra Google (audience = `GOOGLE_CLIENT_ID`), busca el usuario por email y envía OTP de 6 dígitos por WhatsApp al teléfono.
3. `POST /auth/otp/verify` → tokens.

### 4. Registro de empleado (mobile)
1. `POST /auth/register` con los 10 campos. Valida unicidad global de email, legajo y DNI (spec §7). **No crea el `User` aún**: el payload queda en el challenge OTP.
2. Envía OTP por WhatsApp.
3. `POST /auth/otp/verify` → se crea el `User` (`role=EMPLOYEE`, `accountStatus=ACTIVE`) y se devuelven tokens.
4. OTP: 6 dígitos, 10 min, reenvío con cooldown de 60 s.

### 5. Recuperación de contraseña (ambas apps)
1. `POST /auth/password-recovery` → respuesta neutra siempre (no revela si el email existe).
2. Email con enlace que contiene token firmado (1 h, un solo uso).
3. `POST /auth/password-reset` con token + nueva contraseña (misma política).
4. Al resetear se revocan todos los refresh tokens del usuario.

### 6. Alta de administradores (spec §10)
1. `POST /auth/admin-access-request` con email:
   - Si el usuario existe → pasa a rol `TO_BE_ADMIN`.
   - Si no existe → se crea con rol `TO_BE_ADMIN` y datos mínimos (el alta completa la hace un admin luego).
2. Emails: confirmación al solicitante + solicitud al SuperAdmin con **links firmados aprobar/rechazar** (token de un solo uso, 72 h).
3. Aprobación → rol `ADMIN` + email de aviso. Rechazo → rol `EMPLOYEE` + email de aviso.
4. Gestión de cuentas admin por SuperAdmin: fuera del MVP (spec §5).

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
