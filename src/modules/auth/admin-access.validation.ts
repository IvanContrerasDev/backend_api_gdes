import { isUUID } from 'class-validator';
import { userInput } from '../users/users.validation';
import { bodyFields, validation } from './auth-advanced.validation';
export function adminAccessInput(value: unknown) {
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
  if (
    typeof body.password !== 'string' ||
    [...body.password].length < 1 ||
    [...body.password].length > 128
  )
    validation();
  try {
    const { initialPassword, ...profile } = userInput(
      { ...body, initialPassword: body.password },
      true,
    );
    return {
      profile: { ...profile, siteId: profile.siteId.toLowerCase() },
      password: initialPassword,
    };
  } catch {
    validation();
  }
}
export function adminChallengeInput(value: unknown, verify: boolean) {
  const body = bodyFields(value, verify ? ['challengeId', 'code'] : ['challengeId']);
  if (typeof body.challengeId !== 'string' || !isUUID(body.challengeId)) validation();
  if (verify && (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code))) validation();
  return { id: body.challengeId.toLowerCase(), code: body.code as string };
}
export function adminDecisionInput(value: unknown) {
  const body = bodyFields(value, ['token', 'decision']);
  if (
    typeof body.token !== 'string' ||
    !body.token ||
    body.token.length > 4096 ||
    !['APPROVE', 'REJECT'].includes(body.decision as string)
  )
    validation();
  return { token: body.token, decision: body.decision as 'APPROVE' | 'REJECT' };
}
