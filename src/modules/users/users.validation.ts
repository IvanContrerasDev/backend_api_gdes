import { AccountStatus } from '@prisma/client';
import { isEmail, isUUID } from 'class-validator';
import { ApiException } from '../../common/errors/api.exception';

export function invalid(code = 'INVALID_USER_DATA'): never {
  throw new ApiException(
    400,
    code,
    code === 'INVALID_SITE' ? 'La provincia no es válida' : 'Los datos del empleado no son válidos',
  );
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
export function uuid(value: unknown, code = 'INVALID_USER_DATA'): string {
  if (typeof value !== 'string' || !isUUID(value)) invalid(code);
  return value;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > max) invalid();
  return value.trim();
}
function digits(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string' || !new RegExp(`^\\d{${min},${max}}$`).test(value)) invalid();
  return value;
}
export function civilDate(value: unknown, now = new Date()): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid();
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    value.startsWith('0000-') ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value ||
    value > new Date(now.getTime() - 3 * 3600000).toISOString().slice(0, 10)
  )
    invalid();
  return date;
}
export interface UserInput {
  firstName?: string;
  lastName?: string;
  employeeId?: string;
  dni?: string;
  email?: string;
  phone?: string;
  address?: string;
  siteId?: string;
  birthDate?: Date;
  cuil?: string | null;
  hireDate?: Date | null;
  position?: string | null;
}
export type CreateInput = Required<Omit<UserInput, 'cuil' | 'hireDate' | 'position'>> & {
  initialPassword: string;
};
export function userInput(value: unknown, create: true): CreateInput;
export function userInput(value: unknown, create: false): UserInput;
export function userInput(value: unknown, create: boolean): UserInput | CreateInput {
  const body = object(value);
  const result: UserInput = {};
  for (const key of [
    'firstName',
    'lastName',
    'employeeId',
    'dni',
    'email',
    'phone',
    'address',
    'siteId',
    'birthDate',
  ] as const) {
    if (!create && body[key] === undefined) continue;
    const v = body[key];
    switch (key) {
      case 'firstName':
      case 'lastName':
        result[key] = text(v, 100);
        break;
      case 'employeeId':
        result[key] = text(v, 50);
        break;
      case 'address':
        result[key] = text(v, 200);
        break;
      case 'dni':
        result[key] = digits(v, 7, 8);
        break;
      case 'phone':
        result[key] = digits(v, 10, 13);
        break;
      case 'siteId':
        result[key] = uuid(v, 'INVALID_SITE');
        break;
      case 'birthDate':
        result[key] = civilDate(v);
        break;
      case 'email': {
        const email = text(v, 254).toLowerCase();
        if (!isEmail(email)) invalid();
        result[key] = email;
        break;
      }
    }
  }
  if (create) {
    // Password validation is deliberately separate; never trim the stored secret.
    return { ...result, initialPassword: body.initialPassword } as CreateInput;
  }
  for (const key of ['cuil', 'hireDate', 'position'] as const) {
    const v = body[key];
    if (v === undefined) continue;
    if (v === null) result[key] = null;
    else if (key === 'cuil') result[key] = digits(v, 11, 11);
    else if (key === 'hireDate') result[key] = civilDate(v);
    else result[key] = text(v, 100);
  }
  return result;
}
export function accountStatus(value: unknown): AccountStatus {
  if (value !== AccountStatus.ACTIVE && value !== AccountStatus.INACTIVE) invalid();
  return value;
}
export function userQuery(value: Record<string, unknown>) {
  if (
    Object.keys(value).some((key) => !['search', 'accountStatus', 'page', 'pageSize'].includes(key))
  )
    invalid();
  const number = (v: unknown, fallback: number, max: number) => {
    if (v === undefined) return fallback;
    if (
      typeof v !== 'string' ||
      !/^[1-9]\d*$/.test(v) ||
      !Number.isSafeInteger(Number(v)) ||
      Number(v) > max
    )
      invalid();
    return Number(v);
  };
  const page = number(value.page, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = number(value.pageSize, 25, 100);
  if (!Number.isSafeInteger((page - 1) * pageSize)) invalid();
  if (value.search !== undefined && typeof value.search !== 'string') invalid();
  return {
    page,
    pageSize,
    search: (value.search as string | undefined)?.trim(),
    accountStatus:
      value.accountStatus === undefined ? undefined : accountStatus(value.accountStatus),
  };
}
