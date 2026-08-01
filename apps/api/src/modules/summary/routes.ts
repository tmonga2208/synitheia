import { Types } from 'mongoose';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  DEFAULT_TRACKED_DOMAINS,
  asMonthKey,
  firstOfMonth,
  flowPercentForSummary,
  lastOfMonth,
  monthKeySchema,
  monthStats,
  toLocalDate,
  todayLocalDate,
  type LocalDate,
  type MonthDay,
  type MonthSummaryResponse,
} from '@synitheia/shared';
import { UserModel, UserPreferenceModel } from '../../db/models.js';
import { getSummariesBetween } from '../../context/aggregator.js';

/**
 * The History grid, in one request.
 *
 * Reads the DailySummary cache through a single indexed range query rather than
 * rebuilding 31 days on demand — the Weekly Analysis chart's day-by-day loop is
 * fine for 7 days and roughly 200 queries for a cold month. Each document is
 * scored with the SAME computeDailyFlow the Today ring uses, so the calendar and
 * the home screen cannot drift apart.
 *
 * `today` is a parameter rather than a call to the clock so the behaviour around
 * the month boundary is testable.
 */
export async function monthSummaryFor(
  user: { id: string; timezone: string },
  month: string,
  today: string,
): Promise<MonthSummaryResponse> {
  const key = asMonthKey(month);
  const uid = new Types.ObjectId(user.id);

  const [account, prefs, summaries] = await Promise.all([
    UserModel.findById(uid, { createdAt: 1 }).lean<{ createdAt: Date } | null>(),
    UserPreferenceModel.findOne({ userId: uid }, { trackedDomains: 1 }).lean(),
    getSummariesBetween(user.id, firstOfMonth(key), lastOfMonth(key)),
  ]);

  const tracked =
    (prefs?.trackedDomains as string[] | undefined) ?? DEFAULT_TRACKED_DOMAINS;

  const days: MonthDay[] = summaries
    // A summary can exist for today mid-day; a summary for a FUTURE day cannot be
    // meaningful, and drawing one would tell the user about a day they have not lived.
    .filter((s) => (s.localDate as string) <= today)
    .map((s) => ({
      localDate: s.localDate as LocalDate,
      percent: flowPercentForSummary(s, tracked),
      eventCount: s.eventCount,
    }));

  return {
    month: key,
    // A user with no createdAt (impossible in practice, but the lean type is
    // nullable) gets today — the back arrow simply stops here.
    earliestLocalDate: toLocalDate(account?.createdAt ?? new Date(), user.timezone),
    days,
    stats: monthStats(days),
  };
}

export async function registerSummaryRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get(
    '/summary/month',
    {
      onRequest: [app.requireAuth],
      schema: { querystring: z.object({ month: monthKeySchema.optional() }) },
    },
    async (req) => {
      const today = todayLocalDate(req.user.timezone);
      return monthSummaryFor(req.user, req.query.month ?? today.slice(0, 7), today);
    },
  );
}
