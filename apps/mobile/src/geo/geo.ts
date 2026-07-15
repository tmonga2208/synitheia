import { Platform } from 'react-native';
import * as Location from 'expo-location';

/**
 * Location, read on the device — the shared foundation for both Weather and the Location
 * source. Foreground only: the app never asks for "always" access, so it can read where you
 * are when you have it open and never in the background.
 */

export function isSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

export async function requestLocationPermission(): Promise<boolean> {
  try {
    const { granted } = await Location.requestForegroundPermissionsAsync();
    return granted;
  } catch {
    return false;
  }
}

/** The local calendar day in the device's own zone — the day the app means. */
export function deviceLocalDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * An APPROXIMATE position, rounded to ~1km, or null if it can't be had.
 *
 * The rounding is the privacy promise made real: two decimal places is about a kilometre,
 * which is all weather and "roughly where you are" need, and is deliberately too coarse to
 * pin down a home. Low accuracy is requested for the same reason, and because a precise fix
 * costs battery for precision we throw away. Last-known first — it's instant and usually
 * good enough; a live fix only if there's nothing cached.
 */
export async function getApproxPosition(): Promise<{
  latitude: number;
  longitude: number;
} | null> {
  try {
    const position =
      (await Location.getLastKnownPositionAsync()) ??
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));
    if (!position) return null;

    const round = (n: number): number => Math.round(n * 100) / 100;
    return {
      latitude: round(position.coords.latitude),
      longitude: round(position.coords.longitude),
    };
  } catch {
    return null;
  }
}
