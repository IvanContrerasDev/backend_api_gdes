import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AttendanceEvent, Prisma } from '@prisma/client';
import { ApiException } from '../../common/errors/api.exception';
import { AuthenticatedUser } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { attendanceDate, effectiveTime } from './attendance-time';
import { eventEnvelope, eventInput } from './attendance.validation';
import { geofenceReview } from './geofence';

const message = 'Registro realizado correctamente';
function replay(event: AttendanceEvent, userId: string) {
  if (event.userId !== userId)
    throw new ApiException(403, 'ROLE_NOT_ALLOWED', 'No se permite acceder a esta marcación');
  return {
    replay: true,
    data: { eventId: event.id, recordId: event.recordId, message: event.responseMessage },
  };
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private async activeUser(tx: Prisma.TransactionClient, auth: AuthenticatedUser) {
    // All attendance writes for one employee serialize here. Same order as auth
    // and employee deactivation; structure takes Workplace before Client.
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "User" WHERE id=${auth.id}::uuid FOR UPDATE`;
    const user = rows.length ? await tx.user.findUnique({ where: { id: auth.id } }) : null;
    if (!user || user.role !== 'EMPLOYEE')
      throw new ApiException(401, 'INVALID_TOKEN', 'La sesión no es válida');
    if (user.accountStatus !== 'ACTIVE')
      throw new ApiException(403, 'ACCOUNT_INACTIVE', 'La cuenta está desactivada');
    const session = auth.sessionId
      ? await tx.authSession.findUnique({ where: { id: auth.sessionId } })
      : null;
    if (
      !user.emailVerifiedAt ||
      !session ||
      session.userId !== user.id ||
      session.role !== user.role ||
      session.client !== 'MOBILE' ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    )
      throw new ApiException(401, 'INVALID_TOKEN', 'La sesión no es válida');
  }

  async ingest(auth: AuthenticatedUser, value: unknown) {
    const { body, clientRequestId } = eventEnvelope(value);
    try {
      return await this.db.$transaction(
        async (tx) => {
          await this.activeUser(tx, auth);
          const existing = await tx.attendanceEvent.findUnique({ where: { clientRequestId } });
          if (existing) return replay(existing, auth.id);
          const input = eventInput(body);
          const places = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM "Workplace" WHERE id=${input.workplaceId}::uuid FOR UPDATE`;
          const workplace = places.length
            ? await tx.workplace.findUnique({ where: { id: input.workplaceId } })
            : null;
          if (!workplace || workplace.status !== 'ACTIVE')
            throw new ApiException(
              404,
              'WORKPLACE_NOT_FOUND',
              'El lugar de trabajo no está disponible',
            );
          const clients = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM "Client" WHERE id=${workplace.clientId}::uuid FOR UPDATE`;
          const client = clients.length
            ? await tx.client.findUnique({ where: { id: workplace.clientId } })
            : null;
          if (!client || client.status !== 'ACTIVE')
            throw new ApiException(409, 'CLIENT_INACTIVE', 'El cliente está inactivo');
          const receivedAt = new Date();
          const time = effectiveTime(body, receivedAt);
          const pending = geofenceReview(
            workplace,
            input.latitude,
            input.longitude,
            input.accuracy,
            this.config.getOrThrow<number>('GEOFENCE_TOLERANCE_METERS'),
          );
          const date = attendanceDate(time.occurredAt);
          let record = await tx.attendanceRecord.findUnique({
            where: {
              userId_workplaceId_date: { userId: auth.id, workplaceId: workplace.id, date },
            },
          });
          const version = record ? record.version + 1 : 1;
          if (!record)
            record = await tx.attendanceRecord.create({
              data: {
                userId: auth.id,
                workplaceId: workplace.id,
                clientId: workplace.clientId,
                siteId: workplace.siteId,
                date,
                recordStatus: 'INCOMPLETE',
                origin: 'AUTOMATIC',
              },
            });
          const event = await tx.attendanceEvent.create({
            data: {
              ...input,
              ...time,
              userId: auth.id,
              recordId: record.id,
              clientRequestId,
              receivedAt,
              origin: 'MOBILE',
              responseMessage: message,
            },
          });
          const common = {
            recordId: record.id,
            sequence:
              ((
                await tx.interval.aggregate({
                  where: { recordId: record.id },
                  _max: { sequence: true },
                })
              )._max.sequence ?? 0) + 1,
            origin: 'AUTOMATIC' as const,
            reviewStatus: pending ? ('PENDING' as const) : ('NONE' as const),
            observations: input.observation,
          };
          let outOfOrder = false;
          if (input.type === 'CHECK_IN') {
            await tx.interval.create({
              data: {
                ...common,
                type: 'WORK',
                startTime: time.occurredAt,
                intervalStatus: 'OPEN',
                entryEventId: event.id,
              },
            });
          } else if (input.type === 'CHECK_OUT') {
            const open = await tx.interval.findFirst({
              where: { recordId: record.id, type: 'WORK', intervalStatus: 'OPEN' },
              orderBy: { sequence: 'desc' },
            });
            outOfOrder = !!open?.startTime && time.occurredAt < open.startTime;
            if (open && !outOfOrder) {
              await tx.interval.update({
                where: { id: open.id },
                data: {
                  endTime: time.occurredAt,
                  intervalStatus: 'CLOSED',
                  exitEventId: event.id,
                  ...(pending ? { reviewStatus: 'PENDING' } : {}),
                },
              });
            } else {
              await tx.interval.create({
                data: {
                  ...common,
                  type: 'WORK',
                  endTime: time.occurredAt,
                  intervalStatus: 'SEMI_CLOSED',
                  exitEventId: event.id,
                  ...(outOfOrder ? { reviewStatus: 'PENDING' } : {}),
                },
              });
            }
          } else {
            await tx.interval.create({
              data: {
                ...common,
                type: 'ABSENCE',
                intervalStatus: 'CLOSED',
                absenceReason: input.absenceReason,
                absenceEventId: event.id,
              },
            });
          }
          const intervals = await tx.interval.findMany({ where: { recordId: record.id } });
          const workMs = intervals.reduce(
            (total, interval) =>
              total +
              (interval.type === 'WORK' &&
              interval.intervalStatus === 'CLOSED' &&
              interval.startTime &&
              interval.endTime
                ? interval.endTime.getTime() - interval.startTime.getTime()
                : 0),
            0,
          );
          await tx.attendanceRecord.update({
            where: { id: record.id },
            data: {
              version,
              totalWorkMinutes: Math.floor(workMs / 60000),
              recordStatus: intervals.every((i) => i.intervalStatus === 'CLOSED')
                ? 'COMPLETE'
                : 'INCOMPLETE',
              ...(pending || outOfOrder ? { reviewStatus: 'PENDING' } : {}),
            },
          });
          return {
            replay: false,
            data: { eventId: event.id, recordId: record.id, message: event.responseMessage },
          };
        },
        { timeout: 15000 },
      );
    } catch (error) {
      // Across different users the global request-id constraint can race after
      // the initial read. P2002 is raised only after the winner commits. The
      // losing transaction has rolled back event, record and projection.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const event = await this.db.attendanceEvent.findUnique({ where: { clientRequestId } });
        if (event) return replay(event, auth.id);
      }
      throw error;
    }
  }

  async status(auth: AuthenticatedUser) {
    return this.db.$transaction(async (tx) => {
      await this.activeUser(tx, auth);
      const open = await tx.interval.findFirst({
        where: {
          type: 'WORK',
          intervalStatus: 'OPEN',
          record: { userId: auth.id, date: attendanceDate(new Date()) },
        },
        orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
        include: { record: { select: { workplaceId: true } } },
      });
      return {
        isWorking: !!open,
        since: open?.startTime ?? null,
        workplaceId: open?.record.workplaceId ?? null,
      };
    });
  }
}
