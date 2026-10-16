# Backend API GdeS

NestJS + Prisma/PostgreSQL. Bootstrap implementado; solo `GET /health` disponible. Auth y recursos de negocio siguen como diseño pendiente.

Documentación y ruta de lectura: [docs/README.md](docs/README.md). Contratos comunes: [docs/arquitectura/contratos-api.md](docs/arquitectura/contratos-api.md). Política documental: [docs/convenciones/flujo-de-trabajo.md](docs/convenciones/flujo-de-trabajo.md): temas vigentes con racional breve, sin historial; código como evidencia real, requisitos pendientes explícitos. Propuestas se retiran tras consolidación y sync verificado; tasks/inbox solo mientras activos.

Desarrollo: `npm install`, configurar `.env` desde `.env.example`, `npm run build`; con PostgreSQL, `npx prisma migrate deploy`, `npx prisma db seed`, `npm run start:dev`. Health en localhost:3000/health. Alternativa `docker compose up --build` pendiente de verificar en un entorno con Docker.
