import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  ValidateIf,
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

  @ValidateIf((env: EnvironmentVariables) => env.EMAIL_PROVIDER === 'resend')
  @IsString()
  @Matches(/\S/)
  RESEND_API_KEY!: string;

  @ValidateIf((env: EnvironmentVariables) => env.EMAIL_PROVIDER === 'resend')
  @IsString()
  @Matches(/\S/)
  EMAIL_FROM!: string;

  @ValidateIf((env: EnvironmentVariables) => env.WHATSAPP_PROVIDER === 'meta')
  @IsString()
  @Matches(/\S/)
  WHATSAPP_TOKEN!: string;

  @ValidateIf((env: EnvironmentVariables) => env.WHATSAPP_PROVIDER === 'meta')
  @IsString()
  @Matches(/\S/)
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
  @Matches(/^[a-z][a-z0-9+.-]*$/)
  MOBILE_DEEP_LINK_SCHEME!: string;

  @ValidateIf((env: EnvironmentVariables) => env.WHATSAPP_PROVIDER === 'meta')
  @Matches(/^v\d+\.\d+$/)
  WHATSAPP_API_VERSION!: string;

  @ValidateIf((env: EnvironmentVariables) => env.WHATSAPP_PROVIDER === 'meta')
  @Matches(/^[a-z0-9_]+$/)
  WHATSAPP_OTP_TEMPLATE_NAME!: string;

  @ValidateIf((env: EnvironmentVariables) => env.WHATSAPP_PROVIDER === 'meta')
  @Matches(/^[a-z]{2,3}(?:_[A-Z]{2})?$/)
  WHATSAPP_TEMPLATE_LANGUAGE!: string;

  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  API_PUBLIC_URL!: string;

  /** Dev switch: providers log to console instead of calling external services. */
  @IsString()
  @IsNotEmpty()
  @IsIn(['log', 'resend'])
  EMAIL_PROVIDER!: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['log', 'meta'])
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
    API_PUBLIC_URL: 'http://localhost:3000',
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
    throw new Error(`Invalid environment configuration. Fix the following variables: ${details}`);
  }

  if (validated.JWT_ACCESS_SECRET === validated.JWT_REFRESH_SECRET) {
    throw new Error('JWT access and refresh secrets must be distinct');
  }
  const apiUrl = new URL(validated.API_PUBLIC_URL);
  if (
    apiUrl.username ||
    apiUrl.password ||
    apiUrl.pathname !== '/' ||
    apiUrl.search ||
    apiUrl.hash
  ) {
    throw new Error('API_PUBLIC_URL must be a pure origin without credentials/path/query/hash');
  }
  if (validated.NODE_ENV === 'production') {
    if (validated.EMAIL_PROVIDER === 'log' || validated.WHATSAPP_PROVIDER === 'log') {
      throw new Error(
        'Log notification providers are not implemented for production; select real notification providers',
      );
    }
    if (!config.API_PUBLIC_URL || apiUrl.protocol !== 'https:') {
      throw new Error('API_PUBLIC_URL requires explicit HTTPS in production');
    }
    if (new URL(validated.ADMIN_FRONTEND_URL).protocol !== 'https:') {
      throw new Error('ADMIN_FRONTEND_URL requires HTTPS in production');
    }
  }
  if (validated.WHATSAPP_PROVIDER === 'meta' && !/^\d+$/.test(validated.WHATSAPP_PHONE_NUMBER_ID)) {
    throw new Error('Invalid WHATSAPP_PHONE_NUMBER_ID');
  }
  if (
    validated.EMAIL_PROVIDER === 'resend' &&
    !/^[^<>\s@]+@[^<>\s@]+(?:\.[^<>\s@]+)+(?:>)?$/.test(
      validated.EMAIL_FROM.match(/<([^<>]+)>$/)?.[1] ?? validated.EMAIL_FROM,
    )
  ) {
    throw new Error('Invalid EMAIL_FROM');
  }
  return validated;
}
