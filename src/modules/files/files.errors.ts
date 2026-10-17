import { ApiException } from '../../common/errors/api.exception';
export function invalidFileData(message = 'Los datos del archivo no son válidos'): never {
  throw new ApiException(422, 'VALIDATION_ERROR', message);
}
export function fileTypeError(): never {
  throw new ApiException(
    422,
    'FILE_TYPE_NOT_ALLOWED',
    'El contenido o la extensión del archivo no están permitidos',
  );
}
export function notFound(): never {
  throw new ApiException(404, 'NOT_FOUND', 'El archivo no existe');
}
