import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AdminAccessChallenge, Prisma, User } from '@prisma/client';
import { randomInt, randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailProvider } from '../notifications/notifications.service';
import { PasswordPolicyService } from '../users/password-policy.service';
import { adminAccessInput } from './admin-access.validation';
import { AuthService, failure, invalid } from './auth.service';
import { validation } from './auth-advanced.validation';
import { AdminDecisionTokensService } from './admin-decision-tokens.service';
import { AdminAccessNotificationsService } from './admin-access-notifications.service';
const RETENTION = 72 * 3600000;
const expired = () => failure(410, 'OTP_EXPIRED', 'El código venció');
const decided = () =>
  failure(409, 'REQUEST_ALREADY_DECIDED', 'La solicitud ya fue resuelta o cancelada');
const conflict = () =>
  failure(409, 'ADMIN_REQUEST_IDENTITY_CONFLICT', 'Los datos pertenecen a otra identidad');
const ineligible = () =>
  failure(403, 'ADMIN_REQUEST_NOT_ELIGIBLE', 'La cuenta no puede solicitar acceso administrativo');
const wrongPassword = () => failure(401, 'INVALID_CREDENTIALS', 'Las credenciales no son válidas');
type Profile = ReturnType<typeof adminAccessInput>['profile'];
interface Pending extends Omit<Profile, 'birthDate'> {
  birthDate: string;
  passwordHash: string;
  strong: boolean;
  existing: {
    id: string;
    credentialVersion: number;
    fingerprint: string;
    passwordMatches: boolean;
  } | null;
}
@Injectable()
export class AdminAccessService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private readonly dummy = argon2.hash(randomUUID());
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
    private readonly policy: PasswordPolicyService,
    private readonly email: EmailProvider,
    private readonly tokens: AdminDecisionTokensService,
    private readonly notifications: AdminAccessNotificationsService,
  ) {}
  async onModuleInit() {
    await this.purge();
    this.timer = setInterval(() => void this.purge().catch(() => undefined), 60000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async purge() {
    await this.db.adminAccessChallenge.updateMany({
      where: {
        createdAt: { lte: new Date(Date.now() - RETENTION) },
        NOT: { payload: { equals: Prisma.DbNull } },
      },
      data: { payload: Prisma.DbNull },
    });
  }
  private code() {
    return String(randomInt(1000000)).padStart(6, '0');
  }
  private codeHash(code: string) {
    return this.auth.hash('admin-access-otp:' + code);
  }
  private response(c: AdminAccessChallenge) {
    return {
      challengeId: c.id,
      expiresAt: c.expiresAt.toISOString(),
      resendAvailableAt: new Date(c.sentAt.getTime() + 60000).toISOString(),
      message: 'Verificá tu email para continuar con la solicitud.',
    };
  }
  private submitted(warn = false) {
    return {
      status: 'PENDING',
      message: warn
        ? 'La solicitud está pendiente. Se conservaron los datos del perfil existente.'
        : 'La solicitud está pendiente de aprobación.',
    };
  }
  private async send(email: string, code: string) {
    await this.email.sendEmail({
      to: email,
      subject: 'Verificá tu solicitud de acceso GdeS',
      html: `<html lang="es"><body><p>Tu código de verificación es <strong>${code}</strong>. Vence en diez minutos.</p></body></html>`,
    });
  }
  async start(value: unknown, ip: string) {
    const { profile, password } = adminAccessInput(value);
    await this.auth.limit('admin-request-ip', ip, 100);
    const identityHash = this.auth.hash('admin-request:' + profile.email);
    await this.auth.limit('admin-request-identity', identityHash, 10);
    if (!(await this.db.site.findUnique({ where: { id: profile.siteId } }))) validation();
    await this.purge();
    const existing = await this.db.user.findFirst({
      where: { email: { equals: profile.email, mode: 'insensitive' } },
    });
    const passwordMatches = await argon2.verify(
      existing?.passwordHash ?? (await this.dummy),
      password,
    );
    const passwordHash = await argon2.hash(password);
    let strong = true;
    try {
      this.policy.validate(password);
    } catch {
      strong = false;
    }
    const payload: Pending = {
      ...profile,
      birthDate: profile.birthDate.toISOString(),
      passwordHash,
      strong,
      existing: existing
        ? {
            id: existing.id,
            credentialVersion: existing.credentialVersion,
            fingerprint: this.auth.hash('admin-password:' + existing.passwordHash),
            passwordMatches,
          }
        : null,
    };
    const code = this.code();
    const c = await this.db.adminAccessChallenge.create({
      data: {
        identityHash,
        payload: payload as unknown as Prisma.InputJsonValue,
        codeHash: this.codeHash(code),
        expiresAt: new Date(Date.now() + 600000),
      },
    });
    await this.send(profile.email, code);
    return this.response(c);
  }
  private usable(c: AdminAccessChallenge) {
    if (c.createdAt.getTime() + RETENTION <= Date.now() || c.expiresAt.getTime() <= Date.now())
      throw expired();
    if (c.attempts >= 5) throw failure(429, 'TOO_MANY_ATTEMPTS', 'Demasiados intentos');
  }
  async resend(id: string, ip: string) {
    await this.auth.limit('resend-ip', ip, 50);
    await this.purge();
    const initial = await this.db.adminAccessChallenge.findUnique({ where: { id } });
    if (!initial) throw failure(401, 'INVALID_OTP', 'Código inválido');
    await this.auth.limit('admin-resend-identity', initial.identityHash, 5);
    const code = this.code();
    const result = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AdminAccessChallenge" WHERE id=${id}::uuid FOR UPDATE`;
      const c = await tx.adminAccessChallenge.findUniqueOrThrow({ where: { id } });
      if (c.createdAt.getTime() + RETENTION <= Date.now()) throw expired();
      if (c.consumedAt || !c.payload) throw failure(401, 'INVALID_OTP', 'Código inválido');
      if (c.attempts >= 5) throw failure(429, 'TOO_MANY_ATTEMPTS', 'Demasiados intentos');
      if (c.sentAt.getTime() + 60000 > Date.now())
        throw failure(429, 'OTP_RESEND_COOLDOWN', 'Esperá antes de reenviar');
      const updated = await tx.adminAccessChallenge.update({
        where: { id },
        data: {
          codeHash: this.codeHash(code),
          sentAt: new Date(),
          expiresAt: new Date(Math.min(Date.now() + 600000, c.createdAt.getTime() + RETENTION)),
        },
      });
      return { updated, email: (c.payload as unknown as Pending).email };
    });
    await this.send(result.email, code);
    return this.response(result.updated);
  }
  private async revoke(tx: Prisma.TransactionClient, userId: string) {
    await tx.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  async verify(id: string, code: string, ip: string) {
    await this.auth.limit('verify-ip', ip, 200);
    await this.purge();
    const initial = await this.db.adminAccessChallenge.findUnique({ where: { id } });
    if (!initial) throw failure(401, 'INVALID_OTP', 'Código inválido');
    await this.auth.limit('admin-verify-identity', initial.identityHash, 20);
    const snapshot = initial.payload as unknown as Pending | null;
    const knownUserId =
      snapshot?.existing?.id ??
      (initial.requestId
        ? (
            await this.db.adminAccessRequest.findUnique({
              where: { id: initial.requestId },
              select: { userId: true },
            })
          )?.userId
        : undefined);
    if (knownUserId) await this.auth.limit('admin-verify-user', knownUserId, 20);
    const result = await this.db
      .$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "AdminAccessChallenge" WHERE id=${id}::uuid FOR UPDATE`;
        const c = await tx.adminAccessChallenge.findUniqueOrThrow({ where: { id } });
        if (!c.consumedAt) this.usable(c);
        if (c.attempts >= 5)
          return { error: failure(429, 'TOO_MANY_ATTEMPTS', 'Demasiados intentos') };
        if (!this.auth.equal(c.codeHash, this.codeHash(code))) {
          await tx.adminAccessChallenge.update({
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
        if (c.consumedAt) {
          const request = c.requestId
            ? await tx.adminAccessRequest.findUnique({ where: { id: c.requestId } })
            : null;
          if (!request || request.status !== 'PENDING' || request.cancelledAt) throw decided();
          return { value: this.submitted() };
        }
        this.usable(c);
        if (!c.payload) throw expired();
        const p = c.payload as unknown as Pending;
        // Serialize fresh challenges for the same normalized identity; this lock
        // never introduces a reverse User -> Challenge acquisition.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.identityHash},0))::text`;
        let user = await tx.user.findFirst({
          where: { email: { equals: p.email, mode: 'insensitive' } },
        });
        if (user) {
          await tx.$queryRaw`SELECT id FROM "User" WHERE id=${user.id}::uuid FOR UPDATE`;
          user = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
        }
        this.usable(c);
        const identities = await tx.user.findMany({
          where: { OR: [{ dni: p.dni }, { employeeId: p.employeeId }] },
        });
        if (
          identities.some((u) => u.id !== user?.id) ||
          (user &&
            (user.email.toLowerCase() !== p.email ||
              user.dni !== p.dni ||
              user.employeeId !== p.employeeId))
        )
          throw conflict();
        if (user) {
          if (user.accountStatus !== 'ACTIVE' || !['EMPLOYEE', 'TO_BE_ADMIN'].includes(user.role))
            throw ineligible();
          if (
            !p.existing ||
            p.existing.id !== user.id ||
            p.existing.credentialVersion !== user.credentialVersion ||
            p.existing.fingerprint !== this.auth.hash('admin-password:' + user.passwordHash) ||
            !p.existing.passwordMatches
          )
            throw wrongPassword();
        } else {
          if (p.existing) throw wrongPassword();
          if (!p.strong) validation();
          const { passwordHash, strong, existing, ...profile } = p;
          void strong;
          void existing;
          user = await tx.user.create({
            data: {
              ...profile,
              birthDate: new Date(profile.birthDate),
              passwordHash,
              role: 'TO_BE_ADMIN',
              emailVerifiedAt: new Date(),
            },
          });
          this.usable(c);
        }
        const warn =
          ['firstName', 'lastName', 'phone', 'address', 'siteId'].some(
            (k) => user![k as keyof User] !== p[k as keyof Pending],
          ) || user.birthDate.toISOString() !== p.birthDate;
        let request = await tx.adminAccessRequest.findFirst({
          where: { userId: user.id, status: 'PENDING', cancelledAt: null },
        });
        if (request) {
          await tx.$queryRaw`SELECT id FROM "AdminAccessRequest" WHERE id=${request.id}::uuid FOR UPDATE`;
          request = await tx.adminAccessRequest.findUniqueOrThrow({ where: { id: request.id } });
          if (request.cancelledAt || request.status !== 'PENDING') throw decided();
        }
        if (user.role !== 'TO_BE_ADMIN') {
          user = await tx.user.update({
            where: { id: user.id },
            data: {
              role: 'TO_BE_ADMIN',
              credentialVersion: { increment: 1 },
              emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
            },
          });
          await this.revoke(tx, user.id);
        } else if (!user.emailVerifiedAt)
          user = await tx.user.update({
            where: { id: user.id },
            data: { emailVerifiedAt: new Date() },
          });
        if (!request || request.decisionExpiresAt.getTime() <= Date.now()) {
          const meta = this.tokens.metadata(
            user.id,
            request?.id ?? randomUUID(),
            request ? request.decisionGeneration + 1 : 1,
          );
          const token = await this.tokens.sign(meta);
          const hash = this.tokens.hash(token);
          const data = {
            emailHash: this.auth.hash('admin-request-email:' + user.email.toLowerCase()),
            decisionGeneration: meta.generation,
            decisionJti: meta.jti,
            decisionTokenHash: hash,
            decisionIssuedAt: new Date(meta.iat * 1000),
            decisionExpiresAt: new Date(meta.exp * 1000),
          };
          request = request
            ? await tx.adminAccessRequest.update({ where: { id: request.id }, data })
            : await tx.adminAccessRequest.create({
                data: { id: meta.requestId, userId: user.id, ...data },
              });
          await this.notifications.queue(tx, request.id, meta.generation, 'RECEIPT', user);
          await this.notifications.queue(
            tx,
            request.id,
            meta.generation,
            'DECISION',
            user,
            meta,
            hash,
          );
        }
        this.usable(c);
        await tx.adminAccessChallenge.update({
          where: { id },
          data: { consumedAt: new Date(), payload: Prisma.DbNull, requestId: request.id },
        });
        return { value: this.submitted(warn) };
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          throw conflict();
        throw error;
      });
    if (result.error) throw result.error;
    this.notifications.kick();
    return result.value;
  }
  async confirm(token: string, decision: 'APPROVE' | 'REJECT') {
    const meta = await this.tokens.verify(token);
    const result = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${meta.userId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "AdminAccessRequest" WHERE id=${meta.requestId}::uuid FOR UPDATE`;
      const request = await tx.adminAccessRequest.findUnique({ where: { id: meta.requestId } });
      const user = await tx.user.findUnique({ where: { id: meta.userId } });
      if (
        !request ||
        !user ||
        request.userId !== user.id ||
        request.decisionGeneration !== meta.generation ||
        request.decisionJti !== meta.jti ||
        !this.auth.equal(request.decisionTokenHash, this.tokens.hash(token))
      )
        throw invalid();
      if (request.status !== 'PENDING' || request.cancelledAt) throw decided();
      if (meta.exp * 1000 <= Date.now() || request.decisionExpiresAt.getTime() <= Date.now())
        throw failure(410, 'TOKEN_EXPIRED', 'El enlace venció');
      if (
        user.accountStatus !== 'ACTIVE' ||
        user.role !== 'TO_BE_ADMIN' ||
        request.emailHash !== this.auth.hash('admin-request-email:' + user.email.toLowerCase())
      )
        throw ineligible();
      const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      await tx.adminAccessRequest.update({
        where: { id: request.id },
        data: { status, decidedAt: new Date() },
      });
      const updated = await tx.user.update({
        where: { id: user.id },
        data: {
          role: decision === 'APPROVE' ? 'ADMIN' : 'EMPLOYEE',
          credentialVersion: { increment: 1 },
        },
      });
      await this.revoke(tx, user.id);
      await this.notifications.queue(
        tx,
        request.id,
        request.decisionGeneration,
        'RESULT',
        updated,
        undefined,
        undefined,
        status,
      );
      return { decision: status };
    });
    this.notifications.kick();
    return result;
  }
}
