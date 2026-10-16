# Pruebas HTTP y PostgreSQL

La suite arranca el proceso real `dist/main.js`, firma JWT con un secret exclusivo de pruebas y usa guards y PostgreSQL reales. No emite tokens desde endpoints ni sustituye autorización. Requiere Node 24 y PostgreSQL 16 con `unaccent` disponible.

Usar únicamente una base dedicada cuyo nombre sea `gdes_f003_test`. La suite rechaza otro nombre, no ejecuta resets y elimina solo fixtures de su ejecución; migración/seed son pasos explícitos. No reutilizar credenciales ni bases de producción.

Ejemplo local reproducible (puerto PostgreSQL 55433 y API 33443 libres):

```bash
docker run --rm -d --name gdes-f003-test \
  -e POSTGRES_PASSWORD=f003-test -e POSTGRES_DB=gdes_f003_test \
  -p 127.0.0.1:55433:5432 postgres:16-alpine
# Esperar a que pg_isready confirme disponibilidad.
docker exec gdes-f003-test pg_isready -U postgres
DATABASE_URL=postgresql://postgres:f003-test@localhost:55433/gdes_f003_test npm run prisma:deploy
DATABASE_URL=postgresql://postgres:f003-test@localhost:55433/gdes_f003_test npm run prisma:seed
npm run prisma:generate
TEST_DATABASE_URL=postgresql://postgres:f003-test@localhost:55433/gdes_f003_test npm test
npm run lint
# Cuando ninguna otra revisión necesite la base:
docker stop gdes-f003-test
```

`npm test` compila antes de ejecutar todos los archivos `test/*.e2e.cjs`. El contenedor no monta volúmenes, y se elimina al detenerlo. La suite requiere que el seed de seis provincias esté aplicado.

La migración de estructura usa índices PostgreSQL por expresión para garantizar unicidad normalizada de clientes y lugares incluso con requests concurrentes. Esos índices se conservan en SQL porque Prisma no expresa índices por función. La búsqueda usa `unaccent` sin quitar acentos del nombre almacenado; la unicidad normaliza mayúsculas y espacios.
