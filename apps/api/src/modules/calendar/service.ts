import { Types } from 'mongoose';
import type { SyncCalendarInput } from '@synitheia/shared';
import { DataSourceConnectionModel } from '../../db/models.js';
import { AppError } from '../../core/errors.js';
import * as engine from '../../context/engine.js';

interface AuthedUser {
  id: string;
  timezone: string;
}

/**
 * Calendar is read ONLY with a live consent record — the same rule Health follows.
 *
 * The OS grant and our "Calendar" switch in Connected Context are different things: iOS
 * remembers a grant indefinitely, but the switch is what the user believes they control. If
 * they disagree, ours wins, so turning the source off actually stops ingestion instead of
 * quietly continuing because iOS still says yes.
 */
async function requireConsent(userId: Types.ObjectId): Promise<void> {
  const connection = await DataSourceConnectionModel.findOne({
    userId,
    source: 'calendar',
  }).lean();

  if (connection?.status !== 'connected') {
    throw AppError.forbidden('Calendar is not connected. Turn it on in Connected Context.');
  }
}

export async function sync(
  user: AuthedUser,
  input: SyncCalendarInput,
): Promise<{ events: number; added: number }> {
  const userId = new Types.ObjectId(user.id);
  await requireConsent(userId);

  const now = Date.now();
  let added = 0;

  for (const event of input.events) {
    const started = new Date(event.startsAt);
    const ended = new Date(event.endsAt);
    const durationMin = Math.max(0, Math.round((ended.getTime() - started.getTime()) / 60_000));
    // An event with no title is carried as "Busy" — shown, never invented into something
    // specific the user didn't write.
    const title = event.title.trim() || 'Busy';

    // Emitted through the same idempotent path as everything else: `externalId` in the
    // dedupe key means re-syncing the week updates each meeting's row rather than stacking
    // a second copy. `created` tells us whether this was genuinely new, for the count.
    const { created } = await engine.emit({
      userId: user.id,
      source: 'calendar',
      timestamp: started,
      timezone: user.timezone,
      metadata: {
        type: 'calendar.started',
        title,
        durationMin,
        isAllDay: event.isAllDay,
      },
      dedupeKey: engine.dedupeKey('calendar', 'event', event.externalId),
    });

    if (created) added += 1;
  }

  await DataSourceConnectionModel.updateOne(
    { userId, source: 'calendar' },
    {
      $set: { lastSyncedAt: new Date(now), lastSyncError: null },
      $inc: { eventCount: added },
    },
  );

  return { events: input.events.length, added };
}
