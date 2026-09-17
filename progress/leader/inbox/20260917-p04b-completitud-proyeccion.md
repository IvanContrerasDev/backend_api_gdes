# Instrucción: incorporar decisiones P-04.B (completitud y proyección) a los docs de backend

**Fecha:** 2026-09-17
**Origen:** orchestrator (GdesProject)
**Contexto:** el humano confirmó las decisiones de la propuesta `admin_web_app/docs/changes_proposals/20260917-p04-dtos-y-reglas.md` (subacuerdo B). Ya están en el contrato común `docs/arquitectura/contratos-api.md` (sección "Decisiones de integración, 2026-09-17", ítem 11), propagado a los tres repos.

## Qué hacer

Incorporar **textualmente** esas decisiones en la documentación de backend (principalmente `docs/05-asistencia-eventos-y-registros.md`, y `02-modelo-de-datos.md` / `07-convenciones.md` si corresponde):

1. Tabla de completitud intervalo/registro (WORK/ABSENCE × extremos → CLOSED/OPEN/SEMI_CLOSED, aporte de minutos, COMPLETE/INCOMPLETE).
2. Total del registro = suma de WORK CLOSED; no existe campo de horas de ausencia.
3. Medianoche: jornada que cruza 00:00 GMT-3 → dos registros (día A OPEN, día B SEMI_CLOSED, ambos INCOMPLETE, 0 minutos cerrados); sin cierre ni fusión automática.
4. Algoritmo de proyección vigente: entrada agrega intervalo, salida cierra el último abierto del mismo registro diario; la suma incluye solapamientos (ejemplo 09:00/11:00/12:00/18:00 → 600 minutos). Esto corrige el ejemplo contradictorio de la spec §23.

## Lo que NO está aprobado

Los subacuerdos P-04.A/C/D/E/F y los puntos de B marcados como pendientes (concurrencia `expectedVersion` vs ETag, DTOs completos, motivo de ausencia obligatorio, reglas de inactividad, uploads, métricas) **siguen pendientes de ratificación**: no los documentes como vigentes ni los implementes.
