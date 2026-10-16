# Backend API GdeS

NestJS + Prisma/PostgreSQL. Bootstrap y estructura organizacional implementados: clientes, lugares y provincias bajo `/api/v1`, protegidos por JWT y roles. `GET /health` sigue sin prefijo. Auth base implementada con segundo factor obligatorio, sesiones/refresh y CSRF web; providers de desarrollo, sin envíos reales. Producción rechaza log providers hasta F-008; otros dominios siguen pendientes.

Documentación y ruta de lectura: [docs/README.md](docs/README.md). Contratos comunes: [docs/arquitectura/contratos-api.md](docs/arquitectura/contratos-api.md). Política documental: [docs/convenciones/flujo-de-trabajo.md](docs/convenciones/flujo-de-trabajo.md): temas vigentes con racional breve, sin historial; código como evidencia real, requisitos pendientes explícitos. Propuestas se retiran tras consolidación y sync verificado; tasks/inbox solo mientras activos.

Desarrollo: `npm install`, configurar `.env` desde `.env.example`, `npm run build`; con PostgreSQL, `npx prisma migrate deploy`, `npx prisma db seed`, `npm run start:dev`. Health en localhost:3000/health. Imagen Docker de producción construida y smoke HTTP contra PostgreSQL aislado verificado; compose completo sigue sin ejecución sobre la base local del usuario. Pruebas HTTP reales y preparación de DB aislada en [test/README.md](test/README.md).
