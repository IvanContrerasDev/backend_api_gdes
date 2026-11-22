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
    const weak = (message: string) => {
      throw new ApiException(400, 'WEAK_PASSWORD', message);
    };
    if (typeof value !== 'string') weak('La contraseña debe tener entre 8 y 30 caracteres');
    const password = value as string;
    if ([...password].length < 8 || [...password].length > 30)
      weak('La contraseña debe tener entre 8 y 30 caracteres');
    const normalized = password.normalize('NFKC').trim().toLowerCase();
    // Check simple case/space and trailing number/symbol variants without
    // modifying the original value passed to Argon2.
    const base = normalized.replace(/[\d\p{P}\p{S}]+$/u, '');
    if (this.common.has(normalized) || this.common.has(base))
      weak(
        'La contraseña es demasiado común o una variante conocida. Elegí otra contraseña menos predecible',
      );
  }
}
