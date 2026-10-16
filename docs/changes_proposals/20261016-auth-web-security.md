# Seguridad web y TTL de verificación de email

Pendiente de propagación por orchestrator; no editar copia SYNCED local.

El humano ratificó en esta sesión la base de desarrollo/pruebas: refresh `__Host-gdes-refresh` Secure/HttpOnly/Path=/ sin Domain; frontend y API same-site, CORS con origen explícito; CSRF ligado a preauth renovado al autenticar; relogin ante refresh ambiguo. Dominios concretos de producción quedan pendientes. También ratificó enlace de verificación mobile con TTL 24 h y comprobación de contraseñas únicamente local por ahora, sin HIBP (lista versionada de comunes/comprometidas conocidas; cobertura limitada explícita).

Propuesta de consolidación en contrato común, sección Sesión web admin: reemplazar pendiente de esa base por aprobado para desarrollo, manteniendo dominios y navegadores como pendientes de despliegue/F-010. Detalle técnico local en docs/04-auth-y-seguridad.md: SameSite=Lax, cookie de sesión sin recordar/Max-Age absoluto al recordar, cookie preauth HttpOnly, X-CSRF-Token derivado HMAC de preauth/generación de sesión, Origin exacto, sin nuevos campos DTO. Validación CSRF mal formada: 400 BAD_REQUEST; sesión inválida: 401 INVALID_TOKEN. Estos detalles concretan la base aprobada, no añaden capacidades de producto.

No retirar esta propuesta hasta verificar incorporación y sync.
