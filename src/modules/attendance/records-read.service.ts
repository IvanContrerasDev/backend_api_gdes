import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../prisma/prisma.service';

const eventReference = { id: true, type: true, occurredAt: true } as const;
export const recordSelect = {
  id: true,
  date: true,
  totalWorkMinutes: true,
  recordStatus: true,
  reviewStatus: true,
  origin: true,
  observations: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
  workplace: { select: { id: true, name: true } },
  client: { select: { id: true, name: true } },
  site: { select: { id: true, name: true } },
  intervals: {
    orderBy: { sequence: 'asc' },
    select: {
      id: true,
      type: true,
      intervalStatus: true,
      startTime: true,
      endTime: true,
      absenceReason: true,
      observations: true,
      origin: true,
      reviewStatus: true,
      entryEvent: { select: eventReference },
      exitEvent: { select: eventReference },
      absenceEvent: { select: eventReference },
    },
  },
} satisfies Prisma.AttendanceRecordSelect;
type DetailRow = Prisma.AttendanceRecordGetPayload<{ select: typeof recordSelect }>;
export function recordDetail(row: DetailRow) {
  const { user, intervals, date, ...rest } = row;
  return {
    ...rest,
    date: date.toISOString().slice(0, 10),
    employee: user,
    hasAbsence: intervals.some((i) => i.type === 'ABSENCE'),
    intervals: intervals.map((i) => {
      const { intervalStatus, entryEvent, exitEvent, absenceEvent, ...fields } = i;
      return {
        ...fields,
        status: intervalStatus,
        attendanceEvents: [entryEvent, exitEvent, absenceEvent].filter((e) => e !== null),
      };
    }),
  };
}
export type RecordDetail = ReturnType<typeof recordDetail>;
export async function loadDetail(tx: Prisma.TransactionClient, id: string) {
  const row = await tx.attendanceRecord.findUnique({ where: { id }, select: recordSelect });
  if (!row) throw new ApiException(404, 'NOT_FOUND', 'El registro no existe');
  return recordDetail(row);
}
@Injectable()
export class RecordsReadService {
  constructor(private readonly db: PrismaService) {}
  detail(id: string) {
    // Prisma loads relations through separate SELECTs. One repeatable snapshot
    // keeps version/totals and the editable interval data from the same state.
    return this.db.$transaction((tx) => loadDetail(tx, id), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }
  async event(id: string) {
    const event = await this.db.attendanceEvent.findUnique({
      where: { id },
      select: {
        id: true,
        recordId: true,
        type: true,
        occurredAt: true,
        receivedAt: true,
        origin: true,
        observation: true,
        latitude: true,
        longitude: true,
        accuracy: true,
        locationTimestamp: true,
        clientSentAt: true,
        clientRequestId: true,
        deviceInfo: true,
        entries: { select: { id: true } },
        exits: { select: { id: true } },
        absences: { select: { id: true } },
      },
    });
    if (!event) throw new ApiException(404, 'NOT_FOUND', 'La marcación no existe');
    const reserved = new Set([
      'id',
      'userId',
      'workplaceId',
      'recordId',
      'intervalId',
      'occurredAt',
      'receivedAt',
      'createdAt',
      'updatedAt',
      'origin',
      'locationTimestamp',
      'clientRequestId',
      'clientSentAt',
      'deviceInfoJson',
      '__proto__',
      'constructor',
      'prototype',
    ]);
    const device =
      event.deviceInfo && typeof event.deviceInfo === 'object' && !Array.isArray(event.deviceInfo)
        ? event.deviceInfo
        : {};
    const metadata: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(device)) {
      if (
        !reserved.has(key) &&
        (value === null ||
          typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean')
      )
        metadata[key] = value;
    }
    if (
      Object.entries(device).some(
        ([k, v]) => reserved.has(k) || (v !== null && typeof v === 'object'),
      )
    )
      metadata.deviceInfoJson = JSON.stringify(event.deviceInfo);
    metadata.clientRequestId = event.clientRequestId;
    metadata.clientSentAt = event.clientSentAt?.toISOString() ?? null;
    return {
      id: event.id,
      recordId: event.recordId,
      intervalId:
        [...event.entries, ...event.exits, ...event.absences].sort((a, b) =>
          a.id.localeCompare(b.id),
        )[0]?.id ?? null,
      type: event.type,
      occurredAt: event.occurredAt,
      receivedAt: event.receivedAt,
      origin: event.origin,
      observation: event.observation,
      location: {
        latitude: event.latitude,
        longitude: event.longitude,
        accuracyMeters: event.accuracy,
        capturedAt: event.locationTimestamp,
      },
      metadata,
    };
  }
}
