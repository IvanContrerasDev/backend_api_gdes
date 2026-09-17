<!-- SYNCED-FROM-TEMPLATE: gestionado desde GdesProject/template/. NO EDITAR en este repo; proponé cambios en docs/changes_proposals/. -->

# Visión del sistema GdeS

> Documento relevado de fuentes reales. Nada aquí es inventado: cada afirmación proviene de los docs de `mobile_app_gdes/docs/` o de `admin_web_app/docs/spec_definition.md`. Lo que no existe aún (backend) se marca explícitamente como pendiente.

## Qué es GdeS

GdeS es un sistema de registros laborales. Los empleados registran entrada/salida/ausencia con geolocalización desde la app móvil; el personal administrativo (recursos humanos, gerentes y otros responsables) gestiona, revisa y garantiza la calidad de la información generada desde la web admin; el backend centraliza lógica de negocio, almacenamiento de datos, autenticación y procesamiento. Fuente: `admin_web_app/docs/spec_definition.md` Parte 1 (secciones 1 y 2), que también menciona servicios externos como envío de emails y almacenamiento de archivos.

## Componentes

| App | Repo | Usuarios | Rol en el sistema | Estado |
|---|---|---|---|---|
| Mobile | `mobile_app_gdes/` | Empleados | Autenticarse, registrar entrada/salida/ausencia con geolocalización, cargar planillas y documentación de contingencia, consultar perfil y cerrar sesión (`mobile_app_gdes/docs/01-producto-y-alcance-funcional.md`, resumen ejecutivo del README) | App navegable con mocks, sin backend real |
| Admin Web | `admin_web_app/` | RRHH / gerentes / administradores | Gestión operativa de registros, gestión de empleados, estructura organizacional (clientes, sites, workplaces), gestión documental (planillas y legajos) y supervisión operacional vía dashboard (`spec_definition.md` Parte 1, secciones 1-2) | Spec completa, sin código |
| Backend | `backend_api_gdes/` | (servicio) | Lógica de negocio, almacenamiento, auth, procesamiento | Por definir |

Roles definidos en la spec de admin (Parte 1, sección 5): `Employee` (solo app móvil), `toBeAdmin` (empleado pendiente de aprobación, sin acceso a la web admin), `Admin` (todas las operaciones del MVP en la web admin) y `SuperAdmin` (mismas vistas que Admin en el MVP; sus procesos, como aprobación de solicitudes administrativas por email, son responsabilidad del backend). En mobile hoy solo existe el rol empleado autenticado (`mobile_app_gdes/docs/01`, sección Actor).

## Flujos de datos principales

Todo lo listado es **mock hoy → backend mañana**. Fuentes: `mobile_app_gdes/docs/02-flujos-de-usuario.md` y `05-servicios-datos-y-contratos.md`.

- **Autenticación**: login email/contraseña contra credenciales fijas (mock); login Google simulado con OTP que acepta cualquier código de 6 dígitos; registro y recuperación validan localmente pero no envían datos. La sesión (`AuthUser`) se persiste localmente con Zustand persist + AsyncStorage; **no existe token**.
- **Marcaciones (entrada/salida/ausencia)**: el empleado elige lugar y acción, se obtiene GPS de alta precisión y se construye un `RegisterRequest`; el servicio simula éxito. El estado laboral (`isWorking`) vive solo en memoria. Existe infraestructura de cola/sincronización offline (`offlineRegisterService`, `syncService`) pero **está inactiva**: la UI rechaza la marcación sin Internet.
- **Lugares de trabajo**: tres lugares fijos mock; favoritos, lugar reciente por franja (mañana/tarde) e historial se persisten localmente en AsyncStorage.
- **Planillas**: selección de imágenes por cámara/galería real; el envío es simulado (`DocumentUploadRequest` con `months: []` fijo).
- **Documentación de contingencia**: selector de archivos/cámara real con filtro de extensiones; el envío es simulado (`ContingencyUploadRequest` con `workplaceId: null`).
- **Perfil**: muestra datos fijos mock, distintos del usuario autenticado.

En la web admin (spec, sin código) los flujos esperados son consulta/edición/creación manual de registros, revisión de registros con problemas de validación, gestión de empleados (alta, modificación, activación/desactivación, legajos y planillas), gestión de clientes/sites/workplaces con configuración geográfica, procesamiento de planillas y dashboard de supervisión (`spec_definition.md` Parte 1, sección 2).

## Dependencias entre apps

Todo pasa por el backend: **mobile → API ← admin**. No existe comunicación directa mobile↔admin. La spec de admin (Parte 8, sección 79) exige que el frontend admin se diseñe desacoplado del backend: la lógica de negocio del frontend no debe depender de URLs de endpoints, formatos internos de respuestas ni librerías HTTP específicas, de modo que los mocks iniciales se reemplacen por la API real sin tocar componentes ni hooks. En mobile, los servicios mock ya concentran los puntos donde se conectará el backend (`authService`, `registerService`, `workplaceService`, `uploadDocumentService`, `documentService`).

La unicidad del dominio la define el backend: email, número de legajo (`employee_id`) y DNI son únicos en todo el sistema, y un empleado solo puede tener un registro por día por lugar de trabajo — restricción `(user_id, workplace_id, date)` — con múltiples intervalos dentro del registro (`spec_definition.md` Parte 1, secciones 7 y 8).

## Pendiente de definir con el humano

- Stack y diseño del backend (todo lo que hoy es mock en mobile y todo lo que la spec de admin delega al backend).
- Servicios externos (envío de emails, almacenamiento de archivos, integraciones futuras) mencionados en la spec sin definición técnica.
