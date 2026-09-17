---
name: subagent-driven-development
description: APAGADA en este repo — el ciclo leader→implementer→reviewer del harness ya cubre ese flujo. Ver docs/convenciones/superpowers.md.
---

# Skill apagada por el harness

En este repo NO se usa `subagent-driven-development`: el ciclo leader → implementer → reviewer de `docs/convenciones/flujo-de-trabajo.md` ya cubre ese flujo, con roles y estado en disco propios (`feature_list.json`, `progress/`, `docs/tasks/`).

- Si sos el **leader**: despachá implementer/reviewer según `flujo-de-trabajo.md`. Para trabajo paralelo coordinado, usá `dispatching-parallel-agents`.
- Si sos **implementer** o **reviewer**: no despachás subagentes, nunca.

No uses el workspace `.superpowers/sdd/` ni sus scripts: el estado del trabajo vive en `progress/` y `docs/tasks/`.
