import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { googleInput } from './auth-advanced.validation';
import { AuthService, failure } from './auth.service';
import { GoogleIdentityService } from './google-identity.service';

@Injectable()
export class AuthGoogleService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
    private readonly google: GoogleIdentityService,
  ) {}
  async login(value: unknown, ip: string) {
    const input = googleInput(value);
    await this.auth.limit('google-ip', ip, 100);
    const email = (await this.google.verify(input.idToken)).trim().toLowerCase();
    await this.auth.limit('google-email', email, 10);
    const user = await this.db.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (!user) throw failure(404, 'USER_NOT_FOUND', 'Usuario no encontrado');
    this.auth.checkUser(user, 'MOBILE');
    return this.auth.createChallenge(user, 'MOBILE', 'GOOGLE_LOGIN');
  }
}
