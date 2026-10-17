import {
  AbsenceReason,
  IntervalType,
  RecordOrigin,
  RecordStatus,
  ReviewStatus,
} from '@prisma/client';
import { isUUID } from 'class-validator';
import { ApiException } from '../../common/errors/api.exception';
import { timestamp } from './attendance-time';

export function invalid(message = 'Los datos del registro no son válidos'): never {
  throw new ApiException(422, 'VALIDATION_ERROR', message);
}
export function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((k) => !allowed.includes(k)))
    invalid('El registro contiene campos no permitidos');
  return result;
}
export function recordId(value: unknown): string {
  if (typeof value !== 'string' || !isUUID(value)) invalid('El identificador no es válido');
  return value.toLowerCase();
}
export function civilDate(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000'))
    invalid('La fecha no es válida');
  const date = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    invalid('La fecha no es válida');
  return date;
}
function nullableString(value: unknown): string | null {
  if (value !== null && typeof value !== 'string') invalid('La observación no es válida');
  return value;
}
export function expectedVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    invalid('La versión del registro no es válida');
  return value;
}
export interface IntervalFields {
  type: IntervalType;
  startTime: Date | null;
  endTime: Date | null;
  absenceReason: AbsenceReason | null;
  observations: string | null;
}
export function intervalInput(value: unknown): IntervalFields {
  const body = object(value, ['type', 'startTime', 'endTime', 'absenceReason', 'observations']);
  for (const key of ['type', 'startTime', 'endTime', 'absenceReason', 'observations'])
    if (!(key in body)) invalid('El intervalo debe incluir todos sus campos');
  if (!Object.values(IntervalType).includes(body.type as IntervalType))
    invalid('El tipo de intervalo no es válido');
  if (
    body.absenceReason !== null &&
    !Object.values(AbsenceReason).includes(body.absenceReason as AbsenceReason)
  )
    invalid('El motivo de ausencia no es válido');
  return {
    type: body.type as IntervalType,
    startTime: body.startTime === null ? null : timestamp(body.startTime),
    endTime: body.endTime === null ? null : timestamp(body.endTime),
    absenceReason: body.absenceReason as AbsenceReason | null,
    observations: nullableString(body.observations),
  };
}
export function createInput(value: unknown) {
  const body = object(value, ['userId', 'workplaceId', 'date', 'observations', 'intervals']);
  if (!Array.isArray(body.intervals) || !body.intervals.length)
    invalid('Debe incluir al menos un intervalo');
  return {
    userId: recordId(body.userId),
    workplaceId: recordId(body.workplaceId),
    date: civilDate(body.date),
    observations: nullableString(body.observations),
    intervals: body.intervals.map((i) => intervalInput(i)),
  };
}
export type IntervalChange =
  | { operation: 'ADD'; interval: IntervalFields }
  | { operation: 'UPDATE'; id: string; interval: IntervalFields }
  | { operation: 'DELETE'; id: string };
export function updateInput(value: unknown) {
  const body = object(value, ['expectedVersion', 'observations', 'intervalChanges']);
  const changes: IntervalChange[] = [];
  const seen = new Set<string>();
  if ('intervalChanges' in body) {
    if (!Array.isArray(body.intervalChanges)) invalid('Los cambios de intervalos no son válidos');
    for (const raw of body.intervalChanges) {
      const c = object(raw, ['operation', 'id', 'interval']);
      if (c.operation === 'ADD') {
        if ('id' in c) invalid();
        changes.push({ operation: 'ADD', interval: intervalInput(c.interval) });
      } else if (c.operation === 'UPDATE' || c.operation === 'DELETE') {
        const id = recordId(c.id);
        if (seen.has(id)) invalid('No se permite modificar dos veces el mismo intervalo');
        seen.add(id);
        if (c.operation === 'DELETE') {
          if ('interval' in c) invalid();
          changes.push({ operation: 'DELETE', id });
        } else changes.push({ operation: 'UPDATE', id, interval: intervalInput(c.interval) });
      } else invalid('La operación de intervalo no es válida');
    }
  }
  return {
    expectedVersion: expectedVersion(body.expectedVersion),
    ...('observations' in body ? { observations: nullableString(body.observations) } : {}),
    changes,
  };
}
export function reviewInput(value: unknown) {
  const body = object(value, ['expectedVersion', 'reviewStatus']);
  if (body.reviewStatus !== 'APPROVED') invalid('Solo se permite aprobar un registro');
  return { expectedVersion: expectedVersion(body.expectedVersion) };
}
export interface MonthlyQuery {
  month: number;
  year: number;
  page: number;
  pageSize: number;
  siteId?: string;
  employeeId?: string;
  workplaceId?: string;
  clientId?: string;
  status?: RecordStatus;
  reviewStatus?: ReviewStatus;
  origin?: RecordOrigin;
  hasAbsence?: true;
  snapshotToken?: string;
}
export function monthlyQuery(value: unknown): MonthlyQuery {
  const body = object(value, [
    'month',
    'year',
    'page',
    'pageSize',
    'siteId',
    'employeeId',
    'workplaceId',
    'clientId',
    'status',
    'reviewStatus',
    'origin',
    'hasAbsence',
    'snapshotToken',
  ]);
  function int(value: unknown, min: number, max: number, fallback?: number) {
    if (value === undefined && fallback !== undefined) return fallback;
    if (
      typeof value !== 'string' ||
      !/^\d+$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) < min ||
      Number(value) > max
    )
      invalid('El período o la paginación no son válidos');
    return Number(value);
  }
  const q: MonthlyQuery = {
    month: int(body.month, 1, 12),
    year: int(body.year, 1, 9999),
    page: int(body.page, 1, Number.MAX_SAFE_INTEGER, 1),
    pageSize: int(body.pageSize, 1, 100, 50),
  };
  if (!Number.isSafeInteger((q.page - 1) * q.pageSize)) invalid('La paginación no es válida');
  for (const key of ['siteId', 'employeeId', 'workplaceId', 'clientId'] as const)
    if (key in body) q[key] = recordId(body[key]);
  for (const [key, values] of [
    ['status', Object.values(RecordStatus)],
    ['reviewStatus', Object.values(ReviewStatus)],
    ['origin', Object.values(RecordOrigin)],
  ] as const) {
    if (key in body) {
      if (typeof body[key] !== 'string' || !(values as readonly string[]).includes(body[key]))
        invalid('El filtro no es válido');
      Object.assign(q, { [key]: body[key] });
    }
  }
  if ('hasAbsence' in body) {
    if (body.hasAbsence !== 'true') invalid('El filtro de ausencia no es válido');
    q.hasAbsence = true;
  }
  if ('snapshotToken' in body) {
    if (typeof body.snapshotToken !== 'string' || !body.snapshotToken)
      invalid('El snapshot no es válido');
    q.snapshotToken = body.snapshotToken;
  }
  return q;
}
