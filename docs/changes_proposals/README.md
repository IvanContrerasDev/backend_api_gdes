# Propuestas de cambio al conocimiento común (changes_proposals)

Los archivos comunes marcados `SYNCED-FROM-TEMPLATE` (agentes `leader`/`reviewer`/`implementer-*`, `docs/arquitectura/`, `docs/convenciones/`, `docs/tasks/TEMPLATE.md`) **NO se editan en este repo**. Se gestionan desde el template del repo `GdesProject` y se propagan con `scripts/sync-template.sh`.

## Cómo proponer un cambio

Cualquier agente del repo (leader, implementer, reviewer) que detecte que un archivo común está mal, desactualizado o incompleto crea un archivo:

```
docs/changes_proposals/YYYYMMDD-slug.md
```

con este formato:

```markdown
# Propuesta: <título>

**Fecha:** YYYY-MM-DD
**Origen:** <repo> / <agente que propone>
**Estado:** pendiente | aplicada | rechazada

## Archivo(s) común(es) afectado(s)
- docs/convenciones/convenciones-globales.md

## Problema
<Qué está mal o qué falta.>

## Cambio propuesto
<Texto propuesto o descripción precisa del cambio.>
```

## Qué pasa después

El **orchestrator** del repo `GdesProject` lee periódicamente los `changes_proposals/` de todos los subrepos, aplica las propuestas aprobadas en `template/`, las marca como `aplicada` (o `rechazada` con motivo) y propaga el template con `scripts/sync-template.sh`. Así todos los repos reciben el mismo cambio y no hay desincronización.

Este directorio (`docs/changes_proposals/`) es de escritura local; solo el `README.md` es SYNCED.
