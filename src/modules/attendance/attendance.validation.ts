import { AbsenceReason, AttendanceEventType, Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { ApiException } from '../../common/errors/api.exception';
import { timestamp } from './attendance-time';

function invalid(message = 'Los datos de la marcación no son válidos'): never {
  throw new ApiException(422, 'VALIDATION_ERROR', message);
}
export function eventEnvelope(value: unknown): {
  body: Record<string, unknown>;
  clientRequestId: string;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const body = value as Record<string, unknown>;
  // Identity always comes from the authenticated session, including on replays.
  if ('userId' in body) invalid('No se permite indicar otro usuario');
  if (typeof body.clientRequestId !== 'string' || !body.clientRequestId.trim())
    invalid('La clave de idempotencia es obligatoria');
  return { body, clientRequestId: body.clientRequestId };
}
function validJson(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(validJson);
  if (value && typeof value === 'object') return Object.values(value).every(validJson);
  return value === null || ['string', 'boolean'].includes(typeof value);
}
export function eventInput(body: Record<string, unknown>) {
  const allowed = new Set([
    'workplaceId',
    'type',
    'occurredAt',
    'clientSentAt',
    'latitude',
    'longitude',
    'accuracy',
    'locationTimestamp',
    'observation',
    'absenceReason',
    'clientRequestId',
    'deviceInfo',
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key)))
    invalid('La marcación contiene campos no permitidos');
  if (typeof body.workplaceId !== 'string' || !isUUID(body.workplaceId))
    invalid('El lugar de trabajo no es válido');
  if (!Object.values(AttendanceEventType).includes(body.type as AttendanceEventType))
    invalid('El tipo de marcación no es válido');
  for (const [key, min, max] of [
    ['latitude', -90, 90],
    ['longitude', -180, 180],
    ['accuracy', 0, Infinity],
  ] as const) {
    const v = body[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
      invalid('Las coordenadas y la precisión GPS no son válidas');
  }
  const locationTimestamp = timestamp(body.locationTimestamp);
  if (
    body.observation !== undefined &&
    body.observation !== null &&
    typeof body.observation !== 'string'
  )
    invalid('La observación no es válida');
  if (
    body.absenceReason !== undefined &&
    body.absenceReason !== null &&
    (body.type !== AttendanceEventType.ABSENCE ||
      !Object.values(AbsenceReason).includes(body.absenceReason as AbsenceReason))
  )
    invalid('El motivo de ausencia no es válido');
  if (
    body.deviceInfo !== undefined &&
    body.deviceInfo !== null &&
    (typeof body.deviceInfo !== 'object' ||
      Array.isArray(body.deviceInfo) ||
      !validJson(body.deviceInfo))
  )
    invalid('Los datos del dispositivo no son válidos');
  return {
    workplaceId: body.workplaceId,
    type: body.type as AttendanceEventType,
    latitude: body.latitude as number,
    longitude: body.longitude as number,
    accuracy: body.accuracy as number,
    locationTimestamp,
    observation: body.observation as string | null | undefined,
    absenceReason: body.absenceReason as AbsenceReason | null | undefined,
    deviceInfo: body.deviceInfo == null ? undefined : (body.deviceInfo as Prisma.InputJsonObject),
  };
}
