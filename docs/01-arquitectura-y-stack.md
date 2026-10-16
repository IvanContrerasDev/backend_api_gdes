# 01 — Arquitectura y stack

## Estado real y decisiones de implementación

F-001 dejó NestJS 11, Node 24 Alpine, Prisma 6 y PostgreSQL 16; solo User/Site y 18 enums existen en schema. `GET /health` está disponible sin prefijo. Módulos de dominio e integraciones de este documento son diseño aprobado pendiente. Guards son esqueletos: JWT rechaza siempre y roles todavía usan string (tipar con UserRole en F-002). `emailVerifiedAt` y OtpPurpose.LOGIN aún no existen en schema; REJECTED permanece en enums Prisma aunque el contrato de revisión ya lo retiró. Requieren migración al implementar, no reinterpretar el diseño.

El cliente Prisma se copia del stage build al production para evitar generación con CLI no instalado/no pineado. ESLint prohíbe any explícito. Las env requeridas se validan al boot aun si los providers no están implementados; log es el default de EMAIL_PROVIDER/WHATSAPP_PROVIDER. El interceptor actual envuelve todo payload: un listado ya envuelto quedaría doble; resolver antes de endpoints paginados. No hay CORS/cookies ni prefijo /api/v1 configurados todavía.

Verificación pendiente: ejecutar `docker compose up --build` y health en entorno con Docker (el cierre F-001 no pudo ejecutar Docker). Build/lint, migración/seed y health tienen evidencia del cierre revisado; no se reejecutaron durante esta auditoría documental.

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

Seed idempotente por upsert de Site; timestamps en User/Site por convención global. PORT default 3000, NODE_ENV opcional. npm allowScripts fija aprobaciones de Prisma a versiones del package: revisar al actualizar; prisma config en package.json deberá migrarse cuando corresponda actualizar a Prisma 7. Mensajes detallados class-validator todavía pueden incluir inglés dentro del 422: configurar por campo al implementar para cumplir español completo. Defaults: geofence 100 m, OTP 10 min; providers log son configuración anticipada, sin implementación real todavía.
