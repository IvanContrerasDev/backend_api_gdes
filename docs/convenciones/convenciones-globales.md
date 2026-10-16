<!-- SYNCED-FROM-TEMPLATE: gestionado desde GdesProject/template/. NO EDITAR en este repo; proponé cambios en docs/changes_proposals/. -->

# Convenciones globales del sistema GdeS

## Idioma y nombres

Documentación e interfaz en español; código, campos y rutas en inglés. Markdown y directorios en kebab-case. Task specs: `docs/tasks/NNN-slug.md`, con número de feature (`F-001` → `001-...`).

## Documentación vigente y centralizada

- Cada tema tiene un documento canónico: decisión actual y motivo breve en la sección correspondiente. Al cambiar una decisión se reemplaza el texto anterior; no se agrega una cronología, changelog, acta ni ADR paralelo.
- Los contratos entre apps pertenecen a `docs/arquitectura/contratos-api.md`; las specs locales enlazan ese contrato. El detalle exclusivamente interno pertenece al doc local de su tema. Las copias SYNCED son réplicas administradas de una única fuente, no decisiones independientes.
- Para describir comportamiento real o resolver ambigüedad documental, inspeccionar código, esquema y tests e indicar los paths relevantes. Distinguir **implementado**, **mock**, **acordado pendiente de implementación** y **pendiente de decisión**. El código existente no aprueba requisitos nuevos ni anula una decisión explícita aún no implementada: registrar la brecha en el mismo tema. Consultar solo lo que la evidencia y las decisiones vigentes no resuelvan.
- `progress/<rol>/current.md` se actualiza mientras se trabaja y contiene solo objetivo/estado actual, pendientes, bloqueos y evidencia necesaria para el siguiente paso. Se reemplaza, no se appendea. No crear `history.md`, informes por ronda ni diarios de actividad.
- Tasks, planes e inbox son temporales. Al cerrar, incorporar requisitos, decisiones y motivo a sus documentos canónicos, conservar estado de feature en `feature_list.json`, reemplazar referencias a tareas cerradas por su documentación canónica y eliminar artefactos resueltos. Mantener únicamente tareas activas/bloqueadas y evidencia vigente de revisión hasta su cierre. No borrar pendientes para reducir archivos.
- Propuestas comunes: ciclo y eliminación en `docs/changes_proposals/README.md`. Eliminar solo después de consolidar contenido útil y verificar propagación; una propuesta pendiente no representa una decisión aprobada.

Motivo: el siguiente agente debe encontrar una sola definición vigente por tema sin reconstruir conversaciones o comparar decisiones obsoletas.

## Conocimiento común (SYNCED)

Los archivos marcados `SYNCED-FROM-TEMPLATE` son de solo lectura en subrepos. Los cambios se proponen en `docs/changes_proposals/`; el orchestrator modifica `GdesProject/template/`, propaga con `scripts/sync-template.sh push` y verifica con `scripts/sync-template.sh --check`. No editar la copia local para evitar una propuesta.

## Git

Ninguna mutación git sin confirmación explícita del humano, tampoco si una skill o un leader la sugiere. Commits autorizados: `<tipo>(<alcance>): <descripción en imperativo>`; tipos `feat|fix|docs|chore|refactor|test`, alcances `mobile|admin|backend|harness`. Instalación de skills solo con confirmación humana.
