import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { createInput, invalid, reviewInput, updateInput } from './records.validation';
import {
  intervalStatus,
  projectIntervals,
  validateInterval,
  validateOverlaps,
} from './record-projection';
import { loadDetail } from './records-read.service';

@Injectable()
export class RecordsWriteService {
  constructor(private readonly db: PrismaService) {}
  private async lockContext(
    tx: Prisma.TransactionClient,
    userId: string,
    workplaceId: string,
    creating: boolean,
  ) {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId}::uuid FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'EMPLOYEE')
      throw new ApiException(404, 'USER_NOT_FOUND', 'El empleado no existe');
    if (creating && user.accountStatus !== 'ACTIVE')
      throw new ApiException(403, 'ACCOUNT_INACTIVE', 'La cuenta está desactivada');
    await tx.$queryRaw`SELECT id FROM "Workplace" WHERE id=${workplaceId}::uuid FOR UPDATE`;
    const place = await tx.workplace.findUnique({ where: { id: workplaceId } });
    if (!place || (creating && place.status !== 'ACTIVE'))
      throw new ApiException(404, 'WORKPLACE_NOT_FOUND', 'El lugar de trabajo no está disponible');
    await tx.$queryRaw`SELECT id FROM "Client" WHERE id=${place.clientId}::uuid FOR UPDATE`;
    const client = await tx.client.findUnique({ where: { id: place.clientId } });
    if (!client || (creating && client.status !== 'ACTIVE'))
      throw new ApiException(409, 'CLIENT_INACTIVE', 'El cliente está inactivo');
    return place;
  }
  async create(value: unknown) {
    const input = createInput(value);
    const intervals = input.intervals.map((i, index) => {
      validateInterval(i, input.date);
      return {
        ...i,
        id: randomUUID(),
        sequence: index + 1,
        intervalStatus: intervalStatus(i),
        origin: 'MANUAL' as const,
      };
    });
    validateOverlaps([], intervals);
    try {
      return await this.db.$transaction(
        async (tx) => {
          const place = await this.lockContext(tx, input.userId, input.workplaceId, true);
          const record = await tx.attendanceRecord.create({
            data: {
              userId: input.userId,
              workplaceId: input.workplaceId,
              clientId: place.clientId,
              siteId: place.siteId,
              date: input.date,
              observations: input.observations,
              origin: 'MANUAL',
              reviewStatus: 'MANUAL_LOADED',
              ...projectIntervals(intervals),
            },
          });
          await tx.interval.createMany({
            data: intervals.map((i) => ({ ...i, recordId: record.id })),
          });
          return loadDetail(tx, record.id);
        },
        { timeout: 15000 },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ApiException(
          409,
          'RECORD_ALREADY_EXISTS',
          'Ya existe un registro para ese empleado, lugar y fecha',
        );
      throw error;
    }
  }
  private async lockedRecord(tx: Prisma.TransactionClient, id: string, version: number) {
    // Identity is immutable through the API. Read it to acquire locks in the
    // same order as ingestion; never acquire Record before User/Workplace.
    const identity = await tx.attendanceRecord.findUnique({
      where: { id },
      select: { userId: true, workplaceId: true },
    });
    if (!identity) throw new ApiException(404, 'NOT_FOUND', 'El registro no existe');
    await this.lockContext(tx, identity.userId, identity.workplaceId, false);
    await tx.$queryRaw`SELECT id FROM "AttendanceRecord" WHERE id=${id}::uuid FOR UPDATE`;
    const record = await tx.attendanceRecord.findUniqueOrThrow({
      where: { id },
      include: { intervals: { orderBy: { sequence: 'asc' } } },
    });
    if (record.version !== version)
      throw new ApiException(
        409,
        'RECORD_VERSION_CONFLICT',
        'El registro cambió; recargá los datos antes de guardar',
      );
    return record;
  }
  async update(id: string, value: unknown) {
    const input = updateInput(value);
    return this.db.$transaction(
      async (tx) => {
        const record = await this.lockedRecord(tx, id, input.expectedVersion);
        const after = new Map(record.intervals.map((i) => [i.id, { ...i }]));
        let sequence = Math.max(0, ...record.intervals.map((i) => i.sequence));
        const changed = new Set<string>(),
          added = new Set<string>(),
          deleted = new Set<string>();
        for (const change of input.changes) {
          if (change.operation === 'ADD') {
            const interval = {
              ...change.interval,
              id: randomUUID(),
              sequence: ++sequence,
              recordId: id,
              intervalStatus: intervalStatus(change.interval),
              origin: 'MANUAL' as const,
              reviewStatus: 'NONE' as const,
              entryEventId: null,
              exitEventId: null,
              absenceEventId: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            validateInterval(interval, record.date);
            after.set(interval.id, interval);
            added.add(interval.id);
          } else {
            const original = after.get(change.id);
            if (!original) invalid('El intervalo no pertenece al registro');
            if (change.operation === 'DELETE') {
              after.delete(change.id);
              deleted.add(change.id);
            } else {
              const updated = { ...original, ...change.interval, origin: 'MANUAL' as const };
              validateInterval(updated, record.date);
              updated.intervalStatus = intervalStatus(updated);
              after.set(change.id, updated);
              changed.add(change.id);
            }
          }
        }
        if (!after.size)
          throw new ApiException(
            422,
            'RECORD_INTERVALS_REQUIRED',
            'El registro debe conservar al menos un intervalo',
          );
        validateOverlaps(record.intervals, [...after.values()]);
        if (deleted.size)
          await tx.interval.deleteMany({ where: { recordId: id, id: { in: [...deleted] } } });
        for (const interval of after.values()) {
          if (added.has(interval.id)) {
            const { createdAt: _created, updatedAt: _updated, ...data } = interval;
            void _created;
            void _updated;
            await tx.interval.create({ data });
          } else if (changed.has(interval.id)) {
            await tx.interval.update({
              where: { id: interval.id },
              data: {
                type: interval.type,
                startTime: interval.startTime,
                endTime: interval.endTime,
                absenceReason: interval.absenceReason,
                observations: interval.observations,
                intervalStatus: interval.intervalStatus,
                origin: 'MANUAL',
              },
            });
          }
        }
        await tx.attendanceRecord.update({
          where: { id },
          data: {
            ...projectIntervals([...after.values()]),
            version: record.version + 1,
            origin: 'MANUAL',
            reviewStatus: 'MANUAL_LOADED',
            ...('observations' in input ? { observations: input.observations } : {}),
          },
        });
        return loadDetail(tx, id);
      },
      { timeout: 15000 },
    );
  }
  async review(id: string, value: unknown) {
    const input = reviewInput(value);
    return this.db.$transaction(
      async (tx) => {
        const record = await this.lockedRecord(tx, id, input.expectedVersion);
        await tx.attendanceRecord.update({
          where: { id },
          data: { version: record.version + 1, reviewStatus: 'APPROVED' },
        });
        return loadDetail(tx, id);
      },
      { timeout: 15000 },
    );
  }
}
