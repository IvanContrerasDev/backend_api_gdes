<!-- SYNCED-FROM-TEMPLATE: gestionado desde GdesProject/template/. NO EDITAR en este repo; proponé cambios en docs/changes_proposals/. -->

# Flujo de trabajo: leader → implementer → reviewer

## Roles en una frase

- **Leader**: planifica, descompone, delega, coordina. Nunca escribe código.
- **Implementer**: implementa UNA feature por sesión. Nunca se autoaprueba.
- **Reviewer**: revisa contra spec + docs + contratos. Nunca edita código.

## Ciclo de una feature

### 1. Leader — preparación

1. Toma la feature `pending` de `feature_list.json`.
2. Crea el task spec `docs/tasks/NNN-slug.md` desde `docs/tasks/TEMPLATE.md`. Si para escribirlo necesita entender código, despacha `explore` o lee directamente — pero el spec lo escribe él.
3. Si el spec revela un vacío o contradicción en las docs → FRENA y consulta al humano (registrar la pregunta en `progress/leader/current.md`).
4. Marca la feature `in_progress` en `feature_list.json`.
5. Despacha UN implementer con un prompt que incluye: path del task spec, paths de docs relevantes, recordatorio de leer sus skills y de documentar en `progress/implementer/current.md`.

### 2. Implementer — ejecución

1. Lee el task spec completo, las docs referenciadas y sus skills (`.agents/skills/`).
2. Si el spec es ambiguo o contradice las docs → NO improvisa: lo registra en `progress/implementer/current.md` bajo "Blockers / Preguntas" y devuelve `blocked` al leader.
3. Implementa. Mientras trabaja, appendea progreso en `progress/implementer/current.md`.
4. Al terminar: completa "Resultado final" en su `current.md` (archivos tocados, decisiones, cómo verificar) y la sección "Registro de implementación" del task spec. Devuelve al leader SOLO: `{ task_spec, progress_file, status }`.

### 3. Leader — revisión

Despacha al `reviewer` con: path del task spec, paths de `docs/arquitectura/` y las docs locales relevantes.

### 4. Reviewer — veredicto

Verifica, en este orden:
1. **Criterios de aceptación** del task spec (todos, uno por uno).
2. **Coherencia con docs**: definiciones y specs del repo, convenciones globales.
3. **Integración entre apps**: los contratos de `docs/arquitectura/contratos-api.md` se respetan de forma directa (mismos nombres, tipos, endpoints). Nada de "compatible más o menos".

Registra en `progress/reviewer/current.md` y en la sección "Review" del task spec:
- Veredicto: `aprobado` | `cambios requeridos`
- Si es `cambios requeridos`: lista accionable numerada, cada ítem con archivo y motivo.

Devuelve al leader SOLO: `{ task_spec, veredicto, n_items, progress_file }`.

### 5. Cierre o corrección

- **Cambios requeridos** → el leader re-despacha al implementer con el feedback (nueva ronda; el reviewer registra cada ronda en el task spec).
- **Aprobado** → el leader: marca `done` en `feature_list.json`, archiva `current.md` → `history.md` en los roles involucrados, y verifica que las docs quedaron actualizadas. Si la decisión nueva afecta un archivo común (SYNCED), NO lo edita: deja la propuesta en `docs/changes_proposals/`.

## Plantillas de prompt para despachar

### Al implementer

```
Implementa la tarea definida en docs/tasks/NNN-slug.md.
Docs relevantes: <lista de paths>.
Antes de escribir código: lee tus skills en .agents/skills/ y las docs del repo.
Documenta tu progreso en progress/implementer/current.md MIENTRAS trabajas.
Si el spec es ambiguo o contradice las docs, NO inventes: devolvé status "blocked" con la pregunta.
Al terminar devolvé SOLO: task_spec, progress_file, status (done|blocked).
```

### Al reviewer

```
Revisá la implementación de docs/tasks/NNN-slug.md.
Verificá: criterios de aceptación, coherencia con <docs relevantes>, e integración según docs/arquitectura/contratos-api.md.
Podés correr tests/builds, pero NO editás código.
Registrá el veredicto en progress/reviewer/current.md y en la sección Review del task spec.
Devolvé SOLO: task_spec, veredicto (aprobado|cambios requeridos), n_items, progress_file.
```

## Reglas transversales

- **Paralelismo coordinado**: por defecto, una feature `in_progress` a la vez en `feature_list.json` y un implementer por tarea. El leader PUEDE despachar varios implementers en paralelo cuando las tareas son independientes (archivos y estado disjuntos, sin dependencias entre sí) — cada una con su propio task spec y su feature `in_progress`. El leader acota el scope de cada tarea en el prompt de despacho y nunca asigna el mismo archivo a dos agentes.
- **Skills superpowers**: se usan según `docs/convenciones/superpowers.md` (adoptadas por rol; las conflictivas están apagadas con stubs en `.agents/skills/`).
- Preguntas conceptuales o de exploración (lectura pura): el leader responde directo, sin subagentes.
- Nada de mutaciones git sin confirmación del humano.
- Los archivos marcados `SYNCED-FROM-TEMPLATE` son de solo lectura en este repo: los cambios se proponen en `docs/changes_proposals/` y los aplica/propaga el orchestrator de GdesProject.
