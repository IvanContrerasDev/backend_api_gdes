# Backend API GdeS

NestJS + Prisma/PostgreSQL. Implementados y revisados: estructura organizacional, empleados/perfil, asistencia, correcciones y matriz mensual, planillas/documentos con R2 y métricas del dashboard. API bajo `/api/v1`; `GET /health` sin prefijo. Auth base exige OTP mobile o 2FA admin e incluye sesiones, refresh rotativo y CSRF web. Adaptadores Resend/Meta implementados; producción rechaza providers log. Registro, verificación de email, recuperación y Google también implementados y aprobados. Solicitudes administrativas en implementación F-008. Las pruebas no enviaron mensajes a cuentas reales.

Documentación y ruta de lectura: [docs/README.md](docs/README.md). Contratos comunes: [docs/arquitectura/contratos-api.md](docs/arquitectura/contratos-api.md). Política documental: [docs/convenciones/flujo-de-trabajo.md](docs/convenciones/flujo-de-trabajo.md): temas vigentes con racional breve, sin historial; código como evidencia real, requisitos pendientes explícitos. Propuestas se retiran tras consolidación y sync verificado; tasks/inbox solo mientras activos.

Desarrollo: `npm ci`, configurar `.env` desde `.env.example`, `npm run prisma:generate`, `npm run build`; con PostgreSQL, `npm run prisma:deploy`, `npm run prisma:seed`, `npm run start:dev`. Health en localhost:3000/health. Imagen Docker de producción construida y smoke HTTP contra PostgreSQL aislado verificado; compose completo sigue sin ejecución sobre la base local del usuario. Pruebas HTTP reales y preparación de DB aislada en [test/README.md](test/README.md).

Si ya existe el volumen Docker de node_modules, `up --build` conserva sus dependencias anteriores. Para actualizar el entorno de desarrollo y aplicar las nuevas migraciones al iniciarlo:

```bash
docker compose stop api
docker compose run --rm --no-deps api sh -c 'npm ci && npx prisma generate'
docker compose up -d --build api
```

El arranque del servicio ejecuta migrate deploy y el seed idempotente. No elimina la base; una colisión histórica de email detiene la migración y debe resolverse explícitamente. Durante pruebas locales, pausar el watcher evita compilaciones simultáneas sobre dist.
