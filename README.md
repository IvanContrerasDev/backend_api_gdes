# Backend API GdeS

NestJS11/TypeScript, Node24, Prisma6 y PostgreSQL16. Implementados y revisados: estructura, empleados/perfil, asistencia/registros/matriz, dashboard, archivos/R2 y autenticación con OTP/2FA, sesiones/refresh/CSRF, registro y solicitudes administrativas. Documentación y ruta de lectura en [docs/README.md](docs/README.md); contratos comunes en [docs/arquitectura/contratos-api.md](docs/arquitectura/contratos-api.md).

## Runtime local

Requiere Docker con Compose v2 y puertos5432/3000/8333 libres. Para herramientas y pruebas fuera de Docker: Node24 y PostgreSQL16 con unaccent. Compose usa PostgreSQL16, SeaweedFS4.52 y Mailpit fijados por versión/digest; R2 y Resend siguen siendo proveedores de producción. Las credenciales incluidas son exclusivamente de desarrollo.

```bash
# Desde este repo: imagen con npm ci, Prisma generate y build desde el lockfile.
docker compose up -d --build --wait
# Inicialización EXPLÍCITA de catálogo, sin crear ni modificar cuentas:
docker compose exec -e NODE_ENV=production api npm run prisma:seed
# Diagnóstico y reinicio conservando los volúmenes:
docker compose logs -f api storage
docker compose restart api storage
# Después de editar código/dependencias:
docker compose up -d --build --wait api
# Detener sin borrar DB ni archivos:
docker compose down
```

En desarrollo, los correos se capturan en Mailpit (sin salida a un proveedor externo), persistidos en `mailpit_data`; la UI autenticada se abre en `http://localhost:8025`. Para Android en la misma LAN, completar `.env` con credenciales independientes `MAILPIT_UI_USER`/`MAILPIT_UI_PASSWORD` y `MAILPIT_SEND_API_USER`/`MAILPIT_SEND_API_PASSWORD`, y establecer `MAILPIT_BIND_ADDRESS` a la IP LAN actual del host. No publicar el puerto 8025 en redes no confiables. El endpoint de envío permanece interno a Compose. No usar `down -v` para conservar mensajes.

El arranque espera un HeadBucket S3 autenticado y PostgreSQL saludable, aplica migraciones y arranca la API compilada. No ejecuta seed de cuentas. No hay bind mount del código ni volumen de node_modules: cada reconstrucción usa las dependencias del lockfile; el volumen histórico de node_modules puede quedar sin uso y no se elimina automáticamente. PostgreSQL conserva `postgres_data`; SeaweedFS conserva bytes, catálogo y credenciales en `storage_data:/data`. No usar `down -v` sobre el entorno del usuario.

API: [health](http://localhost:3000/health), [catálogos](http://localhost:3000/api/v1/catalogs). Rutas protegidas sin sesión devuelven401. Admin de referencia `http://localhost:5173`. S3 público `http://localhost:8333` requiere firma; la API usa `http://storage:8333` dentro de Docker. Solo S3 se publica: las interfaces internas de SeaweedFS no se exponen en el host.

Para Android físico, reemplazar `192.168.1.10` por la IP real del PC accesible desde la misma LAN; permitir los puertos3000/8333/8025 en el firewall. Para revisar correo capturado, iniciar sesión en `http://<IP-LAN>:8025`; abrir desde Android el enlace del mensaje para continuar la verificación y el deep link `gdes://email-verified?...` en Expo Go.

```bash
API_PUBLIC_URL=http://192.168.1.10:3000 \
STORAGE_PUBLIC_ENDPOINT=http://192.168.1.10:8333 \
ADMIN_FRONTEND_URL=http://localhost:5173 \
docker compose up -d --force-recreate api
```

`API_PUBLIC_URL` es origen puro para enlaces de auth; clientes usan `/api/v1`. `STORAGE_PUBLIC_ENDPOINT` debe ser el host final alcanzable por quien descarga: se firma directamente, nunca se sustituye el host de una URL firmada. `API_PORT`/`STORAGE_PORT` cambian puertos publicados; ajustar las URLs públicas junto con ellos. CORS exige el origen Admin exacto, credentials y `X-CSRF-Token`; bootstrap por `/api/v1/auth/web/csrf`. Cookies conservan Secure/HttpOnly/SameSite=Lax. Para Admin servido por LAN coordinar HTTPS local y pruebas con su leader; no relajar cookies. La prueba HTTP aislada no certifica navegador ni Android.

Fuera de Docker: copiar `.env.example` a `.env`, configurar PostgreSQL/storage real, ejecutar `npm ci`, `npm run prisma:generate`, `npm run prisma:deploy`, inicialización explícita y `npm run start:dev`. No ejecutar watcher y build/tests sobre el mismo `dist` simultáneamente.

## Cuentas y pruebas

El seed de catálogo no crea cuentas si se ejecuta con `NODE_ENV=production` (como en el comando de inicialización anterior). Para preparar cuentas locales nuevas de prueba, ejecutar conscientemente `docker compose exec -e NODE_ENV=development api npm run prisma:seed`: solo crea las cuentas conocidas que no existan; una cuenta ya presente conserva contraseña, rol, estado, verificación y datos manuales. `LOCAL_SEED_PASSWORD` se usa únicamente al crear una cuenta ausente. No es un mecanismo de reset. Los emails locales conocidos son `seed.employee@gdes.local`, `seed.to-be-admin@gdes.local`, `seed.admin@gdes.local` y `seed.super-admin@gdes.local`. ADMIN/SUPER_ADMIN requieren OTP de provider log; TO_BE_ADMIN requiere aprobación.

### Fixture geográfica opt-in (F-012/B-03)

Después de iniciar API y aplicar el catálogo, se puede crear una estructura local para probar mobile → API → PostgreSQL → Admin. El comando es aditivo e idempotente: crea un cliente y lugar con IDs estables; en siguientes ejecuciones conserva todos sus valores actuales y no los mueve si cambian las variables. No modifica cuentas ni crea un centro GPS implícito. Requiere opt-in, `NODE_ENV=development|test`, una provincia existente elegida explícitamente, centro GPS y radio configurados por el operador. No se debe habilitar en producción.

```bash
docker compose exec \
  -e NODE_ENV=development \
  -e LOCAL_SMOKE_FIXTURE_ENABLED=true \
  -e LOCAL_SMOKE_SITE_NAME="<provincia-existente>" \
  -e LOCAL_SMOKE_LATITUDE="<latitud-del-centro-real>" \
  -e LOCAL_SMOKE_LONGITUDE="<longitud-del-centro-real>" \
  -e LOCAL_SMOKE_RADIUS_METERS="<radio-elegido-en-metros>" \
  api npm run prisma:local-smoke-fixture
```

La fixture también rechaza `DATABASE_URL` cuyo host no sea loopback o el servicio Docker `postgres`. Una cuenta EMPLOYEE creada por el seed queda activa y verificada; si `seed.employee@gdes.local` ya existía, conserva sus valores y el operador debe confirmar que siga activa/verificada y usar su contraseña actual. Obtener OTP del provider log y no compartirlo. `GET /workplaces` debe listar el lugar activo. Si el lugar fixture existente aparece como INACTIVE, activarlo conscientemente desde Admin; la fixture conserva el estado manual. Desde Expo Go, iniciar una asistencia dentro del círculo configurado; el evento queda persistido en PostgreSQL. Luego iniciar sesión como Admin (cuenta local activa y OTP de provider log) y consultar la matriz del mes actual en `GET /api/v1/records/monthly`; el registro diario aparece en la fila empleado–lugar.

Los links de verificación se conservan en el buzón local autenticado. Para Android, configurar `API_PUBLIC_URL` al origen LAN (sin `/api/v1`) y recrear solo API; verificar salud antes de probar. Este procedimiento y las pruebas HTTP no certifican un dispositivo Android físico ni la UI Admin real; Q-01 sigue abierto hasta probar ambos consumidores.

WhatsApp usa log local por defecto; el correo usa Mailpit. Comandos para smoke Docker aislado, regresiones y limitaciones en [test/README.md](test/README.md). Configuración para consumidores en [progress/leader/integracion-local-entorno.md](progress/leader/integracion-local-entorno.md).
