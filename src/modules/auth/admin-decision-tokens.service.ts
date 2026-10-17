import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import { AuthService, invalid } from './auth.service';
export interface AdminDecisionMetadata {
  userId: string;
  requestId: string;
  generation: number;
  jti: string;
  iat: number;
  exp: number;
}
@Injectable()
export class AdminDecisionTokensService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
  ) {}
  private secret() {
    return createHmac('sha256', this.config.getOrThrow<string>('JWT_REFRESH_SECRET'))
      .update('gdes:admin-decision:sign:v1')
      .digest('hex');
  }
  hash(token: string) {
    return this.auth.hash('gdes:admin-decision:hash:' + token);
  }
  metadata(userId: string, requestId: string, generation: number): AdminDecisionMetadata {
    const iat = Math.floor(Date.now() / 1000);
    return { userId, requestId, generation, jti: randomUUID(), iat, exp: iat + 604800 };
  }
  sign(meta: AdminDecisionMetadata): Promise<string> {
    return this.jwt.signAsync(
      {
        sub: meta.userId,
        rid: meta.requestId,
        jti: meta.jti,
        generation: meta.generation,
        purpose: 'ADMIN_DECISION',
        iat: meta.iat,
        exp: meta.exp,
      },
      { secret: this.secret(), algorithm: 'HS256', issuer: 'gdes', audience: 'gdes-admin-access' },
    );
  }
  async verify(token: string): Promise<AdminDecisionMetadata> {
    let claims: Record<string, unknown>;
    try {
      claims = await this.jwt.verifyAsync(token, {
        secret: this.secret(),
        algorithms: ['HS256'],
        issuer: 'gdes',
        audience: 'gdes-admin-access',
        ignoreExpiration: true,
      });
    } catch {
      throw invalid();
    }
    if (
      claims.purpose !== 'ADMIN_DECISION' ||
      typeof claims.sub !== 'string' ||
      !isUUID(claims.sub) ||
      typeof claims.rid !== 'string' ||
      !isUUID(claims.rid) ||
      typeof claims.jti !== 'string' ||
      !isUUID(claims.jti) ||
      !Number.isSafeInteger(claims.generation) ||
      Number(claims.generation) < 1 ||
      typeof claims.iat !== 'number' ||
      !Number.isSafeInteger(claims.iat) ||
      typeof claims.exp !== 'number' ||
      !Number.isSafeInteger(claims.exp)
    )
      throw invalid();
    return {
      userId: claims.sub,
      requestId: claims.rid,
      jti: claims.jti,
      generation: Number(claims.generation),
      iat: claims.iat,
      exp: claims.exp,
    };
  }
}
