# B-01 — configuración para A-01/M-01

Runtime backend local reproducible: `docker compose up -d --build --wait` desde backend_api_gdes; inicializar solo catálogo con `docker compose exec -e NODE_ENV=production api npm run prisma:seed`. F-012/B-03 agrega fixture geográfica opt-in con provincia/centro GPS/radio explícitos. El seed de desarrollo crea cuentas locales ausentes, pero conserva intactas cuentas existentes. Suite aislada F-012: `npm test`, 199/199 PASS. No se arrancó ni migró la DB manual del usuario durante estas pruebas.

PC: API `http://localhost:3000/api/v1`, health `http://localhost:3000/health`, Admin Origin exacto `http://localhost:5173`, storage público privado `http://localhost:8333`. Descarga por GET `/timesheets/:id/file` o `/documents/:id/file` devuelve URL firmada900s. No reescribir su hostname.

Android físico: definir API_PUBLIC_URL=`http://IP_LAN_PC:3000` y STORAGE_PUBLIC_ENDPOINT=`http://IP_LAN_PC:8333`, recrear API; cliente mobile usa API con `/api/v1`. PC/Android misma LAN, puertos3000/8333 accesibles. API en Docker usa STORAGE_ENDPOINT=`http://storage:8333`; flag STORAGE_ALLOW_INSECURE_HTTP=true solo development/test. Endpoint público puede cambiar sin migrar namespace; no cambiar endpoint interno/bucket para corregir accesibilidad.

Admin sigue CORS exacto/credentials/X-CSRF-Token; GET `/auth/web/csrf` antes de login/2FA/refresh/logout. Cookies Secure/HttpOnly/SameSite=Lax intactas. Admin por LAN requiere coordinar HTTPS local y verificar navegador con su leader. Pruebas HTTP no certifican navegador ni Android.

PostgreSQL16 y SeaweedFS4.52 persistentes; detener con `docker compose down` SIN `-v`. Código/dependencias requieren reconstrucción (no watcher compartido). Resend/Meta/R2 productivos conservados; providers log locales no envían mensajes. F-012/B-03 cerrado; correo local completo B-02 y contingencia B-04 pendientes. Android físico/Expo Go y navegador Admin aún no verificados (Q-01); no cambiar consumidores desde este repo.
