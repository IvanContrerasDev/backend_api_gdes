import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { isEmail } from 'class-validator';
import { failure } from './auth.service';

export abstract class GoogleTokenVerifier {
  abstract verifyIdToken(options: {
    idToken: string;
    audience: string;
  }): Promise<{ getPayload(): TokenPayload | undefined }>;
}
export function googleTokenVerifier(): GoogleTokenVerifier {
  return new OAuth2Client({ issuers: ['accounts.google.com', 'https://accounts.google.com'] });
}
@Injectable()
export class GoogleIdentityService {
  constructor(
    private readonly config: ConfigService,
    private readonly verifier: GoogleTokenVerifier,
  ) {}
  async verify(idToken: string): Promise<string> {
    try {
      const audience = this.config.getOrThrow<string>('GOOGLE_CLIENT_ID');
      const ticket = await this.verifier.verifyIdToken({ idToken, audience });
      const p = ticket.getPayload();
      if (
        !p ||
        p.aud !== audience ||
        !['accounts.google.com', 'https://accounts.google.com'].includes(p.iss) ||
        typeof p.exp !== 'number' ||
        !Number.isFinite(p.exp) ||
        p.exp <= Date.now() / 1000 ||
        p.email_verified !== true ||
        typeof p.email !== 'string' ||
        !isEmail(p.email.trim()) ||
        !p.sub
      )
        throw new Error();
      return p.email.trim().toLowerCase();
    } catch {
      // SDK errors can embed the bearer token. Never propagate/log them or their cause.
      throw failure(401, 'INVALID_GOOGLE_TOKEN', 'El token de Google no es válido');
    }
  }
}
