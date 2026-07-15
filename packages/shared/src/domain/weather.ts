import { z } from 'zod';
import { localDateSchema } from './common.js';

/**
 * Weather is fetched by the SERVER, from a rounded position the phone sends.
 *
 * Two deliberate choices live in that sentence. The weather provider stays server-side, so
 * no third-party key ships in the app. And the phone sends an APPROXIMATE area, never a
 * precise fix — the reader rounds the coordinate to ~1km before it leaves the device, which
 * is all weather needs and is exactly what Connected Context promises ("your approximate
 * area, never a precise position").
 *
 * Latitude and longitude are bounded to real Earth values so a garbage fix can't send the
 * server chasing a lookup for the middle of the ocean at (999, 999).
 */
export const syncWeatherSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  localDate: localDateSchema,
});
export type SyncWeatherInput = z.infer<typeof syncWeatherSchema>;

/**
 * WMO weather codes (what Open-Meteo returns) collapsed to the handful of conditions the
 * timeline actually shows. The exact code is not useful to a person; "rain" is.
 */
export type WeatherCondition =
  | 'clear'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'thunderstorm';

export function conditionFromWmoCode(code: number): WeatherCondition {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2 || code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunderstorm';
  // Anything the table doesn't name is carried as cloudy rather than invented into a storm.
  return 'cloudy';
}
