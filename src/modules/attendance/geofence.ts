import { ApiException } from '../../common/errors/api.exception';

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radians = (v: number) => (v * Math.PI) / 180;
  const a =
    Math.sin(radians(lat2 - lat1) / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(radians(lon2 - lon1) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

/** True means accepted and needing review; it never blocks for accuracy alone. */
export function geofenceReview(
  workplace: {
    latitude: number;
    longitude: number;
    radiusMeters: number;
    gpsAccuracyThreshold: number | null;
  },
  latitude: number,
  longitude: number,
  accuracy: number,
  tolerance: number,
): boolean {
  const distance = haversineMeters(latitude, longitude, workplace.latitude, workplace.longitude);
  if (distance > workplace.radiusMeters + tolerance)
    throw new ApiException(
      403,
      'OUT_OF_WORKPLACE_AREA',
      'La marcación está fuera del lugar de trabajo',
    );
  return (
    distance > workplace.radiusMeters ||
    (workplace.gpsAccuracyThreshold !== null && accuracy > workplace.gpsAccuracyThreshold)
  );
}
