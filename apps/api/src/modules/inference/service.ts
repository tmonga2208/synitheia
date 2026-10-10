import { Types } from 'mongoose';
import type { FastifyBaseLogger } from 'fastify';
import type { LocalDate } from '@synitheia/shared';
import type { AuthedUser } from '../../core/auth-guard.js';
import { HabitLogModel, HabitModel } from '../../db/models.js';
import { logHabit } from '../habits/service.js';

export interface HabitConfirmResult {
  logged: boolean;
  reason?: 'already_complete' | 'habit_gone';
}

/**
 * The write behind "Mark Morning run done?".
 *
 * Goes through `logHabit`, so streaks, XP and the timeline event are exactly what a tap
 * on the habit card would produce. The two early returns are not errors: a suggestion
 * can sit for hours, and by the time it is confirmed the user may have ticked the habit
 * themselves or archived it. Confirming then should close the card, not double-count or
 * fail with a message about a habit they can no longer see.
 */
export async function confirmHabitSuggestion(
  user: AuthedUser,
  suggestion: { localDate: LocalDate; proposed: { habitId: string; count: number } },
  logger?: Pick<FastifyBaseLogger, 'warn'>,
): Promise<HabitConfirmResult> {
  const userId = new Types.ObjectId(user.id);
  const habitObjectId = new Types.ObjectId(suggestion.proposed.habitId);

  const habit = await HabitModel.findOne({ _id: habitObjectId, userId }).lean();
  if (!habit || habit.archivedAt) return { logged: false, reason: 'habit_gone' };

  const existing = await HabitLogModel.findOne({
    userId,
    habitId: habitObjectId,
    localDate: suggestion.localDate,
  }).lean();

  if ((existing?.count ?? 0) >= habit.targetCount) {
    return { logged: false, reason: 'already_complete' };
  }

  await logHabit(
    user,
    suggestion.proposed.habitId,
    // The suggestion's own day, not today: a card confirmed after midnight belongs to
    // the day the workout happened.
    { localDate: suggestion.localDate, increment: suggestion.proposed.count },
    logger,
    'inferred',
  );

  return { logged: true };
}
