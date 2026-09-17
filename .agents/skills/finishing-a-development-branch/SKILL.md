---
name: finishing-a-development-branch
description: APAGADA en este repo — la integración (merge/push/PR) la decide el humano. Ver docs/convenciones/superpowers.md.
---

# Skill apagada por el harness

En este repo NO se usa `finishing-a-development-branch`: hace merge, push, PRs y limpieza de branches por defecto, y acá **ninguna mutación git se hace sin confirmación explícita del humano**.

Cuando una feature queda aprobada por el reviewer:

1. El leader marca `done` en `feature_list.json` y archiva el estado en `progress/`.
2. El leader le avisa al humano que la feature está lista para integrar.
3. El humano decide si se mergea, se pushea o se abre PR, y cuándo.
