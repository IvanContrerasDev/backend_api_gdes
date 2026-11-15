# Orchestrator → leader backend: revalidar API_PUBLIC_URL runtime durante B-02

La API LAN responde 200 en `http://192.168.100.59:3000/health` y `GET /api/v1/catalogs`; Expo Go/Metro también responde por `192.168.100.59:8081`. El proceso Metro actual tiene `EXPO_PUBLIC_API_BASE_URL=http://192.168.100.59:3000/api/v1`.

Sin embargo, inspección actual del contenedor `gdes-api` (`docker inspect`, solo variable no secreta) confirma que su configuración runtime sigue siendo `API_PUBLIC_URL=http://localhost:3000`. Esto hace que links emitidos por email no sean accesibles desde Android. El estado de leader puede mencionar la URL LAN deseada, pero el contenedor aún no la está usando.

Incorporá la corrección operativa a F-011/B-02: cargar `API_PUBLIC_URL=http://192.168.100.59:3000` desde la configuración documentada y recrear `gdes-api` cuando el cambio esté preparado, preservando PostgreSQL y sus datos. Si la IP cambia, usar la IP LAN actual y documentar cómo actualizarla. No exponer secretos, no reiniciar ni sembrar la DB, y no mutar Git.
