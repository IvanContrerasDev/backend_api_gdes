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

Auth cubre OTP mobile/2FA web, CSRF/Origin, cookies y separación de transporte, límites persistidos, expiración mobile deslizante/web absoluta, logout/reuso/rotación concurrentes y la ausencia de deadlock al desactivar. La suite no certifica aún navegador, proveedores externos ni producción: el boot en NODE_ENV=production rechaza log providers y exige seleccionar Resend/Meta con configuración válida.

No ejecutar un watcher de desarrollo sobre el mismo dist mientras se compila/prueba: el contenedor gdes-api con bind mount recompila automáticamente y puede generar artefactos con otro propietario. Pausar temporalmente ese watcher y reanudarlo al terminar. En sandbox, compilar/lint normalmente y conceder permiso de sockets solo al proceso de tests:

```bash
npm run build
npm run lint
TEST_DATABASE_URL=postgresql://postgres:f003-test@localhost:55433/gdes_f003_test node --test test/*.e2e.cjs
```

Las pruebas auth limpian counters técnicos de rate limit entre casos, por lo que esta base debe ser exclusiva de la suite y no compartirse con sesiones de desarrollo/manuales. Los demás fixtures se eliminan por identidad del run. No arrancar dos ejecuciones de la suite simultáneas en la misma DB/puertos.

Asistencia cubre online con hora servidor, offline con occurredAt/clientSentAt y fronteras inclusivas24h/2min, recepción fuera de orden, GPS/tolerancia, medianoche GMT-3, proyección de intervalos, floor sobre suma total, replay/propiedad/colisiones y atomicidad con fallo tardío. También prueba congelación de clientId/siteId de lugares con registros y ambas carreras con primera ingesta, incluyendo UUID equivalentes en mayúsculas. Vínculo event.recordId durable y secuencia de intervalos independiente de versión preparan correcciones admin.

Registros admin cubre DTO exacto, permisos/sesiones, carga manual por día, solapamientos WORK/ABSENCE históricos, auditoría tras corrección/eliminación, expectedVersion y carreras de edición/aprobación/ingesta. La matriz verifica filtros sobre el mismo registro, todos los días, totales globales más allá de página, calendarios28/29/31, inactivos históricos, orden COLLATE C, contexto/propietario/TTL absoluto15min y persistencia al reiniciar API. Locks reales reproducen limpieza concurrente de expirados y commits durante captura mensual/detalle, evitando mezclar versión/totales e intervalos.

La suite también cubre APPROVED→PENDING con una nueva fichada (los tres tipos, origen automático/manual), replay que conserva aprobación y rechazos sin mutación.

Dashboard prueba DTO/cero/provincias, período civil/bisiesto/fin año, estados independientes, ausencia por registro, provincia histórica distinta del empleado, inactivos, permisos/query estricta y snapshot concurrente. Timesheet tiene checks/unicidad SQL verificados.

Providers prueban validación de configuración, modos mixtos, DI, payloads de Resend/plantilla Meta, headers, idempotencia/reintentos, límites body/timeout y errores sin datos upstream. Transporte fake/loopback sin mensajes reales.

Archivos cubre30 casos de SDK S3 real frente a servidorHTTP falso:7formatos/WordXMLUTF16, ZIP/OLEspoof/bombas, multipart20MiB/10 y temporales/cancelación, DTO/permisos/propiedad/catálogopúblico, filtrosfullnames/GMT-3, secuencia/CAS/auditoría/dashboard1→0→1, ambas carreras de estructura, revalidaciónactivos, DBfallotardío, PUT/DELETEambiguos/rollback/crash/reinicio y namespace. Fixtures fijan NODE_ENV=test y providerslog después de process.env para impedir envíos externos accidentales.

Auth avanzado añade25 casos HTTP/PostgreSQL: registro sin usuario previo/OTP/email/login, unicidad y expiración durante espera de índice, neutralidad con proveedor bloqueado, consumo/purpose/email modificado/replay, reset y revocación concurrentes sin deadlock, cambio de contacto durante challenge,128Unicode, GoogleSDK con RSA offline y controles estrictos, cola cifrada/reintento/reinicio/namespace/fencing. Registro publica User+OTP+link+intención en una transacción y devuelve202 sin esperar email. Auth base, avanzada y solicitudes administrativas comparten acquireAuthSuiteMutex (advisory lock de test) por sus counters globales; nuevas suites auth deben usar el mismo helper.

Solicitudes administrativas añaden29 casos: neutralidad/diez campos/contraseñas legadas, conservación de perfil/hash y verificación de email, conflictos/eligibilidad, prueba de credencial vigente, OTP/cooldown/retención72h/límites IP-email-usuario, replay, decisiones opuestas concurrentes/expiry tras locks, revocación, triggerINACTIVE/cancelación, renovación con nuevaOTP/mismoid, re-postulación con otra fila e historial, y una solaPENDING. Correo prueba reinicio/fallo/namespace/lease/fencing/JWT-body-key estables/TTL24h, elegibilidad después de firma y ausencia de envíos de capacidades obsoletas. Providers incluye9 casos y prueba clase LogNotifications real: solo OTP de dos asuntos conocidos, destinatario redactado, sin HTML/bearer/links y producción bloqueada. Las pruebas no enviaron mensajes reales.

Verificación independiente actual:190/190 sin fail/skip/todo, build/lint/Prisma y14migraciones+seed desde DB vacía. Imagen targetproduction5e707dffb47a construida y arrancada con NODE_ENV=production/configdummy/namespaceúnico: health200, catálogo público200(6provincias/9documentos/5ausencias), protegido401 y cero cuentas/notificaciones/intenciones en auxiliar. Sin mensajes reales. Contenedor smoke y auxiliar eliminados; no se modificaron DB/volúmenes del usuario.
