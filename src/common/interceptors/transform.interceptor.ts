import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

/**
 * Wraps every successful response in `{ data: ... }` (docs/07-convenciones.md).
 * Controllers return the plain payload; list endpoints may return
 * `{ data: [...], pagination }`-shaped objects from their services.
 */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<{ data: unknown }> {
    return next.handle().pipe(map((payload: unknown) => ({ data: payload ?? null })));
  }
}
