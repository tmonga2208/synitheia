import { Types } from 'mongoose';
import { conditionFromWmoCode, type SyncWeatherInput } from '@synitheia/shared';
import { DataSourceConnectionModel } from '../../db/models.js';
import { AppError } from '../../core/errors.js';
import * as engine from '../../context/engine.js';

interface AuthedUser {
  id: string;
  timezone: string;
}

async function requireConsent(userId: Types.ObjectId): Promise<void> {
  const connection = await DataSourceConnectionModel.findOne({
    userId,
    source: 'weather',
  }).lean();

  if (connection?.status !== 'connected') {
    throw AppError.forbidden('Weather is not connected. Turn it on in Connected Context.');
  }
}

/**
 * Open-Meteo: free, keyless, and it answers the one question we have — what is it doing
 * outside, roughly, right now. No account, so nothing to leak; the only thing that reaches
 * it is the approximate coordinate the phone already rounded.
 */
async function fetchCurrentWeather(
  latitude: number,
  longitude: number,
): Promise<{ tempC: number; code: number } | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    `&current=temperature_2m,weather_code`;

  try {
    // A weather lookup must never hold up a sync. If it is slow or down, the day simply
    // goes without weather rather than the request hanging.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const body = (await res.json()) as {
      current?: { temperature_2m?: number; weather_code?: number };
    };
    const temp = body.current?.temperature_2m;
    const code = body.current?.weather_code;
    if (typeof temp !== 'number' || typeof code !== 'number') return null;

    return { tempC: temp, code };
  } catch {
    return null;
  }
}

export async function sync(
  user: AuthedUser,
  input: SyncWeatherInput,
): Promise<{ observed: boolean }> {
  const userId = new Types.ObjectId(user.id);
  await requireConsent(userId);

  const weather = await fetchCurrentWeather(input.latitude, input.longitude);
  if (!weather) {
    // Not an error the user should see — weather is context, not a record they own. Note the
    // failure on the connection so the screen can say "couldn't reach the weather service".
    await DataSourceConnectionModel.updateOne(
      { userId, source: 'weather' },
      { $set: { lastSyncError: 'The weather service could not be reached.' } },
    );
    return { observed: false };
  }

  // Midday of the local day, so the observation sits inside the day it describes.
  const timestamp = new Date(`${input.localDate}T12:00:00.000Z`);

  await engine.emit({
    userId: user.id,
    source: 'weather',
    timestamp,
    timezone: user.timezone,
    metadata: {
      type: 'weather.observed',
      conditionCode: conditionFromWmoCode(weather.code),
      tempC: Math.round(weather.tempC),
    },
    // One observation per local day — a re-sync refreshes it, never stacks a second.
    dedupeKey: engine.dedupeKey('weather', 'observed', input.localDate),
  });

  await DataSourceConnectionModel.updateOne(
    { userId, source: 'weather' },
    { $set: { lastSyncedAt: new Date(), lastSyncError: null }, $inc: { eventCount: 1 } },
  );

  return { observed: true };
}
