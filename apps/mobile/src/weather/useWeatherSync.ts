import { useCallback, useRef } from 'react';
import { api } from '../api/client.js';
import {
  deviceLocalDate,
  getApproxPosition,
  isSupported,
  requestLocationPermission,
} from '../geo/geo.js';

/**
 * Weather rides on location permission — it is the one thing weather needs to know where to
 * look. `unauthorized` here is a plain "Don't Allow"; no special entitlement is involved.
 */
export type WeatherConnectResult = 'connected' | 'unavailable' | 'unauthorized';

export async function connectWeather(): Promise<WeatherConnectResult> {
  if (!isSupported()) return 'unavailable';
  return (await requestLocationPermission()) ? 'connected' : 'unauthorized';
}

/**
 * Send the phone's approximate position; the server fetches the weather there. If there is
 * no position to be had, nothing is sent — a day without a location fix simply has no
 * weather, which is not an error.
 */
export function useWeatherSync(): { sync: () => Promise<void> } {
  const inFlight = useRef(false);

  const sync = useCallback(async () => {
    if (!isSupported() || inFlight.current) return;
    inFlight.current = true;
    try {
      const position = await getApproxPosition();
      if (!position) return;
      await api.post('/weather/sync', {
        latitude: position.latitude,
        longitude: position.longitude,
        localDate: deviceLocalDate(),
      });
    } catch {
      // Weather is context, not a record the user owns; a failed sync is not worth a message.
    } finally {
      inFlight.current = false;
    }
  }, []);

  return { sync };
}
