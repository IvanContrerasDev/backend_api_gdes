# Pruebas HTTP y PostgreSQL

La suite arranca el proceso real `dist/main.js` y usa guards, sesiones y PostgreSQL reales. Auth prueba login con Argon2 y segundo factor a través de endpoints reales; los códigos se capturan del logger dev/test, sin enviar emails/WhatsApp. Estructura firma JWT solo para fixtures con usuario/sesión persistidos; no hay endpoint de bypass ni guards sustituidos. Requiere Node 24 y PostgreSQL 16 con `unaccent` disponible.

Usar únicamente una base dedicada cuyo nombre sea `gdes_f003_test`. La suite rechaza otro nombre, no ejecuta resets y elimina solo fixtures de su ejecución; migración/seed son pasos explícitos. No reutilizar credenciales ni bases de producción.

Ejemplo local reproducible (puerto PostgreSQL 55433 y API 33443 libres):

```bash
docker run --rm -d --name gdes-f003-test \
  -e POSTGRES_PASSWORD=f003-test -e POSTGRES_DB=gdes_f003_test \
  -p 127.0.0.1:55433:5432 postgres:16-alpine
# Esperar a que pg_isready confirme disponibilidad.
docker exec gdes-f003-test pg_isready -U postgres
DATABASE_URL=postgresql://postgres:f003-test@localhost:55433/gdes_f003_test npm run prisma:deploy
DATABASE_URL=postgresql://postgres:f003-test@localhost:55433/gdes_f003_test npm run prisma:seed
npm run prisma:generate
TEST_DATABASE_URL=postgresql://postgres:f003-test@localhost:55433/gdes_f003_test npm test
npm run lint
# Cuando ninguna otra revisión necesite la base:
docker stop gdes-f003-test
```

`npm test` compila antes de ejecutar todos los archivos `test/*.e2e.cjs`. El contenedor no monta volúmenes, y se elimina al detenerlo. La suite requiere que el seed de seis provincias esté aplicado.

La migración de estructura usa índices PostgreSQL por expresión para garantizar unicidad normalizada de clientes y lugares incluso con requests concurrentes. Esos índices se conservan en SQL porque Prisma no expresa índices por función. La búsqueda usa `unaccent` sin quitar acentos del nombre almacenado; la unicidad normaliza mayúsculas y espacios.

Auth cubre OTP mobile/2FA web, CSRF/Origin, cookies y separación de transporte, límites persistidos, expiración mobile deslizante/web absoluta, logout/reuso/rotación concurrentes y la ausencia de deadlock al desactivar. La suite no certifica aún navegador, proveedores externos ni producción: el boot en NODE_ENV=production rechaza log providers hasta F-008.

No ejecutar un watcher de desarrollo sobre el mismo dist mientras se compila/prueba: el contenedor gdes-api con bind mount recompila automáticamente y puede generar artefactos con otro propietario. Pausar temporalmente ese watcher y reanudarlo al terminar. En sandbox, compilar/lint normalmente y conceder permiso de sockets solo al proceso de tests:

```bash
npm run build
npm run lint
TEST_DATABASE_URL=postgresql://postgres:f003-test@localhost:55433/gdes_f003_test node --test test/*.e2e.cjs
```

Las pruebas auth limpian counters técnicos de rate limit entre casos, por lo que esta base debe ser exclusiva de la suite y no compartirse con sesiones de desarrollo/manuales. Los demás fixtures se eliminan por identidad del run. No arrancar dos ejecuciones de la suite simultáneas en la misma DB/puertos.

Asistencia cubre online con hora servidor, offline con occurredAt/clientSentAt y fronteras inclusivas24h/2min, recepción fuera de orden, GPS/tolerancia, medianoche GMT-3, proyección de intervalos, floor sobre suma total, replay/propiedad/colisiones y atomicidad con fallo tardío. También prueba congelación de clientId/siteId de lugares con registros y ambas carreras con primera ingesta, incluyendo UUID equivalentes en mayúsculas. Vínculo event.recordId durable y secuencia de intervalos independiente de versión preparan correcciones admin.

Registros admin cubre DTO exacto, permisos/sesiones, carga manual por día, solapamientos WORK/ABSENCE históricos, auditoría tras corrección/eliminación, expectedVersion y carreras de edición/aprobación/ingesta. La matriz verifica filtros sobre el mismo registro, todos los días, totales globales más allá de página, calendarios28/29/31, inactivos históricos, orden COLLATE C, contexto/propietario/TTL absoluto15min y persistencia al reiniciar API. Locks reales reproducen limpieza concurrente de expirados y commits durante captura mensual/detalle, evitando mezclar versión/totales e intervalos. Suite vigente87/87 y seis migraciones/seed verificadas desde una DB vacía dedicada.

La suite también cubre APPROVED→PENDING con una nueva fichada (los tres tipos, origen automático/manual), replay que conserva aprobación y rechazos sin mutación. Verificación conjunta90/90 tras este ajuste.
