# Archivos — ajustes ratificados por humano

Pendiente de incorporación/sync por orchestrator. Destino: contrato común Archivos y métricas; no editar SYNCED localmente.

Decisiones humanas explícitas:
- GET /catalogs público, únicamente provincias value/label y tipos fijos de ausencia/documento; sin empleados/clientes/lugares. Necesario antes de iniciar sesión para obtener siteId en registro.
- Upload móvil conserva timesheetIds/documentIds y message; admin devuelve created con objetos completos.
- Descarga incluye downloadUrl más expiresAt ISO UTC, firma15min.
- Catálogo usa INTERNAL_RULES (Normas internas), como backend; alinear mock INTERNAL_POLICIES.
- Reemplazo conserva id/empleado/lugar/período/secuencia y uploader/fecha originales, vuelve status PENDING, registra reemplazante y exige expectedVersion; falla nueva carga preserva archivo previo.
- Congelar clientId/siteId de Workplace también cuando tiene planillas, además de registros; nombres/geometría editables.

Motivo: concurrencia y auditoría explícitas, soporte a móvil y admin y preservación de la atribución provincial de planillas/métricas. Especificación HTTP técnica en docs03 al consolidar F007; todavía no afirmar implementación disponible.

Publicación técnica: DTOs completos/query/orden/multipart en docs03; errores409 FILE_VERSION_CONFLICT y503 STORAGE_UNAVAILABLE retryable. Borrado físico recuperable mediante journal persistido por destino; publicación visible atómica, consistencia física eventual ante fallo de proveedor. Incorporar al común tras cierre/review, sin editar copiaSYNCED.
