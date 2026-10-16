# Corpus local de contraseñas

Fuente: Daniel Miessler / SecLists, `Passwords/Common-Credentials/10k-most-common.txt`.
Commit: `21537beae7465102a3ebbedea6a7852a0cbcb3c4`.
URL: https://github.com/danielmiessler/SecLists/blob/21537beae7465102a3ebbedea6a7852a0cbcb3c4/Passwords/Common-Credentials/10k-most-common.txt
SHA-256 del archivo original: `68782d6a4a19a4768d5f15dd66bd534e7a33055cc755411e33f16d18c50fdcce`.
Licencia MIT y atribución en LICENSE, conservadas con el corpus en Docker.

La política consulta este archivo local al arrancar; no hace consultas externas. Para detección compara NFKC/lowercase/trim y variantes con sufijos de números/símbolos. El hash Argon2 conserva la contraseña original, incluidos espacios y Unicode. La longitud se mide en puntos de código Unicode (12–128). Este corpus de contraseñas comunes conocidas no cubre todas las filtraciones.
