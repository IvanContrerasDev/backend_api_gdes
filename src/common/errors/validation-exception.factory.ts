import { HttpStatus, ValidationError } from '@nestjs/common';
import { ApiException } from './api.exception';

function flattenMessages(errors: ValidationError[], parent = ''): string[] {
  return errors.flatMap((error) => {
    const property = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map(
      (message) => `${property}: ${message}`,
    );
    const children = error.children?.length ? flattenMessages(error.children, property) : [];
    return [...own, ...children];
  });
}

/**
 * Turns class-validator errors into the uniform 422 VALIDATION_ERROR payload.
 * Message in Spanish per docs/07-convenciones.md.
 */
export function validationExceptionFactory(errors: ValidationError[]): ApiException {
  const details = flattenMessages(errors);
  const message =
    details.length > 0
      ? `Error de validación: ${details.join('; ')}`
      : 'Error de validación en los datos enviados';
  return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', message);
}
