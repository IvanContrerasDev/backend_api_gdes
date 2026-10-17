# Auth empleados — publicación técnica para integración

Pendiente de incorporación/sync por orchestrator. Destino contrato común Autenticación mobile, recuperación y seguridad de enlaces. La disponibilidad real se consolida en docs03/04 tras revisión independiente, no se afirma integración frontend.

Rutas/DTO originales se conservan: register→OTPWhatsApp→202 emailVerificationRequired sin tokens; Google→OTPWhatsApp obligatorio; emailverifyGET marca verificado y redirige al esquema mobile; recuperación/resend202neutros y reset200updated. TTL email24h ratificado, reset1h; passwordpolicy local12–128Unicode sin HIBP.

Detalle HTTP de destinos: email verifica en API_PUBLIC_URL/api/v1/auth/email/verify?token=...; resultado exitoso302 a MOBILE_DEEP_LINK_SCHEME://email-verified?success=true. Recuperación abre ADMIN_FRONTEND_URL/password-reset?token=... para ambas apps. API_PUBLIC_URL es origen puro configurado, devlocalhost3000 y producciónHTTPS explícito; no construir a partir deHost/Forwarded. Frontends deben alinear estas pantallas/deep links al integrar; dominios de producción siguen por provisionar.

Enlaces se ligan a propósito, usuario, generación de credenciales y hash del email destino. Edición de email invalida enlace anterior; cambio de password revoca sesiones/refresh y challenges anteriores. OTP también se liga al contacto destino vigente; reenvío no rehabilita prueba de credencial/contacto antiguo.

Endpoints neutros persisten intención equivalente para todas las direcciones válidas, sin lookup/red condicional antes de202. Envío diferido recuperable, destinatario cifrado y bearer solo reconstruido desde metadatos/hash; no persistir token en claro. Registro encola verificación en la misma transacción que User/consumoOTP para evitar503 con cuenta parcialmente creada. Worker limita intentos y coordina lease/fencing/namespace; sin prometer entrega exactamente una vez ni certificación de proveedor real.

Motivo: conservar los contratos acordados y definir destinos/errores operativos sin exposición de existencia, credenciales o aprobaciones implícitas de mocks. Las pruebas de navegador/proveedores y apps reales continúan como integración/despliegue.
