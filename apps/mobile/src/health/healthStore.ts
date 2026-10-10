import { Platform } from 'react-native';
import type { SyncHealthInput } from '@synitheia/shared';
import { healthConnectReader } from './healthConnect.js';
import { healthkitReader } from './healthkit.js';
import type { HealthConnectResult, HealthReader } from './types.js';

export type { HealthConnectResult } from './types.js';

/**
 * The phone's health store, whichever phone this is.
 *
 * The only health module the rest of the app imports. Apple Health and Health Connect are
 * different native libraries with different permission models, and none of that is the
 * business of a sync runner or a settings screen: they ask for "the last seven days" and
 * get the same shape back on both.
 *
 * Importing both readers here is safe on both platforms. healthkit.ts imports a library
 * that is inert on Android, and healthConnect.ts imports nothing native until it is called.
 */
function reader(): HealthReader | null {
  if (Platform.OS === 'ios') return healthkitReader;
  if (Platform.OS === 'android') return healthConnectReader;
  return null;
}

export function isSupported(): boolean {
  return reader() !== null;
}

/**
 * What the user's phone actually calls its health store.
 *
 * The UI must never hardcode "Apple Health". An Android user told to "add it in the Health
 * app" would be sent looking for something that does not exist on their phone. Naming the
 * source is a platform question, so it gets answered in exactly one place.
 */
export function healthSourceName(): string {
  if (Platform.OS === 'ios') return 'Apple Health';
  if (Platform.OS === 'android') return 'Health Connect';
  return 'your health app';
}

export async function isAvailable(): Promise<boolean> {
  return (await reader()?.isAvailable()) ?? false;
}

/**
 * Turning the Health source on: the OS's grant first, ours second, so a user who declines
 * the system sheet never gets a "connected" row promising data we cannot read.
 */
export async function connectHealth(): Promise<HealthConnectResult> {
  return (await reader()?.connect()) ?? 'unavailable';
}

export async function readHealth(days = 7): Promise<SyncHealthInput | null> {
  return (await reader()?.readHealth(days)) ?? null;
}
