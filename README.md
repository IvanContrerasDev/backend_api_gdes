# Backend API GdeS

NestJS + Prisma/PostgreSQL. Implementados y revisados: estructura organizacional, empleados/perfil, asistencia, correcciones y matriz mensual, planillas/documentos con R2 y métricas del dashboard. API bajo `/api/v1`; `GET /health` sin prefijo. Auth base exige OTP mobile o 2FA admin e incluye sesiones, refresh rotativo y CSRF web. Adaptadores Resend/Meta implementados; producción rechaza providers log. Registro, verificación de email, recuperación y Google también implementados y aprobados. Solicitudes administrativas implementadas y aprobadas F-008. Las pruebas no enviaron mensajes a cuentas reales.

Documentación y ruta de lectura: [docs/README.md](docs/README.md). Contratos comunes: [docs/arquitectura/contratos-api.md](docs/arquitectura/contratos-api.md). Política documental: [docs/convenciones/flujo-de-trabajo.md](docs/convenciones/flujo-de-trabajo.md): temas vigentes con racional breve, sin historial; código como evidencia real, requisitos pendientes explícitos. Propuestas se retiran tras consolidación y sync verificado; tasks/inbox solo mientras activos.

Desarrollo: `npm ci`, configurar `.env` desde `.env.example`, `npm run prisma:generate`, `npm run build`; con PostgreSQL, `npm run prisma:deploy`, `npm run prisma:seed`, `npm run start:dev`. Health en localhost:3000/health. Imagen Docker de producción construida y smoke HTTP contra PostgreSQL aislado verificado; compose completo sigue sin ejecución sobre la base local del usuario. Pruebas HTTP reales y preparación de DB aislada en [test/README.md](test/README.md).

En entornos distintos de `NODE_ENV=production`, el seed crea o actualiza cuatro cuentas locales (una por rol), todas activas y con email verificado. Credenciales: `seed.employee@gdes.local`, `seed.to-be-admin@gdes.local`, `seed.admin@gdes.local` y `seed.super-admin@gdes.local`; contraseña por defecto `GdesLocal2026!` para todas. Se puede cambiar antes de sembrar con `LOCAL_SEED_PASSWORD`. Los roles `ADMIN` y `SUPER_ADMIN` requieren el OTP de desarrollo (provider `log`); `TO_BE_ADMIN` queda sujeto al flujo de aprobación y no puede iniciar sesión administrativa.

Si ya existe el volumen Docker de node_modules, `up --build` conserva sus dependencias anteriores. Para actualizar el entorno de desarrollo y aplicar las nuevas migraciones al iniciarlo:

```bash
docker compose stop api
docker compose run --rm --no-deps api sh -c 'npm ci && npx prisma generate'
docker compose up -d --build api
```

El arranque del servicio ejecuta migrate deploy y el seed idempotente. No elimina la base; una colisión histórica de email detiene la migración y debe resolverse explícitamente. Durante pruebas locales, pausar el watcher evita compilaciones simultáneas sobre dist.



# Notes
`sudo chown -R "$(id -u):$(id -g)" node_modules`

si al levantar el backend devuelve error por alguna dependencia:
docker compose stop api
docker compose run --rm --no-deps api sh -c 'npm ci && npx prisma generate'
docker compose up -d --build api
docker compose logs -f api
