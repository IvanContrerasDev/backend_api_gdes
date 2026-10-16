import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApiException } from '../../common/errors/api.exception';

@Injectable()
export class PasswordPolicyService {
  private readonly common = new Set(
    readFileSync(join(__dirname, '../../../resources/passwords/10k-most-common.txt'), 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((value) => value.normalize('NFKC').toLowerCase().trim()),
  );

  validate(value: unknown): asserts value is string {
    const weak = () => {
      throw new ApiException(
        400,
        'WEAK_PASSWORD',
        'La contraseña debe tener entre 12 y 128 caracteres y no ser común o comprometida conocida',
      );
    };
    if (typeof value !== 'string') weak();
    const password = value as string;
    if ([...password].length < 12 || [...password].length > 128) weak();
    const normalized = password.normalize('NFKC').trim().toLowerCase();
    // Check simple case/space and trailing number/symbol variants without
    // modifying the original value passed to Argon2.
    const base = normalized.replace(/[\d\p{P}\p{S}]+$/u, '');
    if (this.common.has(normalized) || this.common.has(base)) weak();
  }
}
