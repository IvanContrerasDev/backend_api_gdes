import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminAccessNotification, AdminNotificationKind, Prisma, User } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailProvider } from '../notifications/notifications.service';
import { AdminDecisionMetadata, AdminDecisionTokensService } from './admin-decision-tokens.service';
interface MessageMetadata {
  to: string;
  subject: string;
  name: string;
  email: string;
  origin: string;
  status?: string;
  decision?: AdminDecisionMetadata;
  decisionHash?: string;
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
@Injectable()
export class AdminAccessNotificationsService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<void>;
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
    private readonly email: EmailProvider,
    private readonly tokens: AdminDecisionTokensService,
  ) {}
  namespace(): string {
    return createHmac('sha256', this.config.getOrThrow<string>('JWT_REFRESH_SECRET'))
      .update(
        JSON.stringify([
          'gdes:admin-access-outbox:v1',
          this.config.get('ADMIN_FRONTEND_URL'),
          this.config.get('EMAIL_PROVIDER'),
          this.config.get('EMAIL_FROM'),
        ]),
      )
      .digest('hex');
  }
  private fence(row: AdminAccessNotification) {
    return {
      id: row.id,
      namespace: this.namespace(),
      attempts: row.attempts,
      completedAt: null,
      lockedUntil: { gt: new Date() },
      expiresAt: { gt: new Date() },
    };
  }
  async queue(
    tx: Prisma.TransactionClient,
    requestId: string,
    generation: number,
    kind: AdminNotificationKind,
    user: User,
    decision?: AdminDecisionMetadata,
    decisionHash?: string,
    status?: string,
  ) {
    const recipients =
      kind === 'DECISION'
        ? await tx.user.findMany({ where: { role: 'SUPER_ADMIN', accountStatus: 'ACTIVE' } })
        : [user];
    for (const recipient of recipients) {
      const payload: MessageMetadata = {
        to: recipient.email,
        name: user.firstName + ' ' + user.lastName,
        email: user.email,
        origin: this.config.getOrThrow<string>('ADMIN_FRONTEND_URL'),
        subject:
          kind === 'DECISION'
            ? 'Solicitud de acceso administrativo GdeS'
            : kind === 'RESULT'
              ? 'Resultado de tu solicitud GdeS'
              : 'Recibimos tu solicitud de acceso GdeS',
        ...(decision ? { decision, decisionHash } : {}),
        ...(status ? { status } : {}),
      };
      await tx.adminAccessNotification.create({
        data: {
          requestId,
          generation,
          kind,
          recipientId: recipient.id,
          namespace: this.namespace(),
          payload: payload as unknown as Prisma.InputJsonValue,
          expiresAt: new Date(
            Math.min(decision ? decision.exp * 1000 : Infinity, Date.now() + 86400000),
          ),
        },
      });
    }
  }
  onModuleInit() {
    this.timer = setInterval(() => this.kick(), 250);
    this.timer.unref();
    this.kick();
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.active) await this.active;
  }
  kick() {
    if (this.active) return;
    this.active = this.drain()
      .catch(() => undefined)
      .finally(() => {
        this.active = undefined;
      });
  }
  private async claim() {
    return this.db.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "AdminAccessNotification" WHERE namespace=${this.namespace()} AND "completedAt" IS NULL AND "nextAttemptAt"<=now() AND ("lockedUntil" IS NULL OR "lockedUntil"<=now()) AND "expiresAt">now() AND attempts<3 ORDER BY "createdAt",id LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!row) return null;
      return tx.adminAccessNotification.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 }, lockedUntil: new Date(Date.now() + 60000) },
      });
    });
  }
  private async html(kind: AdminNotificationKind, meta: MessageMetadata) {
    const intro = `<p>${escape(meta.name)} (${escape(meta.email)})</p>`;
    if (kind === 'DECISION') {
      if (!meta.decision) throw new Error('Missing decision metadata');
      const token = await this.tokens.sign(meta.decision);
      if (this.tokens.hash(token) !== meta.decisionHash)
        throw new Error('Invalid decision metadata');
      const link = (decision: string) => {
        const url = new URL('/admin-access/confirm', meta.origin);
        url.searchParams.set('token', token);
        url.searchParams.set('decision', decision);
        return escape(url.href);
      };
      return `<html lang="es"><body><h1>Solicitud de acceso administrativo</h1>${intro}<p>El enlace vence en siete días. Confirmá la acción en la web.</p><a href="${link('APPROVE')}">Aprobar acceso</a> <a href="${link('REJECT')}">Rechazar acceso</a></body></html>`;
    }
    return `<html lang="es"><body><h1>${escape(meta.subject)}</h1>${intro}<p>${kind === 'RESULT' ? (meta.status === 'APPROVED' ? 'Tu solicitud fue aprobada.' : 'Tu solicitud fue rechazada.') : 'Tu solicitud quedó pendiente de revisión.'}</p></body></html>`;
  }
  private eligible(
    row: Prisma.AdminAccessNotificationGetPayload<{ include: { request: true; recipient: true } }>,
    meta: MessageMetadata,
  ): boolean {
    return (
      row.recipient.accountStatus === 'ACTIVE' &&
      row.recipient.email === meta.to &&
      (row.kind !== 'DECISION' ||
        (row.recipient.role === 'SUPER_ADMIN' &&
          row.request.status === 'PENDING' &&
          !row.request.cancelledAt &&
          row.request.decisionGeneration === row.generation &&
          row.request.decisionExpiresAt.getTime() > Date.now()))
    );
  }
  async drain() {
    await this.db.adminAccessNotification.deleteMany({
      where: { namespace: this.namespace(), expiresAt: { lte: new Date() } },
    });
    for (let index = 0; index < 20; index++) {
      const intent = await this.claim();
      if (!intent) return;
      try {
        const current = await this.db.adminAccessNotification.findFirst({
          where: this.fence(intent),
          include: { request: true, recipient: true },
        });
        if (!current) continue;
        const meta = current.payload as unknown as MessageMetadata;
        if (!this.eligible(current, meta)) {
          await this.db.adminAccessNotification.updateMany({
            where: this.fence(intent),
            data: { completedAt: new Date(), lockedUntil: null },
          });
          continue;
        }
        const html = await this.html(current.kind, meta);
        // Fence again after reconstruction; an old worker cannot send a newly
        // generated capability under a previous message's idempotency key.
        const ready = await this.db.adminAccessNotification.findFirst({
          where: this.fence(intent),
          include: { request: true, recipient: true },
        });
        if (!ready) continue;
        if (!this.eligible(ready, meta)) {
          await this.db.adminAccessNotification.updateMany({
            where: this.fence(intent),
            data: { completedAt: new Date(), lockedUntil: null },
          });
          continue;
        }
        await this.email.sendEmail({
          to: meta.to,
          subject: meta.subject,
          html,
          idempotencyKey: 'admin-access/' + intent.id,
        });
        await this.db.adminAccessNotification.updateMany({
          where: this.fence(intent),
          data: { acceptedAt: new Date(), completedAt: new Date(), lockedUntil: null },
        });
      } catch {
        await this.db.adminAccessNotification.updateMany({
          where: this.fence(intent),
          data: {
            lockedUntil: null,
            nextAttemptAt: new Date(Date.now() + 1000 * 2 ** (intent.attempts - 1)),
          },
        });
      }
    }
  }
}
