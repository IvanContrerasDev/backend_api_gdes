import { ApiException } from '../../common/errors/api.exception';

export interface MetricsQuery {
  month: number;
  year: number;
}

export function metricsQuery(value: unknown): MetricsQuery {
  const invalid = (): never => {
    throw new ApiException(422, 'VALIDATION_ERROR', 'El período de las métricas no es válido');
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== 'month' && key !== 'year')) invalid();
  function integer(value: unknown, min: number, max: number): number {
    if (typeof value !== 'string' || !/^\d+$/.test(value)) invalid();
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) invalid();
    return parsed;
  }
  return { month: integer(body.month, 1, 12), year: integer(body.year, 2000, 9999) };
}
