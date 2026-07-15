import { Types } from 'mongoose';
import type { SyncLocationInput } from '@synitheia/shared';
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
    source: 'location',
  }).lean();

  if (connection?.status !== 'connected') {
    throw AppError.forbidden('Location is not connected. Turn it on in Connected Context.');
  }
}

export async function sync(
  user: AuthedUser,
  input: SyncLocationInput,
): Promise<{ visits: number; added: number }> {
  const userId = new Types.ObjectId(user.id);
  await requireConsent(userId);

  let added = 0;

  for (const visit of input.visits) {
    const label = visit.placeLabel.trim() || 'A place';

    // One arrival per place per local day: revisiting the same coarse spot within a day
    // updates the row rather than stacking "Arrived · Arrived · Arrived". The placeId is
    // already a rounded coordinate, so "the same place" is intentionally fuzzy.
    const { created } = await engine.emit({
      userId: user.id,
      source: 'location',
      timestamp: new Date(visit.arrivedAt),
      timezone: user.timezone,
      metadata: {
        type: 'location.arrived',
        placeLabel: label,
        placeId: visit.placeId,
      },
      dedupeKey: engine.dedupeKey('location', 'arrived', `${visit.localDate}:${visit.placeId}`),
    });

    if (created) added += 1;
  }

  await DataSourceConnectionModel.updateOne(
    { userId, source: 'location' },
    { $set: { lastSyncedAt: new Date(), lastSyncError: null }, $inc: { eventCount: added } },
  );

  return { visits: input.visits.length, added };
}
