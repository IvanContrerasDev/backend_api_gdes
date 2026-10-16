import { HttpStatus } from '@nestjs/common';
import { EntityStatus } from '@prisma/client';
import { isUUID } from 'class-validator';
import { ApiException } from '../../common/errors/api.exception';

export function fail(
  code: string,
  message = 'Los datos enviados no son válidos',
  status: HttpStatus = HttpStatus.BAD_REQUEST,
): never {
  throw new ApiException(status, code, message);
}
export function uuid(value: unknown, code: string): string {
  if (typeof value !== 'string' || !isUUID(value)) fail(code, 'El identificador no es válido');
  // PostgreSQL UUID identity is case-insensitive; compare one canonical form.
  return value.toLowerCase();
}
export function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}
export function name(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 120)
    fail(code, 'El nombre debe tener entre 1 y 120 caracteres');
  return value.trim();
}
export function status(value: unknown, code: string): EntityStatus {
  if (value !== EntityStatus.ACTIVE && value !== EntityStatus.INACTIVE)
    fail(code, 'El estado no es válido');
  return value;
}
export function clientInput(value: unknown) {
  const body = object(value, 'INVALID_CLIENT_DATA');
  return { name: name(body.name, 'INVALID_CLIENT_DATA') };
}
export function workplaceInput(value: unknown) {
  const body = object(value, 'INVALID_WORKPLACE_DATA');
  const clientId = uuid(body.clientId, 'INVALID_WORKPLACE_DATA');
  const siteId = uuid(body.siteId, 'INVALID_SITE');
  const normalizedName = name(body.name, 'INVALID_WORKPLACE_DATA');
  for (const [field, min, max, integer] of [
    ['latitude', -90, 90, false],
    ['longitude', -180, 180, false],
    ['radiusMeters', 10, 10000, true],
    ['gpsAccuracyThreshold', 1, 1000, true],
  ] as const) {
    const v = body[field];
    if (field === 'gpsAccuracyThreshold' && v === null) continue;
    if (
      typeof v !== 'number' ||
      !Number.isFinite(v) ||
      v < min ||
      v > max ||
      (integer && !Number.isInteger(v))
    )
      fail('INVALID_GEO_CONFIGURATION', 'La configuración geográfica no es válida');
  }
  return {
    clientId,
    siteId,
    name: normalizedName,
    latitude: body.latitude as number,
    longitude: body.longitude as number,
    radiusMeters: body.radiusMeters as number,
    gpsAccuracyThreshold: body.gpsAccuracyThreshold as number | null,
  };
}
export interface ListQuery {
  search?: string;
  status?: EntityStatus;
  clientId?: string;
  siteId?: string;
  page: number;
  pageSize: number;
}
export function listQuery(value: Record<string, unknown>, workplace: boolean): ListQuery {
  const code = workplace ? 'INVALID_WORKPLACE_DATA' : 'INVALID_CLIENT_DATA';
  const allowed = new Set([
    'search',
    'status',
    'page',
    'pageSize',
    ...(workplace ? ['clientId', 'siteId'] : []),
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) fail(code, 'El filtro no es válido');
  const number = (v: unknown, fallback: number, max: number) => {
    if (v === undefined) return fallback;
    if (
      typeof v !== 'string' ||
      !/^[1-9]\d*$/.test(v) ||
      !Number.isSafeInteger(Number(v)) ||
      Number(v) > max
    )
      fail(code, 'La paginación no es válida');
    return Number(v);
  };
  const result: ListQuery = {
    page: number(value.page, 1, Number.MAX_SAFE_INTEGER),
    pageSize: number(value.pageSize, 25, 100),
  };
  if (!Number.isSafeInteger((result.page - 1) * result.pageSize)) fail(code);
  if (value.search !== undefined) {
    if (typeof value.search !== 'string') fail(code);
    result.search = value.search.trim();
  }
  if (value.status !== undefined) result.status = status(value.status, code);
  if (workplace && value.clientId !== undefined) result.clientId = uuid(value.clientId, code);
  if (workplace && value.siteId !== undefined) result.siteId = uuid(value.siteId, 'INVALID_SITE');
  return result;
}
