---
name: requesting-code-review
description: APAGADA en este repo — la revisión la hace el rol reviewer del harness. Ver docs/convenciones/superpowers.md.
---

# Skill apagada por el harness

En este repo NO se usa `requesting-code-review`: la revisión de código la hace el rol `reviewer`, despachado por el leader según `docs/convenciones/flujo-de-trabajo.md`.

- Si sos el **leader** y una implementación está lista: despachá al `reviewer` con la plantilla de prompt de `flujo-de-trabajo.md`.
- Si sos el **implementer**: no pedís reviews ni te autoaprobás; devolvés el handoff al leader.

El veredicto se registra en `progress/reviewer/current.md` y en la sección "Review" del task spec — no en chats efímeros.
