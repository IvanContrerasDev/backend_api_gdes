<!-- SYNCED-FROM-TEMPLATE: gestionado desde GdesProject/template/. NO EDITAR en este repo; proponé cambios en docs/changes_proposals/. -->

# Propuestas temporales de cambio común

Los archivos SYNCED se gestionan desde `GdesProject/template/`. Este directorio solo contiene propuestas **pendientes**; su README es una copia SYNCED.

## Crear

Archivo `YYYYMMDD-slug.md` con origen, estado pendiente, documento/sección canónica de destino, problema actual, cambio preciso y motivo breve. Separar lo que requiere decisión de lo ya acordado; enlazar el contrato o código en vez de copiarlo. No atribuir aprobación a un mock.

## Resolver y eliminar

1. El orchestrator contrasta evidencia y decisiones humanas; consulta únicamente los puntos que sigan abiertos.
2. Incorpora lo aprobado al documento canónico en `template/` (y coordina detalle local cuando corresponda), reemplazando la definición anterior y dejando el motivo breve. No guardar la propuesta como fuente alternativa del contrato.
3. Ejecuta `scripts/sync-template.sh push` y `scripts/sync-template.sh --check`; revisa coherencia y enlaces de los tres repos.
4. Tras verificar incorporación y sincronización, **elimina la propuesta resuelta** y actualiza sus referencias hacia la sección oficial. No conservar archivos `aplicada`, `rechazada`, copias o archivos históricos.
5. Si solo se resuelve una parte, reducir la propuesta a los puntos abiertos con enlace a la definición oficial; eliminar preguntas ya contestadas. Una negativa se comunica al solicitante y solo su regla vigente y motivo útil quedan en el documento correspondiente.

El trabajo de implementación pendiente se mantiene en backlog/estado actual; no justifica conservar una propuesta ya incorporada.
