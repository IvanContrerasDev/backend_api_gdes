# Estado actual — leader

Sin tarea in_progress. F-001 bootstrap cerrada; implementación real y decisiones en docs/01-arquitectura-y-stack.md. Diseño vigente consolidado en docs/01–07; contratos comunes en docs/arquitectura/contratos-api.md. No hubo implementación de producto en la auditoría documental.

Pendientes para preparar próximos dispatches:
- F-002: JWT funcional y roles UserRole; política contraseña P-06 (12–128, espacios/Unicode, sin composición obligatoria). Acotar infraestructura F-002 frente a proveedores F-008 antes de dispatch; login público sin bypass de OTP/2FA.
- F-003: PUT completo clients/workplaces y P-07 (03), no PATCH legado. Task y criterios documentales alineados con contrato común; estados de features preservados.
- Docker: ejecutar docker compose up --build y health; imágenes production aún sin validación ejecutada.
- P-02: proponer generación de sesión/CSRF y ratificar; cerrar dominios/cookies/CORS/fallback con pruebas reales. Reenvío 2FA admin/logout offline requieren precisión.
- F-006: confirmar DTO detalle/eventos (03), contradicción reviewStatus de intervalo con MANUAL_LOADED; ejemplos de metadata y eventos fuera de orden. P-01: collation, implementación/costo snapshot y ejemplos bisiesto/31 días/mixtos/cero filas/dos páginas/concurrencia.
- Offline: error ATTENDANCE_EVENT_TOO_OLD materializado para >24 h; faltan implementación y pruebas exactamente 24 h/+1 ms. Futuro/clock skew sigue sin definición humana.
- Confirmar TTL magic link de email mobile (24 h en diseño, pregunta aún abierta). F-010 requiere evidencia API real y navegadores, no mocks.

Ninguna autorización git pasada se interpreta como vigente. Sin mutaciones git.
