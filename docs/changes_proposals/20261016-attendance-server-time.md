# Asistencia: hora del servidor y excepción offline

Origen: decisión humana explícita en esta sesión backend. Estado: pendiente de consolidación común y sync. Destino: contrato común, Asistencia/Eventos y proyección.

Online: hora efectiva asignada por servidor. Offline: request con hora original de marcación y hora actual del teléfono al restablecer conexión; esta última no puede adelantarse más de dos minutos al servidor. Conservar receivedAt del servidor y la procedencia de occurredAt offline. Procesar por orden de recepción, sin reconstrucción por hora cliente. La aclaración mantiene flujo offline, no exige conexión siempre. Se conserva ventana offline24h del acuerdo previo, no retirada por el humano.

Detalle vigente en docs/05-asistencia-eventos-y-registros.md. Humano ratificó que una salida anterior al último OPEN por recepción queda nuevo SEMI_CLOSED, mantiene entrada OPEN y marca registro PENDING, sin trabajo negativo ni reconstrucción. El DTO técnico implementado se publica en03/05. Comprobación del reloj actual no certifica hora original. La presencia de clientSentAt distingue offline y exige occurredAt; su ausencia usa hora efectiva online del servidor, sin imponer límite simétrico al atraso ni producir trabajo negativo por suposición.

Motivo: hora del servidor para flujo online, manteniendo cola offline según aclaración humana. No editar copia SYNCED ni retirar propuesta sin incorporación y sync verificado.
