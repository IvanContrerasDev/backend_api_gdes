<!-- SYNCED-FROM-TEMPLATE: gestionado desde GdesProject/template/. NO EDITAR en este repo; proponé cambios en docs/changes_proposals/. -->

# Convenciones globales del sistema GdeS

## Idioma

- Toda la documentación se escribe en **español**.
- Código, identificadores, rutas y mensajes de commit en inglés (salvo que el repo ya use otra convención — la convención local manda).

## Archivos y nombres

- Archivos Markdown y directorios en **kebab-case**: `contratos-api.md`, `vision-sistema.md`.
- Task specs: `docs/tasks/NNN-slug.md` donde `NNN` es correlativo con padding de 3 dígitos y `slug` describe la feature (ej. `001-login-con-backend-real.md`). El número coincide con el `id` de la feature en `feature_list.json` (`F-001` → `001-...`).

## Commits

- Formato: `<tipo>(<alcance>): <descripción en imperativo>` — tipos: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`.
- Alcance: `mobile`, `admin`, `backend` o `harness`.
- Los commits los ejecuta el humano o un agente SOLO con confirmación explícita del humano.

## Documentación de trabajo

- Cada agente documenta en `progress/<su-rol>/current.md` MIENTRAS trabaja: qué hizo, qué está haciendo, blockers.
- Al cerrar una tarea, el leader mueve el contenido relevante a `history.md` (append-only) y resetea `current.md`.
- Si una tarea cambia una convención, un contrato o una decisión de arquitectura, la tarea no está terminada hasta reflejarla: si es un doc local, se actualiza; si es un archivo común (SYNCED), se deja la propuesta en `docs/changes_proposals/`.

## Conocimiento común (SYNCED)

- Los archivos marcados `SYNCED-FROM-TEMPLATE` vienen del template del repo `GdesProject` y son **de solo lectura** en este repo.
- Cambios al conocimiento común: se proponen en `docs/changes_proposals/` y el orchestrator los aplica en el template y los propaga a todos los repos.
- Lo que el repo documente en su propio `docs/` (fuera de los archivos SYNCED) es fuente de verdad PARA ESA app; los contratos ENTRE apps viven en `docs/arquitectura/contratos-api.md` y mandan sobre supuestos locales.
