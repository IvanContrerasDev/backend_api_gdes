# F-005 — Plan de asistencia

**Objetivo:** ingesta idempotente y transaccional con proyección diaria y estado real del empleado.
**Arquitectura:** AttendanceModule; validación de tiempo/GPS como funciones puras verificables con hora servidor explícita; servicio Prisma serializado por User, luego Workplace/Client. Guard/sesiones de F-002, estructura de F-003 y cuentas de F-004.
**Stack:** NestJS/TypeScript, Prisma/PostgreSQL, Node test runner.
**Spec:** F-005-backend-attendance.md y decisiones vigentes en docs/05. Implementar solo tras resolver pregunta humana de salida anterior a entrada abierta.

Restricciones: sin reconstrucción por hora cliente ni cambios manuales/DELETE, sin recibidoAt controlado por request, ningún secreto o bypass, no git desde implementer, DB aislada, respetar SYNCED. Ciclo del harness implementer→reviewer.

## Foco de revisión

- Replay pasado de24h devuelve IDs originales; requestId ajeno nunca revela asistencia.
- Dos requests iguales o marcaciones simultáneas no duplican evento/intervalo ni pierden proyección.
- Dos entradas offline desordenadas: último OPEN significa último creado por recepción, no mayor hora original.
- Fecha GMT-3, medianoche y fronteras inclusivas24h/2min sin usar clock cliente como servidor.
- Estado inactivo/configuración geográfica cambian mientras se espera lock: revalidar dentro de transacción.

## 1. Tiempo/GPS y persistencia

Archivos: src/modules/attendance/{attendance.dto,attendance.validation,attendance-time,geofence}.ts; schema/migración; test/attendance.e2e.cjs.

- [ ] Pruebas RED de helper tiempo con receivedAt controlado exactamente24h/+1ms y2min/+1ms; online siempre servidor, offline exige ambos tiempos y rechazo de occurredAt posterior al clientSentAt.
- [ ] Pruebas de distancia/precisión en fronteras y medianoche; validaciones en español. No clock inyectable por HTTP ni guard simulado.
- [ ] Migrar eventos/registros/intervalos con claves/índices, orden interno estable y snapshots client/site. Registros con versión interna1; eventos inmutables por API.
- [ ] Implementar helpers/DTOs y probar; documentar datos cliente frente a servidor.

## 2. Ingesta, proyección e idempotencia

Archivos: attendance.module/controller/service; AppModule; test/attendance.e2e.cjs.

- [ ] HTTP RED con fixtures usuario/sesión y DB real: primer evento201, replay200, clave ajena, reintentos vencidos, concurrencia/atomicidad, WORK/ABSENCE, 600min, medianoche, caso humano resuelto y búsqueda del último OPEN por recepción.
- [ ] Transacción con User→Workplace→Client, revalidar activos y configuración después de locks. Colisiones únicas: recuperar replay legítimo tras confirmar ganador, sin500 ni doble proyección.
- [ ] Aplicar algoritmo de intervalos, minutos floor sobre suma total, completitud/origen y PENDING persistente al requerir revisión GPS. Nunca cerrar otro día/lugar automáticamente.
- [ ] IDs/evento/record/message estables; sin metadata/DTO F-006 inventado.

## 3. Estado, integración y verificación

- [ ] HTTP RED de GET status propio, múltiples abiertos con selección estable, fechas y cuenta/cliente/lugar inactivos. Cierre concurrente refleja DB, no memoria.
- [ ] Implementar estado y cobertura de rollback GPS/evento/proyección y bloqueos concurrentes con cambios de cuenta/estructura.
- [ ] Prisma validate/generate/deploy, build/lint normales y suites auth/structure/users/attendance con sockets elevados; fixtures y artefactos temporales limpios. No recompilar dist mientras tests lo leen.
- [ ] Registro de implementación y handoff al leader. Reviewer independiente revisa contratos y casos adicionales; corregir hasta aprobado, consolidar docs, retirar task/plan y commit local sin push.
