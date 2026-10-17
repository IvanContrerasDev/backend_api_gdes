# 01 — Arquitectura y stack

## Estado real y decisiones de implementación

NestJS 11, Node 24 Alpine, Prisma 6 y PostgreSQL 16. El schema contiene User/Site, estructura Client/Workplace, tablas de auth base y asistencia (AttendanceEvent/AttendanceRecord/Interval). `GET /health` conserva ruta sin prefijo; estructura funciona bajo `/api/v1` (ver 03). JWT HS256 valida firma, expiración, claims y usuario/rol/estado actual de DB; roles tipados con UserRole. Auth base emite tokens solo tras OTP mobile/2FA admin, con sesiones, refresh rotativo y CSRF web (04). `emailVerifiedAt` y OtpPurpose.LOGIN implementados; ReviewStatus/IntervalReviewStatus ya no incluyen REJECTED; AdminRequestStatus lo conserva. Gestión de empleados y perfil implementada (03); ingesta/proyección/estado de asistencia implementados, aprobados tras revisión independiente; registros admin y matriz mensual también implementados/aprobados. Archivos, dashboard y auth avanzada pendientes.

El cliente Prisma se copia del stage build al production para evitar generación con CLI no instalado/no pineado. ESLint prohíbe any explícito. Las env requeridas y secrets access/refresh distintos se validan al boot; log es default de EMAIL_PROVIDER/WHATSAPP_PROVIDER en desarrollo, producción lo rechaza. El interceptor conserva los sobres paginados `{data,pagination}` sin anidarlos y envuelve objetos/listas simples con `{data}`. `/api/v1` configurado excepto health. CORS de ADMIN_FRONTEND_URL explícito y cookies/CSRF implementados para desarrollo; producción bloqueada hasta providers reales F-008.

Verificación de empaquetado: `docker build --target production -t gdes-backend-review:local .` completó en esta sesión; contenedor runtime conectado a PostgreSQL aislado respondió `/health` 200 y `/api/v1/clients` sin token 401. La suite HTTP/DB, build/lint y migraciones de estructura se verifican con los comandos de `test/README.md`. Compose completo con volúmenes del usuario no se ejecutó; smoke aislado no requiere modificar su base.

## Stack

| Capa | Elección | Notas |
|---|---|---|
| Lenguaje | TypeScript (estricto) | Todo el código en inglés; textos de usuario en español |
| Runtime | Node.js LTS | |
| Framework | NestJS | Monolito modular |
| Base de datos | PostgreSQL 16 | |
| ORM | Prisma | Migraciones con `prisma migrate` |
| Autenticación | JWT (access 30 min) + Refresh tokens (7 días, rotación) | Ver `04-auth-y-seguridad.md` |
| Emails | Resend | Detrás de `EmailProvider` (interfaz) |
| WhatsApp | Meta WhatsApp Cloud API | Detrás de `WhatsAppProvider` (interfaz) |
| Storage de archivos | Cloudflare R2 (S3-compatible) | Detrás de `StorageService` (interfaz). Decisión del humano 2026-09-15 |
| API | REST JSON | Convenciones en `03-contratos-api.md` |
| Deploy | Docker | `Dockerfile` + `docker-compose.yml` (app + postgres para dev) |
| Hash de contraseñas | Argon2 | |
| Validación | `class-validator` + `class-transformer` | DTOs de entrada |

## Preferencias para futuras decisiones de servicios

- **Email y mailings:** preferencia por Resend para conexiones y envíos de correo. Ya figura como proveedor de email en el diseño de integraciones; mantener `EmailProvider` para poder cambiarlo si conviene.
- **Deploy e infraestructura:** preferencia por evaluar primero Vercel para deploys, servidores, base de datos y gestión de infraestructura, buscando centralizar operación e integraciones con agentes. Es una preferencia no restrictiva: en cada caso comparar costo, facilidad, simplicidad y ajuste técnico con alternativas vigentes, y conversar la decisión con el humano antes de adoptar un servicio nuevo. Explicar también cómo usar Vercel cuando se elija.
- Estas preferencias no implican que Vercel sea siempre la opción adecuada ni modifican decisiones ya aprobadas para componentes concretos (por ejemplo PostgreSQL y Cloudflare R2); cada nueva decisión se evalúa en su contexto.

## Arquitectura: monolito modular

Un solo proceso NestJS, un módulo por dominio. Cada módulo tiene controller, service, DTOs y (si aplica) repositorio propio. Los módulos no se importan entre sí salvo a través de servicios públicos explícitos.

### Módulos

| Módulo | Responsabilidad |
|---|---|
| `AuthModule` | Login mobile (email o legajo + password) y Google OAuth, ambos con OTP WhatsApp; verificación de email por magic link en el registro; 2FA email admin; refresh con rotación; recuperación de contraseña; solicitud de acceso admin y su aprobación |
| `UsersModule` | CRUD de empleados (sin delete; activate/deactivate), perfil propio |
| `StructureModule` | Clients, sites (provincias), workplaces con configuración geográfica |
| `AttendanceModule` | Ingesta idempotente de eventos de marcación, proyección a registros diarios con intervalos, validaciones GPS, revisión y edición manual por admin, estado actual del empleado |
| `DocumentsModule` | Timesheets (planillas) y documents (legajo): upload, listado, reemplazo, cambio de estado, eliminación (solo documents) |
| `NotificationsModule` | Envío de emails (Resend) y WhatsApp (Meta). Consume `EmailProvider` / `WhatsAppProvider`; en dev, implementaciones que loguean en consola |
| `StorageModule` | Subida al bucket (R2) y generación de URLs firmadas de descarga |
| `DashboardModule` | Las 4 métricas agregadas server-side de la spec admin §47 |

### Cross-cutting

- `PrismaModule` global (una instancia de `PrismaService`).
- `ConfigModule` con validación de variables de entorno al boot (fallar rápido si falta config).
- Filtro global de excepciones → formato de error uniforme `{ error: { code, message, retryable } }` (ver `07-convenciones.md`).
- Interceptor global de respuesta → envoltorio `{ data: ... }`.
- Guards: `JwtAuthGuard`, `RolesGuard` (roles en inglés: `EMPLOYEE`, `TO_BE_ADMIN`, `ADMIN`, `SUPER_ADMIN`).
- Pipes: `ValidationPipe` global con `whitelist: true, transform: true`.

## Estructura de carpetas (propuesta)

```
src/
  main.ts
  app.module.ts
  common/            # filtros, interceptors, guards, decorators, utils
  config/            # config module + validación de env
  prisma/
  modules/
    auth/
    users/
    structure/       # clients, sites, workplaces
    attendance/      # events, records, intervals, review
    documents/       # timesheets + legajo documents
    notifications/   # email + whatsapp providers
    storage/
    dashboard/
prisma/
  schema.prisma
  migrations/
  seed.ts            # catálogo de provincias (sites)
test/
```

## Variables de entorno (mínimo)

`DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION` (`auto` en R2), `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `GOOGLE_CLIENT_ID`, `GEOFENCE_TOLERANCE_METERS` (default: `100`), `OTP_TTL_MINUTES` (default: `10`), `ADMIN_FRONTEND_URL`, `MOBILE_DEEP_LINK_SCHEME`.

## Docker

- `Dockerfile` multi-stage (build → runtime slim).
- `docker-compose.yml` de desarrollo: `api` + `postgres:16`. El bucket R2 y los servicios de Meta/Resend/Google son externos (cloud); en dev los providers se mockean por config (`EMAIL_PROVIDER=log`, `WHATSAPP_PROVIDER=log`).

## Qué NO entra en el MVP

- Push notifications.
- Sincronización de favoritos/preferencias de workplace al backend (hoy local en mobile; hay TODOs en su código).
- Gestión de cuentas admin por SuperAdmin desde la web (la spec la deja fuera del MVP).
- Uploads directos al bucket con URL firmada desde el cliente (se proxifica por el backend; ver `06-integraciones.md`).
- Microservicios, colas externas, workers separados. La proyección de asistencia es síncrona en la misma transacción de ingesta.

## Operación vigente

Seed idempotente por upsert de Site; timestamps en User/Site por convención global. PORT default 3000, NODE_ENV opcional. npm allowScripts fija aprobaciones de Prisma a versiones del package: revisar al actualizar; prisma config en package.json deberá migrarse cuando corresponda actualizar a Prisma 7. Los recursos de estructura validan campos/query/path con errores específicos P-07 y mensajes en español. Mensajes detallados class-validator de otros DTO futuros pueden incluir inglés dentro del 422: configurar por campo al implementar. Defaults: geofence 100 m, OTP 10 min; providers log implementados para pruebas locales, adaptadores externos pendientes. Argon2 0.45.1 tiene script nativo aprobado explícitamente y hash/verify dentro de imagen Docker comprobados.

## Dependencias y límite conocido

`@nestjs/platform-express` actualizado a 11.2.7 (Multer 2.4.0) para corregir alertas del parser multipart antes de implementar uploads. `npm audit --omit=dev` conserva tres avisos altos en la cadena Prisma 6.19.3 → @prisma/config → deepmerge-ts 7.1.5, por recursión con objetos circulares (GHSA-ggr8-5vv4-36mx). La configuración del CLI es local; no se observó entrada HTTP hacia esa combinación de objetos. Se mantiene Prisma 6 sin override mayor fuera de su rango probado; este alcance no equivale a una auditoría limpia. Verificar de nuevo al actualizar Prisma. El peer opcional del cliente puede instalar CLI aun con `--omit=dev`; el comentario histórico del Dockerfile no garantiza su exclusión efectiva.

Empaquetado de empleados: Docker runtime incluye resources/passwords con corpus, procedencia y licencia MIT. Imagen gdes-f004-review:local construida y smoke de checksum/licencia/política y Argon2 completado sin red. Suite conjunta38/38 y review independiente de F-004 aprobada.

Empaquetado vigente de registros: imagen production target gdes-f006-review:local construida con schema/cliente Prisma actualizado. Smoke runtime con NODE_ENV=test, providers log y PostgreSQL aislado confirmó health200, rutas protegidas401 y modelos AttendanceEvent/AttendanceRecord/Interval/MonthlySnapshot generados. No habilita producción mientras falten providers reales. Suite actual87/87 y revisión independiente F-006 aprobada.

Dashboard mensual F-009 implementado/aprobado: cuatro contadores y desglose provincial sobre PostgreSQL real en RepeatableRead, incluye ceros e históricos inactivos. Build/lint, Prisma validate/generate,97/97 pruebas (dashboard7), siete migraciones+seed desde DB vacía por implementer y reviewer. Contrato HTTP en03, captura aportada por humano como guía. No se modificó la DB de desarrollo ni se provisionaron proveedores externos.
