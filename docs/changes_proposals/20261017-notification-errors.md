# Notificaciones — error público y configuración real

Pendiente de incorporación/sync por orchestrator. Destino contrato común Autenticación/catálogo de errores.

Publicar503 NOTIFICATION_UNAVAILABLE, retryable=true y mensaje español sin datos upstream; endpoints auth no emiten tokens por un fallo de notificación. Adaptadores Resend/Meta por configuración, log solo dev/test. Meta sin retry automático en fallo ambiguo; reenvío explícito mantiene cooldown60s. Resend retries con Idempotency-Key y cuerpo estables. Aceptación de proveedor no equivale a entrega. Detalle técnico local en06. No se realizaron envíos reales ni se certificó despliegue.
