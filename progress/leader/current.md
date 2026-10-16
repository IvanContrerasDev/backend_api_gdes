# Estado actual — leader

Sin feature in_progress. Auth base, estructura y empleados/perfil están done y aprobados; evidencia vigente consolidada en docs/03–04. Commits locales autorizados en feature/implement_mvp; nunca push. Cambio previo docs/01 preferencias preservado fuera de commits.

Verificación final: build/lint y38/38 pruebas HTTP/PostgreSQL (auth14, estructura8, users16), imagen gdes-f004-review:local construida y corpus/licencia/Argon2 verificados. Producción bloqueada deliberadamente hasta providers reales F-008; tres avisos altos conocidos en Prisma/config local, alcance en01.

F-005 conserva estado pending (no se inició código). Spec/plan preparados; única pregunta humana pendiente: salida offline anterior a entrada abierta se conserva SEMI_CLOSED/PENDING o se rechaza INVALID_TIMESTAMP. Decisiones de tiempo vigentes en05: online servidor; offline hora original + hora actual del teléfono al sincronizar, máximo adelanto2min; ventana24h y orden de recepción. Propuestas comunes de auth/asistencia siguen pendientes de incorporación/sync; no editadas copias SYNCED.

Limpieza completada: Docker gdes-api reanudado (paused=false, running=true), PostgreSQL usuario running=true, contenedor exclusivo gdes-f003-test detenido/eliminado. No se modificó DB del usuario. README documenta instalación/generación/migraciones y actualización del volumen de dependencias para ejecutar la nueva versión. No se afirma que el contenedor anterior ya tenga las nuevas migraciones/dependencias aplicadas.
