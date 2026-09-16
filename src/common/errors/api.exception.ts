import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Domain/API exception carrying an explicit error code from the catalog
 * (docs/07-convenciones.md). `message` must be in Spanish (user-facing).
 */
export class ApiException extends HttpException {
  constructor(
    status: HttpStatus,
    public readonly code: string,
    message: string,
  ) {
    super({ code, message }, status);
  }
}
