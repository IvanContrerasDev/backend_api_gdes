import { isISO8601 } from 'class-validator';
import { ApiException } from '../../common/errors/api.exception';

export function timestamp(value: unknown, code = 'VALIDATION_ERROR'): Date {
  if (
    typeof value !== 'string' ||
    !isISO8601(value, { strict: true, strictSeparator: true }) ||
    !/T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new ApiException(422, code, 'La fecha y hora deben tener formato ISO 8601 válido');
  return new Date(value);
}

/** Server time is provided only by the service, never by an HTTP field. */
export function effectiveTime(
  source: { occurredAt?: unknown; clientSentAt?: unknown },
  receivedAt: Date,
): { occurredAt: Date; clientSentAt: Date | null } {
  if (source.clientSentAt === undefined) {
    if (source.occurredAt !== undefined) timestamp(source.occurredAt);
    return { occurredAt: receivedAt, clientSentAt: null };
  }
  const occurredAt = timestamp(source.occurredAt, 'INVALID_TIMESTAMP');
  const clientSentAt = timestamp(source.clientSentAt, 'INVALID_TIMESTAMP');
  if (
    clientSentAt.getTime() - receivedAt.getTime() > 120000 ||
    occurredAt.getTime() > clientSentAt.getTime()
  )
    throw new ApiException(422, 'INVALID_TIMESTAMP', 'La hora del dispositivo no es válida');
  if (receivedAt.getTime() - occurredAt.getTime() > 86400000)
    throw new ApiException(422, 'ATTENDANCE_EVENT_TOO_OLD', 'La marcación supera las 24 horas');
  return { occurredAt, clientSentAt };
}

/** Fixed GMT-3 business day represented as a PostgreSQL date, independent of host TZ. */
export function attendanceDate(at: Date): Date {
  return new Date(`${new Date(at.getTime() - 10800000).toISOString().slice(0, 10)}T00:00:00.000Z`);
}
