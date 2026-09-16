import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
} from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

/**
 * Required environment variables, validated at boot (fail fast).
 * Source of truth: docs/01-arquitectura-y-stack.md ("Variables de entorno (mínimo)").
 */
class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  JWT_REFRESH_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  RESEND_API_KEY!: string;

  @IsString()
  @IsNotEmpty()
  EMAIL_FROM!: string;

  @IsString()
  @IsNotEmpty()
  WHATSAPP_TOKEN!: string;

  @IsString()
  @IsNotEmpty()
  WHATSAPP_PHONE_NUMBER_ID!: string;

  @IsString()
  @IsNotEmpty()
  STORAGE_ENDPOINT!: string;

  @IsString()
  @IsNotEmpty()
  STORAGE_BUCKET!: string;

  @IsString()
  @IsNotEmpty()
  STORAGE_REGION!: string;

  @IsString()
  @IsNotEmpty()
  STORAGE_ACCESS_KEY_ID!: string;

  @IsString()
  @IsNotEmpty()
  STORAGE_SECRET_ACCESS_KEY!: string;

  @IsString()
  @IsNotEmpty()
  GOOGLE_CLIENT_ID!: string;

  @IsInt()
  @Min(0)
  GEOFENCE_TOLERANCE_METERS!: number;

  @IsInt()
  @Min(1)
  @Max(1440)
  OTP_TTL_MINUTES!: number;

  @IsUrl({ require_tld: false })
  ADMIN_FRONTEND_URL!: string;

  @IsString()
  @IsNotEmpty()
  MOBILE_DEEP_LINK_SCHEME!: string;

  /** Dev switch: providers log to console instead of calling external services. */
  @IsString()
  @IsNotEmpty()
  EMAIL_PROVIDER!: string;

  @IsString()
  @IsNotEmpty()
  WHATSAPP_PROVIDER!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT!: number;

  @IsString()
  @IsOptional()
  NODE_ENV?: string;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const merged: Record<string, unknown> = {
    GEOFENCE_TOLERANCE_METERS: '100',
    OTP_TTL_MINUTES: '10',
    EMAIL_PROVIDER: 'log',
    WHATSAPP_PROVIDER: 'log',
    PORT: '3000',
    ...config,
  };

  const validated = plainToInstance(EnvironmentVariables, merged, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const details = errors
      .map((error) => `${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`)
      .join('; ');
    throw new Error(
      `Invalid environment configuration. Fix the following variables: ${details}`,
    );
  }

  return validated;
}
