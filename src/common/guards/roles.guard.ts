import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { ApiException } from '../errors/api.exception';
import { AuthenticatedRequest } from './jwt-auth.guard';

/**
 * Skeleton guard (F-001). Reads the roles declared via `@Roles(...)` and
 * checks them against `request.user.role` (populated by `JwtAuthGuard`).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user || !requiredRoles.includes(user.role)) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'ROLE_NOT_ALLOWED',
        'No tenés permisos para acceder a este recurso',
      );
    }

    return true;
  }
}
