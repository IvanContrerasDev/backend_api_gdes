import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

const RETRYABLE_STATUSES = new Set([
  HttpStatus.TOO_MANY_REQUESTS,
  HttpStatus.INTERNAL_SERVER_ERROR,
  HttpStatus.BAD_GATEWAY,
  HttpStatus.SERVICE_UNAVAILABLE,
  HttpStatus.GATEWAY_TIMEOUT,
]);

/**
 * Fallback error codes per HTTP status, from the catalog in docs/07-convenciones.md.
 * Feature code should prefer throwing `ApiException` with an explicit code.
 */
const DEFAULT_CODE_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'INVALID_TOKEN',
  [HttpStatus.FORBIDDEN]: 'ROLE_NOT_ALLOWED',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'VALIDATION_ERROR',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_ATTEMPTS',
};

const DEFAULT_MESSAGE_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'Solicitud inválida',
  [HttpStatus.UNAUTHORIZED]: 'No autorizado',
  [HttpStatus.FORBIDDEN]: 'Acceso denegado',
  [HttpStatus.NOT_FOUND]: 'Recurso no encontrado',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Error de validación en los datos enviados',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Demasiados intentos, probá más tarde',
};

/**
 * Framework-generated messages (e.g. "Cannot GET /x") are in English;
 * user-facing messages must be Spanish (docs/07-convenciones.md), so the
 * filter replaces them with the Spanish default for the status.
 */
function isFrameworkMessage(message: string): boolean {
  return /^Cannot [A-Z]+ /.test(message);
}

/**
 * Global exception filter: every error leaves the API as
 * `{ error: { code, message, retryable } }` (docs/07-convenciones.md).
 * `message` is user-facing, in Spanish.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const body = this.buildBody(exception, status);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json(body);
  }

  private buildBody(exception: unknown, status: number): ErrorBody {
    let code = DEFAULT_CODE_BY_STATUS[status] ?? 'INTERNAL_ERROR';
    let message =
      status >= HttpStatus.INTERNAL_SERVER_ERROR
        ? 'Error interno del servidor'
        : (DEFAULT_MESSAGE_BY_STATUS[status] ?? 'Error inesperado');

    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === 'object' && response !== null) {
        const payload = response as Record<string, unknown>;
        if (typeof payload.code === 'string') {
          code = payload.code;
        }
        if (typeof payload.message === 'string' && !isFrameworkMessage(payload.message)) {
          message = payload.message;
        }
      } else if (typeof response === 'string' && response.length > 0) {
        if (!isFrameworkMessage(response)) {
          message = response;
        }
      }
    }

    return {
      error: {
        code,
        message,
        retryable: RETRYABLE_STATUSES.has(status),
      },
    };
  }
}
