import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, RegistrationChallenge } from '@prisma/client';
import { randomInt } from 'node:crypto';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppProvider } from '../notifications/notifications.service';
import { PasswordPolicyService } from '../users/password-policy.service';
import { registrationInput, validation } from './auth-advanced.validation';
import { AuthLinksService } from './auth-links.service';
import { AuthService, failure } from './auth.service';

const RETENTION_MS = 72 * 3600_000;
type Profile = ReturnType<typeof registrationInput>['profile'];
@Injectable()
export class AuthRegistrationService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
    private readonly policy: PasswordPolicyService,
    private readonly whatsapp: WhatsAppProvider,
    private readonly links: AuthLinksService,
  ) {}
  async onModuleInit(): Promise<void> {
    await this.purge();
    this.timer = setInterval(() => {
      void this.purge().catch(() => undefined);
    }, 60_000);
    this.timer.unref();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
  async purge(): Promise<void> {
    await this.db.registrationChallenge.updateMany({
      where: {
        createdAt: { lte: new Date(Date.now() - RETENTION_MS) },
        NOT: { payload: { equals: Prisma.DbNull } },
      },
      data: { payload: Prisma.DbNull },
    });
  }
  private code(): string {
    return String(randomInt(1000000)).padStart(6, '0');
  }
  async has(id: string): Promise<boolean> {
    return !!(await this.db.registrationChallenge.findUnique({
      where: { id },
      select: { id: true },
    }));
  }
  private async unique(tx: Prisma.TransactionClient, profile: Profile) {
    const found = await tx.user.findMany({
      where: {
        OR: [
          { email: { equals: profile.email, mode: 'insensitive' } },
          { employeeId: profile.employeeId },
          { dni: profile.dni },
        ],
      },
    });
    if (found.some((u) => u.email.trim().toLowerCase() === profile.email))
      throw failure(409, 'USER_ALREADY_EXISTS', 'El usuario ya existe');
    if (found.some((u) => u.employeeId === profile.employeeId))
      throw failure(409, 'EMPLOYEE_ID_ALREADY_EXISTS', 'El legajo ya existe');
    if (found.some((u) => u.dni === profile.dni))
      throw failure(409, 'DNI_ALREADY_EXISTS', 'El DNI ya existe');
  }
  async register(value: unknown, ip: string) {
    const { profile, password } = registrationInput(value, this.policy);
    await this.auth.limit('register-ip', ip, 100);
    const identityHash = this.auth.hash('register-identity:' + profile.email);
    await this.auth.limit('register-identity', identityHash, 10);
    await this.purge();
    if (!(await this.db.site.findUnique({ where: { id: profile.siteId } }))) validation();
    await this.unique(this.db, profile);
    const passwordHash = await argon2.hash(password);
    const code = this.code();
    const c = await this.db.registrationChallenge.create({
      data: {
        identityHash,
        payload: { ...profile, birthDate: profile.birthDate.toISOString(), passwordHash },
        codeHash: this.auth.hash('registration-otp:' + code),
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    await this.whatsapp.sendOtp({ phone: profile.phone, code });
    return { otpRequired: true, challengeId: c.id };
  }
  private usable(c: RegistrationChallenge) {
    if (c.consumedAt) return failure(401, 'INVALID_OTP', 'Código inválido');
    if (c.createdAt.getTime() + RETENTION_MS <= Date.now())
      return failure(410, 'OTP_EXPIRED', 'El código venció');
    if (!c.payload) return failure(401, 'INVALID_OTP', 'Código inválido');
    if (c.attempts >= 5) return failure(429, 'TOO_MANY_ATTEMPTS', 'Demasiados intentos');
    return null;
  }
  async verify(id: string, code: string, ip: string) {
    await this.auth.limit('verify-ip', ip, 200);
    const initial = await this.db.registrationChallenge.findUniqueOrThrow({ where: { id } });
    await this.auth.limit('registration-verify-identity', initial.identityHash, 20);
    const result = await this.db
      .$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "RegistrationChallenge" WHERE "id"=${id}::uuid FOR UPDATE`;
        const c = await tx.registrationChallenge.findUniqueOrThrow({ where: { id } });
        const error = this.usable(c);
        if (error) return { error };
        if (c.expiresAt.getTime() <= Date.now())
          return { error: failure(410, 'OTP_EXPIRED', 'El código venció') };
        if (!this.auth.equal(c.codeHash, this.auth.hash('registration-otp:' + code))) {
          await tx.registrationChallenge.update({
            where: { id },
            data: { attempts: { increment: 1 } },
          });
          return {
            error: failure(
              c.attempts === 4 ? 429 : 401,
              c.attempts === 4 ? 'TOO_MANY_ATTEMPTS' : 'INVALID_OTP',
              'Código inválido',
            ),
          };
        }
        const p = c.payload as Prisma.JsonObject;
        const profile = {
          firstName: p.firstName as string,
          lastName: p.lastName as string,
          email: p.email as string,
          phone: p.phone as string,
          employeeId: p.employeeId as string,
          dni: p.dni as string,
          address: p.address as string,
          siteId: p.siteId as string,
          birthDate: new Date(p.birthDate as string),
        };
        await this.unique(tx, profile);
        // Site/key waits must not allow an OTP to outlive its deadline during insertion.
        await tx.$queryRaw`SELECT "id" FROM "Site" WHERE "id"=${profile.siteId}::uuid FOR KEY SHARE`;
        if (c.expiresAt.getTime() <= Date.now())
          return { error: failure(410, 'OTP_EXPIRED', 'El código venció') };
        const user = await tx.user.create({
          data: {
            ...profile,
            passwordHash: p.passwordHash as string,
            role: 'EMPLOYEE',
            emailVerifiedAt: null,
          },
        });
        if (c.expiresAt.getTime() <= Date.now())
          throw failure(410, 'OTP_EXPIRED', 'El código venció');
        await tx.registrationChallenge.update({
          where: { id },
          data: { consumedAt: new Date(), payload: Prisma.DbNull },
        });
        await this.links.queueVerification(tx, user);
        if (c.expiresAt.getTime() <= Date.now())
          throw failure(410, 'OTP_EXPIRED', 'El código venció');
        return { value: true };
      })
      .catch(async (error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const p = initial.payload as Prisma.JsonObject;
          await this.unique(this.db, p as unknown as Profile);
        }
        throw error;
      });
    if (result.error) throw result.error;
    return { emailVerificationRequired: true };
  }
  async resend(id: string, ip: string) {
    await this.auth.limit('resend-ip', ip, 50);
    const initial = await this.db.registrationChallenge.findUniqueOrThrow({ where: { id } });
    await this.auth.limit('registration-resend-identity', initial.identityHash, 5);
    const code = this.code();
    const phone = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "RegistrationChallenge" WHERE "id"=${id}::uuid FOR UPDATE`;
      const c = await tx.registrationChallenge.findUniqueOrThrow({ where: { id } });
      const error = this.usable(c);
      if (error) throw error;
      if (c.sentAt.getTime() + 60_000 > Date.now())
        throw failure(429, 'OTP_RESEND_COOLDOWN', 'Esperá antes de reenviar');
      await tx.registrationChallenge.update({
        where: { id },
        data: {
          codeHash: this.auth.hash('registration-otp:' + code),
          sentAt: new Date(),
          expiresAt: new Date(Math.min(Date.now() + 600_000, c.createdAt.getTime() + RETENTION_MS)),
        },
      });
      return (c.payload as Prisma.JsonObject).phone as string;
    });
    await this.whatsapp.sendOtp({ phone, code });
    return { sent: true };
  }
}
