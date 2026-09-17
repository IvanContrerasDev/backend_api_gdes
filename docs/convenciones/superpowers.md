<!-- SYNCED-FROM-TEMPLATE: gestionado desde GdesProject/template/. NO EDITAR en este repo; proponé cambios en docs/changes_proposals/. -->

# Superpowers: skills del plugin y cómo conviven con este harness

El plugin `superpowers` está instalado a nivel de usuario, así que sus skills están disponibles en TODAS las sesiones de este repo. Este documento define cuáles se usan, quién las usa y bajo qué reglas.

**Precedencia:** las reglas de este repo (`AGENTS.md`, `docs/`) ganan sobre cualquier skill — el propio plugin lo reconoce explícitamente. Si una skill manda hacer algo prohibido acá (commitear, despachar subagentes propios, escribir en `docs/superpowers/`), no se hace.

## Skills adoptadas

### Leader

- **brainstorming** — para diseñar una feature nueva. El spec resultante se guarda como task spec en `docs/tasks/NNN-slug.md` siguiendo `docs/tasks/TEMPLATE.md` — NUNCA en `docs/superpowers/specs/`. Sin commits automáticos.
- **writing-plans** — para el plan de implementación de una feature compleja. El plan se guarda en `docs/tasks/NNN-slug-plan.md`, junto a su spec — NUNCA en `docs/superpowers/plans/`. Sin commits automáticos.
- **dispatching-parallel-agents** — criterio para despachar varios implementers en paralelo (ver la regla de paralelismo en `flujo-de-trabajo.md`).

### Implementer

- **test-driven-development** — ciclo red-green-refactor cuando el task spec lo pida o el repo tenga suite de tests.
- **systematic-debugging** — ante cualquier bug o test fallando: root cause antes que fix.
- **verification-before-completion** — nunca declarar `done` sin evidencia fresca (tests/build corriendo OK).
- **receiving-code-review** — al procesar un veredicto `cambios requeridos` del reviewer: verificar antes de implementar, pushback técnico si corresponde.

### Reviewer

- **verification-before-completion** — el veredicto se emite solo con evidencia de verificación real (tests/builds corridos, no suposiciones).

## Skills apagadas (stubs en `.agents/skills/`)

Estas skills duplican roles del harness o violan sus reglas. Hay un stub con el mismo nombre en `.agents/skills/` de este repo (scope Project, que pisa al plugin): si la invocás, el stub te redirige al flujo correcto.

| Skill apagada | Por qué | Qué se usa en su lugar |
|---|---|---|
| `subagent-driven-development` | Es un harness leader→implementer→reviewer completo: duplicaría la autoridad del leader | El ciclo de `flujo-de-trabajo.md` |
| `requesting-code-review` | Duplica al reviewer del harness | El rol `reviewer` |
| `finishing-a-development-branch` | Hace merge/push/PR por defecto | El humano decide la integración (regla git) |
| `using-git-worktrees` | Crea worktrees/branches/commits por defecto | La branch que indica el leader, con confirmación del humano |

## Reglas transversales

1. Ninguna skill escribe en `docs/superpowers/` ni `.superpowers/`: los artefactos van a `docs/tasks/` (specs y planes) o a `progress/` (estado de trabajo).
2. Ninguna mutación git que sugiera una skill se ejecuta sin confirmación explícita del humano.
3. Si una skill pide despachar subagentes, solo el leader puede hacerlo, y solo con los roles del harness (implementer, reviewer, explore, plan).
