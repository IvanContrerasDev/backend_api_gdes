import { DocumentType, TimesheetStatus } from '@prisma/client';
import { isUUID } from 'class-validator';
import { AuthenticatedUser } from '../../common/guards/jwt-auth.guard';
import { visibleName } from './file-validation';
import { invalidFileData } from './files.errors';

export function object(value: unknown, allowed: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidFileData();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    invalidFileData('La solicitud contiene campos no permitidos');
  return body;
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !isUUID(value)) invalidFileData('El identificador no es válido');
  return value.toLowerCase();
}
export function integer(value: unknown, min: number, max: number, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) invalidFileData();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) invalidFileData();
  return parsed;
}
export function documentType(value: unknown): DocumentType {
  if (typeof value !== 'string' || !Object.values(DocumentType).includes(value as DocumentType))
    invalidFileData('El tipo de documento no es válido');
  return value as DocumentType;
}
export function status(value: unknown): TimesheetStatus {
  if (
    typeof value !== 'string' ||
    !Object.values(TimesheetStatus).includes(value as TimesheetStatus)
  )
    invalidFileData('El estado de la planilla no es válido');
  return value as TimesheetStatus;
}
export function uploadInput(value: unknown, auth: AuthenticatedUser, timesheet: boolean) {
  const admin = auth.role !== 'EMPLOYEE';
  const body = object(value, [
    ...(admin ? ['employeeId'] : []),
    'workplaceId',
    ...(timesheet ? ['month', 'year'] : ['type']),
  ]);
  const employeeId = admin ? uuid(body.employeeId) : auth.id;
  const workplaceId =
    !timesheet &&
    (body.workplaceId === undefined || body.workplaceId === '' || body.workplaceId === 'null')
      ? null
      : uuid(body.workplaceId);
  return {
    employeeId,
    workplaceId,
    ...(timesheet
      ? { month: integer(body.month, 1, 12), year: integer(body.year, 2000, 9999) }
      : { type: documentType(body.type) }),
  };
}
export function replacementInput(value: unknown) {
  const body = object(value, ['expectedVersion']);
  return integer(body.expectedVersion, 1, 2147483647);
}
export function statusInput(value: unknown) {
  return status(object(value, ['status']).status);
}
export function documentUpdate(value: unknown) {
  const body = object(value, ['fileName', 'type']);
  if (!Object.keys(body).length) invalidFileData('Debe indicar un cambio');
  return {
    ...('fileName' in body ? { fileName: visibleName(body.fileName) } : {}),
    ...('type' in body ? { type: documentType(body.type) } : {}),
  };
}
function civilDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000'))
    invalidFileData('La fecha no es válida');
  const parsed = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    invalidFileData('La fecha no es válida');
  return value;
}
export interface FileQuery {
  page: number;
  pageSize: number;
  search?: string;
  employeeId?: string;
  clientId?: string;
  workplaceId?: string;
  siteId?: string;
  month?: number;
  year?: number;
  status?: TimesheetStatus;
  type?: DocumentType;
  uploadedBy?: string;
  uploadedFrom?: string;
  uploadedTo?: string;
}
export function listQuery(value: unknown, timesheet: boolean): FileQuery {
  const body = object(value, [
    'page',
    'pageSize',
    'search',
    'employeeId',
    ...(timesheet
      ? ['clientId', 'workplaceId', 'siteId', 'month', 'year', 'status']
      : ['type', 'uploadedBy', 'uploadedFrom', 'uploadedTo']),
  ]);
  const q: FileQuery = {
    page: integer(body.page, 1, Number.MAX_SAFE_INTEGER, 1),
    pageSize: integer(body.pageSize, 1, 100, 25),
  };
  if (!Number.isSafeInteger((q.page - 1) * q.pageSize)) invalidFileData();
  for (const key of ['employeeId', 'clientId', 'workplaceId', 'siteId'] as const)
    if (key in body) q[key] = uuid(body[key]);
  for (const key of ['search', 'uploadedBy'] as const)
    if (key in body) {
      if (typeof body[key] !== 'string') invalidFileData();
      q[key] = body[key].trim();
    }
  if ('month' in body) q.month = integer(body.month, 1, 12);
  if ('year' in body) q.year = integer(body.year, 2000, 9999);
  if ('status' in body) q.status = status(body.status);
  if ('type' in body) q.type = documentType(body.type);
  if ('uploadedFrom' in body) q.uploadedFrom = civilDate(body.uploadedFrom);
  if ('uploadedTo' in body) q.uploadedTo = civilDate(body.uploadedTo);
  if (q.uploadedFrom && q.uploadedTo && q.uploadedFrom > q.uploadedTo)
    invalidFileData('El rango de fechas no es válido');
  return q;
}
