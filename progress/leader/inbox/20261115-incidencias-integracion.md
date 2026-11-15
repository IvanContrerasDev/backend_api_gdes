# Lecturas de todos los roles, identidad y feedback de contraseña

## Objetivo y evidencia

El humano confirmó listar/consultar todos los roles y mantener edición/desactivación solo para EMPLOYEE. `src/modules/users/users.service.ts` restringe list/detail/profile a EMPLOYEE; mutaciones también lo restringen. El DTO actual no incluye role. La omisión del administrador es comportamiento implementado que debe ajustarse al requisito confirmado.

`auth-advanced.validation.ts:strongPassword` captura todo rechazo de PasswordPolicyService y lo transforma en 422 VALIDATION_ERROR. El servicio rechaza variantes con números/símbolos finales de términos de su lista común; la variante reportada satisface el rango actual de longitud, pero su base está en la lista. No almacenar ni reproducir en archivos la contraseña reportada. La propuesta Mobile de feedback se consolida en el contrato común; implementación pendiente.

`admin-access.service.ts:verify` lanza ADMIN_REQUEST_IDENTITY_CONFLICT tras OTP si DNI/legajo pertenecen a otro UUID o no coinciden con la cuenta encontrada por email. El error no demuestra OTP inválido; falta contrastar el caso real. No se consultó DB manual.

## Trabajo a planificar

1. Extender GET /users y GET /users/:id a todos los roles, agregar role de solo lectura según contrato; mantener alta EMPLOYEE y mutaciones restringidas en servidor. GET /profile Mobile conserva EMPLOYEE. Combinar con siteId previamente acordado, búsqueda/estado y total/paginación; no ampliar selectores de empleados ni métricas por accidente. Rechazar intentos de mutar cuentas no EMPLOYEE sin alterar datos, sesiones o rol.
2. Preservar 400 WEAK_PASSWORD en alta/reset con mensaje español por motivo (rango frente a común/variante), envelope vigente y retryable=false. Coordinar 8–30 ya acordado; no debilitar lista ni cambiar secreto. VALIDATION_ERROR se reserva para fallos genéricos. Solicitud administrativa conserva neutralidad antes de OTP y contraseña actual compatible para existentes; cuenta nueva informa política tras verificación. Entregar pruebas de cada vía y el contrato de error efectivo al consumidor por archivo.
3. Reproducir conflicto con fixtures aisladas: identidad nueva única, empleado existente con mismos email/DNI/legajo y contraseña actual, email igual con DNI/legajo discrepantes, DNI/legajo de otra cuenta, discrepancias no identitarias y cambios concurrentes. Inspeccionar normalización y payload ligado al challenge, no eliminar unicidades ni fusionar cuentas. El conflicto legítimo recibe mensaje recuperable acordado tras OTP, sin revelar identidad ajena. Si no se reproduce el caso humano, declarar el límite y pedir solo evidencia mínima por canal adecuado, sin guardar password/OTP/token/PII. No borrar ni resetear DB del usuario para hacer pasar el flujo.
4. Apoyar recorrido Mobile DEV → API/DB/storage → Admin DEV: confirmar IDs/estado/archivos y persistencia; distinguir ausencia de request (Mobile mock) de escritura fallida o filtro de lectura. Preservar B-02/B-04 y Q-01 abiertos, incluida contingencia null/atribución no resuelta. No afirmar causa backend de datos inexistentes por mocks.

## Dependencias y aceptación

Backend precede al nuevo role/alcance de Admin y feedback específico; Mobile completa M-04/M-06 y DEV/DEMO. Evidencia aislada de todos los roles/permisos, contraseña y matriz de identidad antes de review independiente; después prueba real Android/Admin con mismos IDs y bytes, recarga/recreación API sin borrar volúmenes. Ninguna suite aislada certifica por sí sola el incidente humano o el recorrido físico.

## Coordinación

Fuente común: `docs/arquitectura/contratos-api.md` (Empleados, feedback de contraseña, solicitud administrativa y aceptación entre consumidores) y `docs/arquitectura/experiencia-usuario.md`. Requisitos acordados pendientes de implementación; evidencia estática no certifica el entorno de la prueba. Este inbox complementa `20261115-mejoras-integracion-*`, no cancela sus pendientes ni la política 8–30.

El leader incorpora la instrucción al backlog/specs propios, reutiliza features existentes y mantiene dependencias y revisión independiente. No se crean tasks desde GdesProject ni se modifican estados/aprobaciones. No Git sin confirmación, no tocar DB manual ni resetear cuentas/volúmenes. Consolidar evidencia vigente en docs locales antes de retirar inbox resuelto.
