import { Types } from 'mongoose';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  DEFAULT_TRACKED_DOMAINS,
  asMonthKey,
  firstOfMonth,
  flowPercentForSummary,
  hasAnyActivity,
  lastOfMonth,
  monthKeySchema,
  monthStats,
  monthSummaryResponseSchema,
  toLocalDate,
  todayLocalDate,
  type LocalDate,
  type MonthDay,
  type MonthSummaryResponse,
} from '@synitheia/shared';
import {
  HabitLogModel,
  PersonalEventModel,
  UserModel,
  UserPreferenceModel,
} from '../../db/models.js';
import {
  activityOf,
  flowInputOf,
  getDailySummary,
  getSummariesBetween,
} from '../../context/aggregator.js';

/**
 * The days in a range the user actually recorded something on.
 *
 * DailySummary is a CACHE, so "has a cached rollup" and "has data" are different sets,
 * and the endpoint used to conflate them. Nothing rebuilds a month: `buildDailySummary`
 * is only reached from the Today route's weekly loop, which covers the requested date's
 * week. Meanwhile invalidation is deliberately aggressive — a 7-day health sync drops a
 * whole previous week, editing an old expense drops that day — so a fully-logged week
 * would render hollow and be excluded from `daysLogged` and `avgPercent`.
 *
 * Two indexed `distinct`s, not a scan of the raw collections: PersonalEvent covers
 * water, food, expenses and every passive source (they all emit), and HabitLog covers
 * the case it cannot — an INCOMPLETE habit log emits no event but is unquestionably a
 * day with data. Both are constrained to a single month, so the result is bounded by
 * the month's length (≤ 31) no matter how much the user logged.
 */
async function datesWithData(
  uid: Types.ObjectId,
  from: LocalDate,
  to: LocalDate,
): Promise<string[]> {
  const range = { userId: uid, localDate: { $gte: from, $lte: to } };

  // `localDate` is a plain String in both schemas; Mongoose's distinct() is typed to
  // unknown[] because it cannot know that from the field name.
  const [eventDates, habitLogDates] = (await Promise.all([
    PersonalEventModel.distinct('localDate', range),
    HabitLogModel.distinct('localDate', range),
  ])) as [string[], string[]];

  return [...new Set([...eventDates, ...habitLogDates])];
}

/**
 * The History grid, in one request.
 *
 * Cached rollups come back in a single indexed range query; only the days that have
 * data but no rollup are rebuilt, which is at most the month's length and in practice
 * zero for a user who has been opening the app. Rebuilding all 31 unconditionally (as
 * the weekly chart does for its 7) would be roughly 200 queries for a cold month.
 *
 * Every day is scored through `flowPercentForSummary` — the same activation rules and
 * the same `computeDailyFlow` the Today ring and the weekly chart now use — so the
 * calendar and the home screen cannot drift apart.
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
  const from = firstOfMonth(key);
  const to = lastOfMonth(key);

  const [account, prefs, cached, dataDates] = await Promise.all([
    UserModel.findById(uid, { createdAt: 1 }).lean<{ createdAt: Date } | null>(),
    UserPreferenceModel.findOne({ userId: uid }, { trackedDomains: 1 }).lean(),
    getSummariesBetween(user.id, from, to),
    datesWithData(uid, from, to),
  ]);

  const tracked =
    (prefs?.trackedDomains as string[] | undefined) ?? DEFAULT_TRACKED_DOMAINS;

  const cachedDates = new Set(cached.map((s) => s.localDate as string));

  // A summary can exist for today mid-day; a summary for a FUTURE day cannot be
  // meaningful, and drawing one would tell the user about a day they have not lived.
  const missing = dataDates.filter((d) => d <= today && !cachedDates.has(d));

  const built = await Promise.all(
    missing.map((d) => getDailySummary(user.id, d as LocalDate)),
  );

  const days: MonthDay[] = [...cached, ...built]
    .filter((s) => (s.localDate as string) <= today)
    // A cached all-zero rollup is not a zero-percent day. The Today route builds a
    // rollup for every day of the requested week on every load, so merely opening the
    // app — or browsing one past day, which builds its whole week — writes empty
    // documents. Emitting those as `percent: 0` would tint neighbouring cells sand and
    // announce "0 percent" for days the user was not using the app.
    .filter((s) => hasAnyActivity(activityOf(s)))
    .map((s) => ({
      localDate: s.localDate as LocalDate,
      percent: flowPercentForSummary(flowInputOf(s), tracked),
      eventCount: s.eventCount,
    }))
    .sort((a, b) => a.localDate.localeCompare(b.localDate));

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
      schema: {
        querystring: z.object({ month: monthKeySchema.optional() }),
        /**
         * Attached deliberately, not for documentation. DailySummary's sub-documents
         * are `Schema.Types.Mixed`, so a field renamed in the aggregator type-checks
         * fine and surfaces as a `NaN` percent that serialises to `null` and renders
         * as the wrong tint. With a response schema, that is a 500 instead.
         */
        response: { 200: monthSummaryResponseSchema },
      },
    },
    async (req) => {
      const today = todayLocalDate(req.user.timezone);
      return monthSummaryFor(req.user, req.query.month ?? today.slice(0, 7), today);
    },
  );
}
