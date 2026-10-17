import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthEmailIntent, AuthLink, AuthLinkPurpose, Prisma, User } from '@prisma/client';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailProvider } from '../notifications/notifications.service';
import { PasswordPolicyService } from '../users/password-policy.service';
import { AuthService, failure, invalid } from './auth.service';
import { strongPassword } from './auth-advanced.validation';

@Injectable()
export class AuthLinksService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private pending?: Promise<void>;
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
    private readonly email: EmailProvider,
    private readonly policy: PasswordPolicyService,
  ) {}

  private secret(purpose: AuthLinkPurpose): string {
    return createHmac('sha256', this.config.getOrThrow<string>('JWT_REFRESH_SECRET'))
      .update('gdes:auth-link:sign:' + purpose)
      .digest('hex');
  }
  private hash(purpose: AuthLinkPurpose, token: string): string {
    return this.auth.hash('gdes:auth-link:hash:' + purpose + ':' + token);
  }
  async create(tx: Prisma.TransactionClient, user: User, purpose: AuthLinkPurpose) {
    const id = randomUUID();
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + (purpose === 'EMAIL_VERIFICATION' ? 86400 : 3600);
    const token = await this.sign({
      id,
      userId: user.id,
      purpose,
      credentialVersion: user.credentialVersion,
      createdAt: new Date(iat * 1000),
      expiresAt: new Date(exp * 1000),
    });
    const row = await tx.authLink.create({
      data: {
        id,
        userId: user.id,
        purpose,
        hash: this.hash(purpose, token),
        emailHash: this.auth.hash('link-email:' + user.email.trim().toLowerCase()),
        credentialVersion: user.credentialVersion,
        createdAt: new Date(iat * 1000),
        expiresAt: new Date(exp * 1000),
      },
    });
    return { token, row };
  }
  private enqueue(
    tx: Prisma.TransactionClient,
    email: string,
    purpose: AuthLinkPurpose,
    link?: AuthLink,
  ) {
    return tx.authEmailIntent.create({
      data: {
        namespace: this.namespace(),
        emailCiphertext: this.encrypt(email),
        purpose,
        linkId: link?.id,
        expiresAt:
          link?.expiresAt ??
          new Date(Date.now() + (purpose === 'PASSWORD_RESET' ? 3600000 : 86400000)),
      },
    });
  }
  async queueVerification(tx: Prisma.TransactionClient, user: User): Promise<void> {
    const { row } = await this.create(tx, user, 'EMAIL_VERIFICATION');
    await this.enqueue(tx, user.email, 'EMAIL_VERIFICATION', row);
  }
  private sign(
    row: Pick<
      AuthLink,
      'id' | 'userId' | 'purpose' | 'credentialVersion' | 'createdAt' | 'expiresAt'
    >,
  ): Promise<string> {
    return this.jwt.signAsync(
      {
        sub: row.userId,
        jti: row.id,
        purpose: row.purpose,
        version: row.credentialVersion,
        iat: row.createdAt.getTime() / 1000,
        exp: row.expiresAt.getTime() / 1000,
      },
      {
        secret: this.secret(row.purpose),
        algorithm: 'HS256',
        issuer: 'gdes',
        audience: 'gdes-auth-link',
      },
    );
  }
  private namespace(): string {
    return createHmac('sha256', this.encryptionKey())
      .update(
        JSON.stringify({
          origin: this.config.get('API_PUBLIC_URL'),
          admin: this.config.get('ADMIN_FRONTEND_URL'),
          provider: this.config.get('EMAIL_PROVIDER'),
          from: this.config.get('EMAIL_FROM'),
        }),
      )
      .digest('hex');
  }
  private fence(intent: AuthEmailIntent) {
    return {
      id: intent.id,
      namespace: this.namespace(),
      attempts: intent.attempts,
      completedAt: null,
      lockedUntil: { gt: new Date() },
      expiresAt: { gt: new Date() },
    };
  }
  private encryptionKey(): Buffer {
    return createHmac('sha256', this.config.getOrThrow<string>('JWT_REFRESH_SECRET'))
      .update('gdes:auth-email-intent:v1')
      .digest();
  }
  private encrypt(email: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(email, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), ciphertext]
      .map((value) => value.toString('base64url'))
      .join('.');
  }
  private decrypt(value: string): string {
    const [iv, tag, ciphertext] = value.split('.').map((x) => Buffer.from(x, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
  async onModuleInit(): Promise<void> {
    await this.cleanup();
    this.timer = setInterval(() => this.kick(), 250);
    this.timer.unref();
  }
  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.pending) await this.pending;
  }
  private kick(): void {
    if (this.running) return;
    this.running = true;
    this.pending = this.drain()
      .catch(() => undefined)
      .finally(() => {
        this.running = false;
      });
  }
  private async cleanup(): Promise<void> {
    await this.db.authEmailIntent.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  }
  async request(email: string, purpose: AuthLinkPurpose, ip: string): Promise<{ sent: true }> {
    await this.auth.limit('link-ip:' + purpose, ip, 100);
    await this.auth.limit('link-email:' + purpose, email, 5);
    // Same response path for every address. No identity lookup or network await here.
    await this.enqueue(this.db, email, purpose);
    this.kick();
    return { sent: true };
  }
  private async claim(): Promise<AuthEmailIntent | null> {
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT "id" FROM "AuthEmailIntent" WHERE "namespace"=${this.namespace()} AND "completedAt" IS NULL AND "nextAttemptAt"<=NOW() AND ("lockedUntil" IS NULL OR "lockedUntil"<=NOW()) AND "expiresAt">NOW() AND "attempts"<3 ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!rows[0]) return null;
      return tx.authEmailIntent.update({
        where: { id: rows[0].id },
        data: {
          lockedUntil: new Date(Date.now() + 60000),
          attempts: { increment: 1 },
        },
      });
    });
  }
  async drain(): Promise<void> {
    await this.cleanup();
    for (let index = 0; index < 20; index++) {
      const intent = await this.claim();
      if (!intent) return;
      try {
        const email = this.decrypt(intent.emailCiphertext);
        const initial = await this.db.user.findFirst({
          where: { email: { equals: email, mode: 'insensitive' } },
        });
        const result = initial
          ? await this.db.$transaction(async (tx) => {
              await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${initial.id}::uuid FOR UPDATE`;
              await tx.$queryRaw`SELECT "id" FROM "AuthEmailIntent" WHERE "id"=${intent.id}::uuid FOR UPDATE`;
              const current = await tx.authEmailIntent.findFirst({ where: this.fence(intent) });
              if (!current) return 'stale' as const;
              const user = await tx.user.findUniqueOrThrow({ where: { id: initial.id } });
              if (
                user.email.trim().toLowerCase() !== email ||
                user.accountStatus !== 'ACTIVE' ||
                (intent.purpose === 'EMAIL_VERIFICATION' &&
                  (user.role !== 'EMPLOYEE' || user.emailVerifiedAt))
              )
                return null;
              if (!current.linkId) {
                const { row: link } = await this.create(tx, user, intent.purpose);
                await tx.authEmailIntent.update({
                  where: { id: intent.id },
                  data: { linkId: link.id },
                });
                return link;
              }
              const link = await tx.authLink.findUniqueOrThrow({ where: { id: current.linkId } });
              if (
                link.consumedAt ||
                link.expiresAt.getTime() <= Date.now() ||
                link.credentialVersion !== user.credentialVersion ||
                link.emailHash !== this.auth.hash('link-email:' + email)
              )
                return null;
              return link;
            })
          : null;
        if (result === 'stale') continue;
        if (result) {
          const token = await this.sign(result);
          if (this.hash(result.purpose, token) !== result.hash)
            throw new Error('Invalid link metadata');
          const verification = result.purpose === 'EMAIL_VERIFICATION';
          const url = new URL(
            verification ? '/api/v1/auth/email/verify' : '/password-reset',
            this.config.getOrThrow<string>(verification ? 'API_PUBLIC_URL' : 'ADMIN_FRONTEND_URL'),
          );
          url.searchParams.set('token', token);
          await this.email.sendEmail({
            to: email,
            subject: verification ? 'Confirmá tu email en GdeS' : 'Restablecé tu contraseña GdeS',
            html: `<p>${verification ? 'Confirmá tu email. El enlace vence en 24 horas.' : 'El enlace vence en una hora. Si no lo solicitaste, ignorá este correo.'}</p><a href="${url.href}">${verification ? 'Confirmar email' : 'Restablecer contraseña'}</a>`,
            idempotencyKey: 'auth-link/' + intent.id,
          });
        }
        await this.db.authEmailIntent.updateMany({
          where: this.fence(intent),
          data: { completedAt: new Date(), lockedUntil: null },
        });
      } catch {
        // Persist a bounded retry without storing upstream error details or a bearer token.
        await this.db.authEmailIntent.updateMany({
          where: this.fence(intent),
          data: {
            lockedUntil: null,
            nextAttemptAt: new Date(Date.now() + 1000 * 2 ** (intent.attempts - 1)),
          },
        });
      }
    }
  }
  private async lookup(token: string, purpose: AuthLinkPurpose) {
    let claims: Record<string, unknown>;
    try {
      claims = await this.jwt.verifyAsync<Record<string, unknown>>(token, {
        secret: this.secret(purpose),
        algorithms: ['HS256'],
        issuer: 'gdes',
        audience: 'gdes-auth-link',
        ignoreExpiration: true,
      });
    } catch {
      throw invalid();
    }
    if (
      claims.purpose !== purpose ||
      typeof claims.jti !== 'string' ||
      !isUUID(claims.jti) ||
      typeof claims.sub !== 'string' ||
      !isUUID(claims.sub) ||
      typeof claims.exp !== 'number' ||
      !Number.isFinite(claims.exp)
    )
      throw invalid();
    const row = await this.db.authLink.findUnique({ where: { hash: this.hash(purpose, token) } });
    if (
      !row ||
      row.id !== claims.jti ||
      row.userId !== claims.sub ||
      row.purpose !== purpose ||
      claims.version !== row.credentialVersion ||
      claims.exp * 1000 !== row.expiresAt.getTime()
    )
      throw invalid();
    return row;
  }
  async verifyEmail(token: string): Promise<void> {
    const initial = await this.lookup(token, 'EMAIL_VERIFICATION');
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${initial.userId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "AuthLink" WHERE "id"=${initial.id}::uuid FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: initial.userId } });
      const row = await tx.authLink.findUniqueOrThrow({ where: { id: initial.id } });
      if (
        row.consumedAt ||
        row.credentialVersion !== user.credentialVersion ||
        row.emailHash !== this.auth.hash('link-email:' + user.email.trim().toLowerCase())
      )
        throw invalid();
      if (row.expiresAt.getTime() <= Date.now())
        throw failure(410, 'TOKEN_EXPIRED', 'El enlace venció');
      if (user.accountStatus !== 'ACTIVE')
        throw failure(403, 'ACCOUNT_INACTIVE', 'La cuenta está desactivada');
      await tx.authLink.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
      if (!user.emailVerifiedAt)
        await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    });
  }
  async reset(token: string, newPassword: unknown): Promise<{ updated: true }> {
    const initial = await this.lookup(token, 'PASSWORD_RESET');
    const passwordHash = await argon2.hash(strongPassword(newPassword, this.policy));
    await this.db.$transaction(async (tx) => {
      // Never lock Challenge while holding User: verify owns Challenge before User.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${initial.userId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "AuthLink" WHERE "id"=${initial.id}::uuid FOR UPDATE`;
      const row = await tx.authLink.findUniqueOrThrow({ where: { id: initial.id } });
      const user = await tx.user.findUniqueOrThrow({ where: { id: initial.userId } });
      if (
        row.consumedAt ||
        row.credentialVersion !== user.credentialVersion ||
        row.emailHash !== this.auth.hash('link-email:' + user.email.trim().toLowerCase())
      )
        throw invalid();
      if (row.expiresAt.getTime() <= Date.now())
        throw failure(410, 'TOKEN_EXPIRED', 'El enlace venció');
      if (user.accountStatus !== 'ACTIVE')
        throw failure(403, 'ACCOUNT_INACTIVE', 'La cuenta está desactivada');
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, credentialVersion: { increment: 1 } },
      });
      await tx.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.authLink.updateMany({
        where: { userId: user.id, purpose: 'PASSWORD_RESET', consumedAt: null },
        data: { consumedAt: new Date() },
      });
    });
    return { updated: true };
  }
}
