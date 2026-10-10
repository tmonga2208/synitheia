import type { SyncHealthInput } from '@synitheia/shared';

/**
 * Why a connect attempt ended the way it did.
 *
 * `unavailable`      this device has no health store the app can talk to: an iPad, Android
 *                    below 9, or a build the Android module did not link into.
 * `update_required`  Android 9 to 13 only: Health Connect is a separate app there, and it
 *                    is missing or too old. The user can fix this from the Play Store.
 * `unauthorized`     the store is there but nothing can be read. On iPhone this is almost
 *                    always the HealthKit entitlement being stripped at signing — Apple
 *                    only grants it to a PAID developer account — or "Don't Allow". On
 *                    Android it means no data type was granted.
 */
export type HealthConnectResult = 'connected' | 'unavailable' | 'unauthorized' | 'update_required';

/** What one platform's health store has to provide. */
export interface HealthReader {
  isAvailable(): Promise<boolean>;
  /** Ask the OS for access. Never throws. */
  connect(): Promise<HealthConnectResult>;
  /** The last `days` local days, or null when there is nothing to read from. Never throws. */
  readHealth(days: number): Promise<SyncHealthInput | null>;
}
