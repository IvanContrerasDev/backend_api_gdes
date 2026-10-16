<!-- SYNCED-FROM-TEMPLATE: gestionado desde GdesProject/template/. NO EDITAR en este repo; proponé cambios en docs/changes_proposals/. -->

# Visión del sistema GdeS

GdeS gestiona registros laborales: empleados marcan entrada/salida/ausencia con ubicación desde mobile; RRHH/administración gestiona empleados, organización, registros y archivos desde Admin. El backend centraliza autorización, reglas de negocio, persistencia y servicios externos. No hay comunicación directa mobile–Admin: **mobile → API ← Admin**.

## Componentes y estado real

| Repo | Responsabilidad | Implementación observada |
|---|---|---|
| `mobile_app_gdes/` | App Expo/React Native para EMPLOYEE; marcaciones, planillas, contingencia y perfil | Navegación y selectores reales; servicios mock, sesión local AsyncStorage sin tokens; cola offline existente pero no conectada a UI |
| `admin_web_app/` | React/Vite; empleados, clientes/lugares, matriz mensual, planillas, legajos e inicio | Módulos y adaptadores mock/HTTP implementados; mocks como entorno operativo, integración real pendiente |
| `backend_api_gdes/` | API NestJS/TypeScript, Prisma/PostgreSQL, monolito modular REST | Bootstrap, User/Site, infraestructura de errores/validación/guards y `GET /health`; módulos de auth/dominio aún no registrados |

Evidencia: `mobile_app_gdes/services/`, `stores/authStore.ts`; `admin_web_app/src/app/router.tsx`, `src/services/`, `src/mocks/`; `backend_api_gdes/src/app.module.ts`, `src/main.ts`, `prisma/schema.prisma`. No inferir endpoints disponibles de una spec, un enum o un adaptador.

## Responsabilidades y reglas de dominio

- Mobile captura evidencia; backend persiste eventos inmutables y proyecta registros diarios con intervalos; Admin consulta, corrige la proyección y aprueba sin alterar eventos. Motivo: separar evidencia original de intervención administrativa.
- Identidad común: email/DNI/legajo únicos; registro único por empleado/lugar/fecha GMT-3. No hay asignaciones permanentes empleado–lugar; la matriz refleja actividad del mes.
- Roles: EMPLOYEE en mobile; ADMIN/SUPER_ADMIN en Admin; TO_BE_ADMIN espera decisión y no accede a esas aplicaciones. Estado INACTIVE bloquea nuevas operaciones, conserva historia y permite correcciones retrospectivas autorizadas.
- Frontends concentran acceso a datos en servicios/adaptadores para sustituir mocks sin acoplar componentes a HTTP. Los mocks no demuestran permisos, persistencia, subida real o seguridad de navegador.

Las formas públicas, reglas de integración y pendientes viven exclusivamente en `contratos-api.md`; no se duplican aquí. Stack/integraciones internas del backend: sus docs `01-arquitectura-y-stack.md` y `06-integraciones.md`. Requisitos de Admin: `docs/spec_definition.md`; estado local y comportamiento mobile: su `docs/README.md`.

## Organización de trabajo y documentación

GdesProject mantiene template y coordinación común; cada subrepo tiene leader, implementer y reviewer propios. Los acuerdos comunes se editan en template y se propagan; los detalles locales se mantienen en el documento de su tema. Reglas y racional de esta política: `../convenciones/convenciones-globales.md`.
