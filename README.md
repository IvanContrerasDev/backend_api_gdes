# Backend API GdeS

NestJS11/TypeScript, Node24, Prisma6 y PostgreSQL16. Implementados y revisados: estructura, empleados/perfil, asistencia/registros/matriz, dashboard, archivos/R2 y autenticación con OTP/2FA, sesiones/refresh/CSRF, registro y solicitudes administrativas. Documentación y ruta de lectura en [docs/README.md](docs/README.md); contratos comunes en [docs/arquitectura/contratos-api.md](docs/arquitectura/contratos-api.md).

## Runtime local

Requiere Docker con Compose v2 y puertos5432/3000/8333 libres. Para herramientas y pruebas fuera de Docker: Node24 y PostgreSQL16 con unaccent. Compose usa PostgreSQL16 y SeaweedFS4.52 fijado por digest (Apache-2.0); R2 sigue siendo el proveedor de producción. Credenciales incluidas son exclusivamente de desarrollo.

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

El arranque espera un HeadBucket S3 autenticado y PostgreSQL saludable, aplica migraciones y arranca la API compilada. No ejecuta seed de cuentas. No hay bind mount del código ni volumen de node_modules: cada reconstrucción usa las dependencias del lockfile; el volumen histórico de node_modules puede quedar sin uso y no se elimina automáticamente. PostgreSQL conserva `postgres_data`; SeaweedFS conserva bytes, catálogo y credenciales en `storage_data:/data`. No usar `down -v` sobre el entorno del usuario.

API: [health](http://localhost:3000/health), [catálogos](http://localhost:3000/api/v1/catalogs). Rutas protegidas sin sesión devuelven401. Admin de referencia `http://localhost:5173`. S3 público `http://localhost:8333` requiere firma; la API usa `http://storage:8333` dentro de Docker. Solo S3 se publica: las interfaces internas de SeaweedFS no se exponen en el host.

Para Android físico, reemplazar `192.168.1.10` por la IP real del PC accesible desde la misma LAN; permitir los puertos3000/8333 en el firewall:

```bash
API_PUBLIC_URL=http://192.168.1.10:3000 \
STORAGE_PUBLIC_ENDPOINT=http://192.168.1.10:8333 \
ADMIN_FRONTEND_URL=http://localhost:5173 \
docker compose up -d --force-recreate api
```

`API_PUBLIC_URL` es origen puro para enlaces de auth; clientes usan `/api/v1`. `STORAGE_PUBLIC_ENDPOINT` debe ser el host final alcanzable por quien descarga: se firma directamente, nunca se sustituye el host de una URL firmada. `API_PORT`/`STORAGE_PORT` cambian puertos publicados; ajustar las URLs públicas junto con ellos. CORS exige el origen Admin exacto, credentials y `X-CSRF-Token`; bootstrap por `/api/v1/auth/web/csrf`. Cookies conservan Secure/HttpOnly/SameSite=Lax. Para Admin servido por LAN coordinar HTTPS local y pruebas con su leader; no relajar cookies. La prueba HTTP aislada no certifica navegador ni Android.

Fuera de Docker: copiar `.env.example` a `.env`, configurar PostgreSQL/storage real, ejecutar `npm ci`, `npm run prisma:generate`, `npm run prisma:deploy`, inicialización explícita y `npm run start:dev`. No ejecutar watcher y build/tests sobre el mismo `dist` simultáneamente.

## Cuentas y pruebas

El seed normal NO productivo crea o actualiza cuatro cuentas locales, activas y verificadas: `seed.employee@gdes.local`, `seed.to-be-admin@gdes.local`, `seed.admin@gdes.local`, `seed.super-admin@gdes.local`. Contraseña por defecto `GdesLocal2026!`, configurable con `LOCAL_SEED_PASSWORD`. Ejecutarlo solo conscientemente en DB local: **resetea password/rol/estado de esas cuentas existentes**. Para hacerlo: `docker compose exec api npm run prisma:seed`. ADMIN/SUPER_ADMIN requieren OTP de provider log; TO_BE_ADMIN requiere aprobación. La mejora de fixture geográfico corresponde B-03.

Email/WhatsApp permanecen providers log sin envíos reales (correo local completo B-02 pendiente). Comandos para smoke Docker aislado, regresiones y limitaciones en [test/README.md](test/README.md). Configuración para consumidores en [progress/leader/integracion-local-entorno.md](progress/leader/integracion-local-entorno.md).
