import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { ApiException } from '../errors/api.exception';

export interface AuthenticatedUser {
  id: string;
  role: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

/**
 * Skeleton guard (F-001). F-002 (auth) will verify the JWT signature/claims
 * and populate `request.user`. For now it always rejects: no endpoint is
 * protected yet, and any accidental use fails closed.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;

    // TODO(F-002): verify JWT with JWT_ACCESS_SECRET and populate request.user.
    void header;

    throw new ApiException(
      HttpStatus.UNAUTHORIZED,
      'INVALID_TOKEN',
      'Token de autenticación ausente o inválido',
    );
  }
}
