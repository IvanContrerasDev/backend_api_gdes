import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthClient, AuthSession, OtpPurpose, Prisma, User } from '@prisma/client';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailProvider, WhatsAppProvider } from '../notifications/notifications.service';
import { LoginDto } from './auth.dto';
export const failure = (status: number, code: string, message: string) =>
  new ApiException(status, code, message);
export const invalid = () => failure(401, 'INVALID_TOKEN', 'Sesión ausente o inválida');
type Tx = Prisma.TransactionClient;
@Injectable()
export class AuthService {
  constructor(
    readonly db: PrismaService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly email: EmailProvider,
    private readonly whatsapp: WhatsAppProvider,
  ) {}
  private readonly dummyHash = argon2.hash(randomBytes(32));
  random(): string {
    return randomBytes(32).toString('base64url');
  }
  hash(value: string): string {
    return createHmac('sha256', this.config.getOrThrow<string>('JWT_REFRESH_SECRET'))
      .update(value)
      .digest('hex');
  }
  csrf(secret: string): string {
    return this.hash('csrf:' + secret);
  }
  equal(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }
  checkUser(user: User, client: AuthClient, role?: string): void {
    if (user.accountStatus !== 'ACTIVE')
      throw failure(403, 'ACCOUNT_INACTIVE', 'La cuenta está desactivada');
    if (role && user.role !== role) throw invalid();
    if (client === 'ADMIN' && user.role === 'TO_BE_ADMIN')
      throw failure(
        403,
        'ADMIN_ACCESS_PENDING',
        'Su solicitud de acceso administrativo se encuentra pendiente de aprobación.',
      );
    if (
      client === 'MOBILE' ? user.role !== 'EMPLOYEE' : !['ADMIN', 'SUPER_ADMIN'].includes(user.role)
    )
      throw failure(403, 'ROLE_NOT_ALLOWED', 'Rol no permitido');
    if (client === 'MOBILE' && !user.emailVerifiedAt)
      throw failure(403, 'EMAIL_NOT_VERIFIED', 'Debés verificar tu email');
  }
  async limit(namespace: string, key: string, max: number, seconds = 600): Promise<void> {
    const rows = await this.db.$queryRaw<
      { count: number }[]
    >`INSERT INTO "AuthRateLimit" ("key","count","resetsAt") VALUES (${this.hash(namespace + ':' + key)},1,NOW()+${seconds}*INTERVAL '1 second') ON CONFLICT ("key") DO UPDATE SET "count"=CASE WHEN "AuthRateLimit"."resetsAt"<=NOW() THEN 1 ELSE "AuthRateLimit"."count"+1 END,"resetsAt"=CASE WHEN "AuthRateLimit"."resetsAt"<=NOW() THEN NOW()+${seconds}*INTERVAL '1 second' ELSE "AuthRateLimit"."resetsAt" END RETURNING "count"`;
    if (rows[0].count > max)
      throw failure(429, 'TOO_MANY_ATTEMPTS', 'Demasiados intentos. Intentá más tarde');
  }
  async login(input: LoginDto, ip: string, preauth?: string) {
    const identifier = input.identifier.trim();
    await this.limit('login-ip', ip, 100);
    await this.limit('login-id', input.client + ':' + identifier.toLowerCase(), 10);
    const candidates = await this.db.user.findMany({
      take: 2,
      where: {
        OR: [
          { email: { equals: identifier.toLowerCase(), mode: 'insensitive' } },
          { employeeId: identifier },
        ],
      },
    });
    const user = candidates.length === 1 ? candidates[0] : undefined;
    let valid = false;
    try {
      valid = await argon2.verify(user?.passwordHash ?? (await this.dummyHash), input.password);
    } catch {
      valid = false;
    }
    if (!user || !valid) throw failure(401, 'INVALID_CREDENTIALS', 'Credenciales inválidas');
    this.checkUser(user, input.client);
    return this.createChallenge(
      user,
      input.client,
      input.client === 'MOBILE' ? 'LOGIN' : 'ADMIN_2FA',
      preauth,
      input.rememberSession ?? false,
    );
  }
  destinationHash(user: User, client: AuthClient): string {
    return this.hash(
      'otp-destination:' +
        (client === 'ADMIN'
          ? user.email.trim().toLowerCase()
          : user.email.trim().toLowerCase() + ':' + user.phone),
    );
  }
  async createChallenge(
    user: User,
    client: AuthClient,
    purpose: OtpPurpose,
    preauth?: string,
    rememberSession = false,
  ) {
    await this.limit('challenge-user', user.id + client, 10);
    const code = String(randomInt(1000000)).padStart(6, '0');
    const challenge = await this.db.authChallenge.create({
      data: {
        userId: user.id,
        credentialVersion: user.credentialVersion,
        destinationHash: this.destinationHash(user, client),
        client: client,
        purpose,
        codeHash: this.hash('otp:' + code),
        preauthHash: preauth ? this.hash(preauth) : null,
        rememberSession: rememberSession,
        expiresAt: new Date(Date.now() + 600000),
      },
    });
    if (client === 'ADMIN')
      await this.email.sendEmail({
        to: user.email,
        subject: 'Código de acceso GdeS',
        html: `<p>Tu código de acceso es <strong>${code}</strong>. Vence en 10 minutos.</p>`,
      });
    else await this.whatsapp.sendOtp({ phone: user.phone, code });
    return client === 'ADMIN'
      ? { twoFactorRequired: true, challengeId: challenge.id }
      : { otpRequired: true, challengeId: challenge.id };
  }
  async verify(id: string, code: string, client: AuthClient, ip: string, preauth?: string) {
    await this.limit('verify-ip', ip, 200);
    const initial = await this.db.authChallenge.findUnique({ where: { id } });
    if (
      !initial ||
      initial.client !== client ||
      !(client === 'MOBILE'
        ? ['LOGIN', 'GOOGLE_LOGIN'].includes(initial.purpose)
        : initial.purpose === 'ADMIN_2FA')
    )
      throw failure(401, 'INVALID_OTP', 'Código inválido');
    if (client === 'ADMIN' && (!preauth || initial.preauthHash !== this.hash(preauth)))
      throw failure(400, 'BAD_REQUEST', 'Verificación CSRF inválida');
    await this.limit('verify-user', initial.userId + client, 20);
    const result = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "AuthChallenge" WHERE "id"=${id}::uuid FOR UPDATE`;
      const c = await tx.authChallenge.findUniqueOrThrow({ where: { id } });
      if (
        c.client !== client ||
        !(client === 'MOBILE'
          ? ['LOGIN', 'GOOGLE_LOGIN'].includes(c.purpose)
          : c.purpose === 'ADMIN_2FA') ||
        (client === 'ADMIN' && (!preauth || c.preauthHash !== this.hash(preauth)))
      )
        return { error: failure(401, 'INVALID_OTP', 'Código inválido') };
      if (c.consumedAt) return { error: failure(401, 'INVALID_OTP', 'Código inválido') };
      if (c.attempts >= 5)
        return { error: failure(429, 'TOO_MANY_ATTEMPTS', 'Demasiados intentos') };
      if (c.expiresAt.getTime() <= Date.now())
        return { error: failure(410, 'OTP_EXPIRED', 'El código venció') };
      if (!this.equal(c.codeHash, this.hash('otp:' + code))) {
        await tx.authChallenge.update({ where: { id }, data: { attempts: { increment: 1 } } });
        return {
          error: failure(
            c.attempts === 4 ? 429 : 401,
            c.attempts === 4 ? 'TOO_MANY_ATTEMPTS' : 'INVALID_OTP',
            'Código inválido',
          ),
        };
      }
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${c.userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: c.userId } });
      this.checkUser(user, client);
      if (
        c.credentialVersion !== user.credentialVersion ||
        c.destinationHash !== this.destinationHash(user, client)
      )
        return { error: failure(401, 'INVALID_OTP', 'Código inválido') };
      // Account-lock waits may outlive the OTP checked before acquiring that lock.
      const consumedAt = new Date();
      if (c.expiresAt.getTime() <= consumedAt.getTime())
        return { error: failure(410, 'OTP_EXPIRED', 'El código venció') };
      await tx.authChallenge.update({ where: { id }, data: { consumedAt } });
      const session = await tx.authSession.create({
        data: {
          userId: user.id,
          role: user.role,
          client,
          csrfSecret: this.random(),
          rememberSession: c.rememberSession,
          expiresAt: new Date(Date.now() + 604800000),
        },
      });
      return { value: await this.issue(tx, session, user) };
    });
    if (result.error) throw result.error;
    return result.value!;
  }
  async issue(tx: Tx, session: AuthSession, user: User, generation = 0) {
    const refreshToken = this.random();
    await tx.authRefreshToken.create({
      data: {
        hash: this.hash(refreshToken),
        sessionId: session.id,
        generation,
        expiresAt: session.expiresAt,
      },
    });
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role, type: 'access', sid: session.id },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        algorithm: 'HS256',
        expiresIn: 1800,
      },
    );
    return {
      session,
      refreshToken,
      response: { user: this.publicUser(user), tokens: { accessToken, expiresIn: 1800 } },
    };
  }
  publicUser(user: User) {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      employeeId: user.employeeId,
      role: user.role,
    };
  }
  async session(token: string, client: AuthClient, allowUsed = false) {
    const t = await this.db.authRefreshToken.findUnique({
      where: { hash: this.hash(token) },
      include: { session: { include: { user: true } } },
    });
    if (
      !t ||
      t.session.client !== client ||
      (!allowUsed && t.usedAt) ||
      t.expiresAt.getTime() <= Date.now() ||
      t.session.revokedAt ||
      t.session.expiresAt.getTime() <= Date.now()
    )
      throw invalid();
    this.checkUser(t.session.user, client, t.session.role);
    return t;
  }
  async rotate(token: string, client: AuthClient) {
    const hash = this.hash(token);
    const initial = await this.db.authRefreshToken.findUnique({
      where: { hash },
      include: { session: true },
    });
    if (!initial || initial.session.client !== client) throw invalid();
    const result = await this.db.$transaction(async (tx) => {
      // Global order: account before session, matching deactivation/revocation.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${initial.session.userId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "AuthSession" WHERE "id"=${initial.sessionId}::uuid FOR UPDATE`;
      const t = await tx.authRefreshToken.findUniqueOrThrow({
        where: { hash },
        include: { session: true },
      });
      const s = t.session;
      if (s.client !== client) return { error: invalid() };
      if (t.usedAt || s.revokedAt) {
        await tx.authSession.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
        return {
          error: failure(401, 'REFRESH_TOKEN_REUSED', 'La sesión debe iniciarse nuevamente'),
        };
      }
      if (t.expiresAt.getTime() <= Date.now() || s.expiresAt.getTime() <= Date.now())
        return { error: invalid() };
      const user = await tx.user.findUniqueOrThrow({ where: { id: s.userId } });
      try {
        this.checkUser(user, client, s.role);
      } catch (e) {
        await tx.authSession.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
        return { error: e as ApiException };
      }
      await tx.authRefreshToken.update({ where: { hash }, data: { usedAt: new Date() } });
      const activeSession =
        client === 'MOBILE'
          ? await tx.authSession.update({
              where: { id: s.id },
              data: { expiresAt: new Date(Date.now() + 604800000) },
            })
          : s;
      return { value: await this.issue(tx, activeSession, user, t.generation + 1) };
    });
    if (result.error) throw result.error;
    return result.value!;
  }
  async logoutSession(id: string) {
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "AuthSession" WHERE "id"=${id}::uuid FOR UPDATE`;
      await tx.authSession.update({ where: { id }, data: { revokedAt: new Date() } });
    });
  }
  async resend(id: string, ip: string) {
    await this.limit('resend-ip', ip, 50);
    const initial = await this.db.authChallenge.findUnique({ where: { id } });
    if (
      !initial ||
      initial.client !== 'MOBILE' ||
      !['LOGIN', 'GOOGLE_LOGIN'].includes(initial.purpose)
    )
      throw failure(401, 'INVALID_OTP', 'Challenge inválido');
    await this.limit('resend-user', initial.userId, 5);
    const code = String(randomInt(1000000)).padStart(6, '0');
    const user = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "AuthChallenge" WHERE "id"=${id}::uuid FOR UPDATE`;
      const c = await tx.authChallenge.findUniqueOrThrow({ where: { id } });
      if (
        c.client !== 'MOBILE' ||
        !['LOGIN', 'GOOGLE_LOGIN'].includes(c.purpose) ||
        c.consumedAt ||
        c.attempts >= 5
      )
        throw failure(401, 'INVALID_OTP', 'Challenge inválido');
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${c.userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: c.userId } });
      this.checkUser(user, 'MOBILE');
      if (
        c.credentialVersion !== user.credentialVersion ||
        c.destinationHash !== this.destinationHash(user, 'MOBILE')
      )
        throw failure(401, 'INVALID_OTP', 'Challenge inválido');
      if (c.sentAt.getTime() + 60000 > Date.now())
        throw failure(429, 'OTP_RESEND_COOLDOWN', 'Esperá antes de reenviar');
      await tx.authChallenge.update({
        where: { id },
        data: {
          codeHash: this.hash('otp:' + code),
          sentAt: new Date(),
          expiresAt: new Date(Date.now() + 600000),
        },
      });
      return user;
    });
    await this.whatsapp.sendOtp({ phone: user.phone, code });
    return { sent: true };
  }
}
