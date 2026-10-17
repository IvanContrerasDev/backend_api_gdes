import { isEmail } from 'class-validator';
import { PasswordPolicyService } from '../users/password-policy.service';
import { userInput } from '../users/users.validation';
import { failure } from './auth.service';

export function validation(): never {
  throw failure(422, 'VALIDATION_ERROR', 'Los datos de autenticación no son válidos');
}
export function bodyFields(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) validation();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== keys.length || Object.keys(body).some((k) => !keys.includes(k)))
    validation();
  return body;
}
export function strongPassword(value: unknown, policy: PasswordPolicyService): string {
  try {
    policy.validate(value);
  } catch {
    validation();
  }
  return value as string;
}
export function registrationInput(value: unknown, policy: PasswordPolicyService) {
  const body = bodyFields(value, [
    'firstName',
    'lastName',
    'email',
    'password',
    'phone',
    'employeeId',
    'dni',
    'address',
    'siteId',
    'birthDate',
  ]);
  let fields;
  try {
    fields = userInput({ ...body, initialPassword: body.password }, true);
  } catch {
    validation();
  }
  const { initialPassword, ...profile } = fields;
  void initialPassword;
  return { profile, password: strongPassword(body.password, policy) };
}
export function emailInput(value: unknown): string {
  const body = bodyFields(value, ['email']);
  if (typeof body.email !== 'string') validation();
  const email = body.email.trim().toLowerCase();
  if (email.length > 254 || !isEmail(email)) validation();
  return email;
}
export function googleInput(value: unknown): { idToken: string; phone: string } {
  const body = bodyFields(value, ['idToken', 'phone']);
  if (
    typeof body.idToken !== 'string' ||
    !body.idToken ||
    body.idToken.length > 16384 ||
    typeof body.phone !== 'string' ||
    !/^\d{10,13}$/.test(body.phone)
  )
    validation();
  return { idToken: body.idToken, phone: body.phone };
}
export function resetInput(value: unknown): { token: string; newPassword: unknown } {
  const body = bodyFields(value, ['token', 'newPassword']);
  if (typeof body.token !== 'string' || !body.token || body.token.length > 4096) validation();
  return { token: body.token, newPassword: body.newPassword };
}
