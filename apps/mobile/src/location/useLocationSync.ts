import { useCallback, useRef } from 'react';
import * as Location from 'expo-location';
import { type PlaceVisit } from '@synitheia/shared';
import { api } from '../api/client.js';
import {
  deviceLocalDate,
  getApproxPosition,
  isSupported,
  requestLocationPermission,
} from '../geo/geo.js';

/**
 * Location rides on the same foreground grant as Weather. `unauthorized` is a plain
 * "Don't Allow"; no special entitlement is involved.
 */
export type LocationConnectResult = 'connected' | 'unavailable' | 'unauthorized';

export async function connectLocation(): Promise<LocationConnectResult> {
  if (!isSupported()) return 'unavailable';
  return (await requestLocationPermission()) ? 'connected' : 'unauthorized';
}

/** Build a human place name out of a reverse-geocode, or null if it named nothing useful. */
function labelFrom(address: Location.LocationGeocodedAddress | undefined): string | null {
  if (!address) return null;
  // Prefer the most specific name the OS gave, falling back outward. A point of interest
  // name beats a street beats a district beats a city — but any of them is a real place.
  return address.name ?? address.street ?? address.district ?? address.city ?? null;
}

/**
 * Read where the phone is NOW, name it, and report it as one visit.
 *
 * Foreground and best-effort: this captures the place the app is open at, not a background
 * trail of everywhere you've been. The server dedupes on (day, coarse place), so opening the
 * app three times at home is one "arrived home", not three.
 */
export function useLocationSync(): { sync: () => Promise<void> } {
  const inFlight = useRef(false);

  const sync = useCallback(async () => {
    if (!isSupported() || inFlight.current) return;
    inFlight.current = true;
    try {
      const position = await getApproxPosition();
      if (!position) return;

      let placeLabel = 'A place';
      try {
        const [address] = await Location.reverseGeocodeAsync(position);
        placeLabel = labelFrom(address) ?? placeLabel;
      } catch {
        // Reverse-geocode is a nicety; a visit without a name still marks the day.
      }

      // The rounded coordinate IS the id — coarse enough to recognise "here again", never
      // an address.
      const placeId = `${position.latitude},${position.longitude}`;

      const visit: PlaceVisit = {
        placeId,
        placeLabel,
        arrivedAt: new Date(),
        localDate: deviceLocalDate() as PlaceVisit['localDate'],
      };

      await api.post('/location/sync', { visits: [visit] });
    } catch {
      // Best-effort by definition; a missed sync is not worth interrupting the user.
    } finally {
      inFlight.current = false;
    }
  }, []);

  return { sync };
}
