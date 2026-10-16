import { IsBoolean, IsEnum, ValidateIf, IsString, IsUUID, Length, Matches } from 'class-validator';
import { AuthClient } from '@prisma/client';
export class LoginDto {
  @IsString({ message: 'El identificador es obligatorio' })
  @Length(1, 254, { message: 'Identificador inválido' })
  identifier!: string;
  @IsString({ message: 'La contraseña es obligatoria' })
  @Length(1, 128, { message: 'Contraseña inválida' })
  password!: string;
  @IsEnum(AuthClient, { message: 'Cliente inválido' }) client!: AuthClient;
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsBoolean({ message: 'Recordar sesión debe ser booleano' })
  rememberSession?: boolean;
}
export class ChallengeDto {
  @IsUUID('all', { message: 'Challenge inválido' }) challengeId!: string;
}
export class VerifyDto extends ChallengeDto {
  @IsString({ message: 'Valor requerido en formato texto' })
  @Matches(/^\d{6}$/, { message: 'El código debe contener seis dígitos' })
  code!: string;
}
export class RefreshDto {
  @IsString({ message: 'Valor requerido en formato texto' })
  @Length(32, 200, { message: 'Refresh inválido' })
  refreshToken!: string;
}
