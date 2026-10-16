import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AccountStatus, UserRole } from '@prisma/client';
import { isUUID } from 'class-validator';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../errors/api.exception';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
}
export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const match = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? '');
    const invalid = () =>
      new ApiException(
        HttpStatus.UNAUTHORIZED,
        'INVALID_TOKEN',
        'Token de autenticación ausente o inválido',
      );
    if (!match) throw invalid();
    let claims: Record<string, unknown>;
    try {
      claims = await this.jwt.verifyAsync<Record<string, unknown>>(match[1], {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        algorithms: ['HS256'],
      });
    } catch {
      throw invalid();
    }
    if (
      claims.type !== 'access' ||
      typeof claims.sub !== 'string' ||
      !isUUID(claims.sub) ||
      typeof claims.role !== 'string' ||
      !Object.values(UserRole).includes(claims.role as UserRole) ||
      typeof claims.exp !== 'number' ||
      !Number.isFinite(claims.exp)
    )
      throw invalid();
    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      select: { id: true, role: true, accountStatus: true },
    });
    if (!user || user.role !== claims.role) throw invalid();
    if (user.accountStatus !== AccountStatus.ACTIVE)
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'ACCOUNT_INACTIVE',
        'La cuenta está desactivada',
      );
    request.user = { id: user.id, role: user.role };
    return true;
  }
}
