import { Types } from 'mongoose';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  DEFAULT_TRACKED_DOMAINS,
  addLocalDays,
  addMonths,
  awardForMonth,
  completionRate,
  computeDailyFlow,
  firstOfMonth,
  flowComponentsForSummary,
  flowPercentForSummary,
  greetingFor,
  isHabitComplete,
  lastOfMonth,
  localDateSchema,
  localMinutesOfDay,
  monthKeyOf,
  netMinor,
  todayLocalDate,
  rankSuggestions,
  type LocalDate,
  type Participant,
} from '@synitheia/shared';
import {
  AIInsightModel,
  DailyNutritionModel,
  ExpenseModel,
  HabitLogModel,
  InferredContextModel,
  UserModel,
  UserPreferenceModel,
  WaterEntryModel,
} from '../../db/models.js';
import { timelineFor } from '../../context/engine.js';
import { flowInputOf, getDailySummary, weekTotalsOf } from '../../context/aggregator.js';
import { runDetectors } from '../../context/detectors/run.js';
import type { AuthedUser } from '../../core/auth-guard.js';
import * as habits from '../habits/service.js';
import * as subscriptions from '../subscriptions/service.js';
import { grantAwards } from '../xp/service.js';

/**
 * The Today screen, in one request.
 *
 * This deliberately fans out in parallel and returns a single composed payload. The
 * alternative — the client calling /habits, /expenses, /water, /food, /timeline and
 * stitching them together — produces a home screen that paints in five stages, which
 * is precisely how an app comes to feel like seven trackers in a trench coat rather
 * than one product that understands your day.
 */

/**
 * Mongo's `_id` never reaches the client.
 *
 * `todayResponseSchema` declares `id` on suggestions and insights, and that schema is
 * the contract both sides compile against — but Fastify only validates a response when
 * a response schema is attached, so a raw `.lean()` document sails straight through
 * with `_id` instead. TypeScript cannot catch it: the declared type promises `id`, so
 * `suggestion.id` compiles fine and is `undefined` at runtime. The timeline already hit
 * exactly this (a React list keyed on `undefined`); suggestions and insights would have
 * hit it the moment the first one appeared, which is the flagship feature.
 */
function withId<T extends { _id: Types.ObjectId }>(doc: T): Omit<T, '_id'> & { id: string } {
  const { _id, ...rest } = doc;
  return { ...rest, id: _id.toString() };
}

/**
 * The three suggestions Today has room for.
 *
 * Two queries, because the two kinds age differently. A question the user can answer
 * ("did you have lunch?") is as true tomorrow morning as it was last night, so it lives
 * out its 48-hour expiry. An observation is written in the present tense about one day
 * ("Reading is usually done by now", "3,000 steps so far") and is simply false on the
 * next one, so it is shown only on the day it was raised.
 *
 * Each is sorted before it is limited — an unsorted cut is arbitrary, and with a
 * suggestion per habit there can be more pending rows than any fixed limit.
 */
async function pendingSuggestions(uid: Types.ObjectId, localDate: LocalDate) {
  const pending = { userId: uid, status: 'pending', expiresAt: { $gt: new Date() } };

  const [actionable, observations] = await Promise.all([
    InferredContextModel.find({ ...pending, 'proposed.kind': { $ne: 'observation' } })
      .sort({ confidence: -1 })
      .limit(3)
      .lean(),
    InferredContextModel.find({ ...pending, 'proposed.kind': 'observation', localDate })
      .sort({ confidence: -1 })
      .limit(3)
      .lean(),
  ]);

  // Actionable first, then confidence — see rankSuggestions.
  return rankSuggestions([...actionable, ...observations]).slice(0, 3);
}

/**
 * Award last month's "closed within budget" bonus, lazily.
 *
 * There is no scheduler in this app, deliberately — a month boundary is not an event
 * anything reacts to on its own. Instead this runs on every Today load, exactly like
 * `postDueSubscriptions` below: the `budget:<YYYY-MM>` dedupe key in `awardForMonth`
 * means it can run on every single load for the rest of the month and grant once.
 *
 * NET spend only, via the same `netMinor` reduction the rest of Today uses for the
 * day's total — a repaid dinner must not count as spending, or a split expense could
 * silently cost (or save) a user 100 XP for money that never actually left their pocket.
 *
 * A missing budget (`null`) is not a budget of zero — it means no target was ever set,
 * so `awardForMonth` grants nothing and, just as importantly, never penalizes.
 *
 * THIS FUNCTION DOES NOT SWALLOW ITS OWN FAILURES. Unlike the habit and water grants,
 * which wrap internally because they sit inside a write the user is waiting on, the
 * wrapping here belongs to the caller — see the `.catch` on the call below, matching its
 * neighbours `postDueSubscriptions` and `runDetectors`. That is correct where it sits;
 * anyone calling this from somewhere that is not a route must add their own catch, or a
 * ledger hiccup becomes an unhandled rejection.
 */
export async function awardMonthlyBudget(user: AuthedUser, today: LocalDate): Promise<void> {
  const uid = new Types.ObjectId(user.id);
  const month = addMonths(monthKeyOf(today), -1);

  const prefs = await UserPreferenceModel.findOne(
    { userId: uid },
    { monthlyBudgetMinor: 1 },
  ).lean();
  if (prefs?.monthlyBudgetMinor == null) return;

  const monthExpenses = await ExpenseModel.find(
    { userId: uid, localDate: { $gte: firstOfMonth(month), $lte: lastOfMonth(month) } },
    { amountMinor: 1, participants: 1 },
  ).lean();

  const spentMinor = monthExpenses.reduce(
    (acc, e) =>
      acc +
      netMinor({
        amountMinor: e.amountMinor,
        // Absent on expenses written before splitting existed. See aggregator.ts.
        participants: (e.participants as Participant[] | undefined) ?? [],
      }),
    0,
  );

  const award = awardForMonth({ month, spentMinor, budgetMinor: prefs.monthlyBudgetMinor });
  await grantAwards(user.id, award ? [award] : []);
}

export async function registerTodayRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get(
    '/today',
    {
      onRequest: [app.requireAuth],
      schema: { querystring: z.object({ localDate: localDateSchema.optional() }) },
    },
    async (req) => {
      const { user } = req;
      const uid = new Types.ObjectId(user.id);
      const today = todayLocalDate(user.timezone);
      const localDate = (req.query.localDate ?? today) as LocalDate;

      /**
       * Detectors run before we read suggestions, so a user who logged an expense
       * thirty seconds ago sees the resulting question on this very refresh rather
       * than on the next one. They are deterministic, indexed, and idempotent, so this
       * is cheap — and a suggestion that arrives a pull-to-refresh late feels broken.
       *
       * A failure here must never take down Today. The suggestion is a nicety; the
       * user's actual day is not.
       */
      if (localDate === today) {
        /**
         * Recurring bills post BEFORE the day is read, so rent that fell due this
         * morning is already on the screen rather than appearing on the next refresh.
         * Idempotent via lastPostedDate — this runs on every single load of Today.
         */
        await subscriptions.postDueSubscriptions(user).catch((err: unknown) => {
          req.log.warn({ err }, 'subscription posting failed; serving Today without it');
        });

        await runDetectors(user.id, user.timezone, today, { currency: user.currency }).catch(
          (err: unknown) => {
            req.log.warn({ err }, 'detectors failed; serving Today without suggestions');
          },
        );

        await awardMonthlyBudget(user, today).catch((err: unknown) => {
          req.log.warn({ err }, 'monthly budget award failed; serving Today without it');
        });
      }

      const [
        account,
        prefs,
        habitList,
        scheduledHabits,
        habitLogs,
        expenses,
        nutrition,
        water,
        timeline,
        suggestions,
        insight,
      ] = await Promise.all([
        UserModel.findById(uid, { xp: 1 }).lean(),
        UserPreferenceModel.findOne({ userId: uid }).lean(),
        habits.listHabits(user.id),
        /**
         * The ring's habit denominator, and NOT the same list as `habitList`.
         *
         * `listHabits` is what the user has right now; `scheduledOn` is what they had
         * on `localDate` — it keeps a habit archived since then and drops one created
         * since. That is the denominator `buildDailySummary` records, so scoring the
         * ring against it is what stops the ring, the weekly bar and the History cell
         * for the same date from being three different numbers.
         */
        habits.scheduledOn(user.id, localDate),
        HabitLogModel.find({ userId: uid, localDate }).lean(),
        ExpenseModel.find(
          { userId: uid, localDate },
          { amountMinor: 1, participants: 1 },
        ).lean(),
        DailyNutritionModel.findOne({ userId: uid, localDate }).lean(),
        WaterEntryModel.find({ userId: uid, localDate }, { amountMl: 1 }).lean(),
        timelineFor(user.id, localDate),
        pendingSuggestions(uid, localDate),
        AIInsightModel.findOne({
          userId: uid,
          status: 'active',
          expiresAt: { $gt: new Date() },
        })
          .sort({ severity: -1, generatedAt: -1 })
          .lean(),
      ]);

      const calorieTarget = prefs?.calorieTarget ?? 2000;
      const waterTargetMl = prefs?.waterTargetMl ?? 2500;

      // ── Habits
      const logsByHabit = new Map(habitLogs.map((l) => [l.habitId.toString(), l]));

      const habitsToday = habitList.map((h) => {
        const log = logsByHabit.get(h._id.toString());
        return {
          ...h,
          id: h._id.toString(),
          todayCount: log?.count ?? 0,
          todayComplete: log ? isHabitComplete(log) : false,
        };
      });

      // ── Totals
      // NET. See totalsFor() — what the day cost, not what passed through the card.
      const expenseTotal = expenses.reduce(
        (acc, e) =>
          acc +
          netMinor({
            amountMinor: e.amountMinor,
            // Absent on expenses written before splitting existed. See aggregator.ts.
            participants: (e.participants as Participant[] | undefined) ?? [],
          }),
        0,
      );
      const waterTotal = water.reduce((acc, w) => acc + w.amountMl, 0);
      const calories = nutrition?.totals.calories ?? 0;

      /**
       * The ring is scored ONLY against the trackers this user actually signed up for.
       *
       * `trackedDomains` comes from onboarding. Before it existed, water was active for
       * everybody — waterTargetMl always has a default, so "has a target" was always true
       * — and a habits-only user could complete every habit and still sit at 50%, dragged
       * down by a tracker they never chose. A ring that cannot be filled is a ring quietly
       * telling you that you failed at something you never signed up for.
       */
      const tracked =
        (prefs?.trackedDomains as string[] | undefined) ?? DEFAULT_TRACKED_DOMAINS;

      /**
       * The ring, the weekly bar and the History cell for a date are now ONE
       * computation. `flowComponentsForSummary` is the only place in the codebase that
       * decides when a component counts; three hand-rolled copies used to exist and
       * they disagreed, so a grid cell and the day screen it opened could differ by 60
       * points for the same date. Water was unconditionally active here and gated on
       * `entryCount > 0` in the other two — the latter wins, for the reason this route
       * already gave for nutrition and `flowComponentsForSummary` now carries: an
       * untouched tracker is not a failure.
       *
       * The inputs are `scheduledHabits`, not `habitList`, and completed LOGS, not
       * completed rows of `habitsToday` — both mirroring buildDailySummary, so that a
       * habit archived since `localDate` still counts on the day it was kept.
       */
      const completedLogCount = habitLogs.filter((l) => isHabitComplete(l)).length;

      const dailyFlow = computeDailyFlow(
        flowComponentsForSummary(
          {
            habits: {
              scheduled: scheduledHabits.length,
              completionRate: completionRate(completedLogCount, scheduledHabits.length),
            },
            water: {
              totalMl: waterTotal,
              targetMl: waterTargetMl,
              entryCount: water.length,
            },
            nutrition: {
              totals: { calories },
              calorieTarget,
              entryCount: nutrition?.entryCount ?? 0,
            },
          },
          tracked,
        ),
      );

      // ── Weekly chart: the seven days ending on this one. It was Monday to Sunday, which
      // left a Monday's chart six empty bars; the labels come from each day's date.
      const weekStart = addLocalDays(localDate, -6);
      const weeklyFlow = await Promise.all(
        Array.from({ length: 7 }, (_, i) => addLocalDays(weekStart, i)).map(
          async (day) => {
            // Future days in the current week have no data and are drawn empty.
            if (day > today) {
              return { localDate: day, percent: 0, isToday: false };
            }

            // Same function as the ring above and the History grid — and this is also
            // where the chart picks up `trackedDomains` gating, which its hand-rolled
            // copy applied nowhere at all: a habits-only user's bars were capped by
            // water and food they never signed up for.
            const summary = await getDailySummary(user.id, day);

            return {
              localDate: day,
              percent: flowPercentForSummary(flowInputOf(summary), tracked),
              isToday: day === today,
              totals: weekTotalsOf(summary),
            };
          },
        ),
      );

      const longestStreak = habitList.reduce(
        (acc, h) => Math.max(acc, h.currentStreak),
        0,
      );

      const budgetRemaining =
        prefs?.monthlyBudgetMinor != null
          ? prefs.monthlyBudgetMinor -
            (await ExpenseModel.aggregate<{ total: number }>([
              {
                $match: {
                  userId: uid,
                  localDate: { $gte: `${localDate.slice(0, 7)}-01`, $lte: localDate },
                },
              },
              { $group: { _id: null, total: { $sum: '$amountMinor' } } },
            ]).then((r) => r[0]?.total ?? 0))
          : null;

      return {
        localDate,
        greeting: greetingFor(localMinutesOfDay(new Date(), user.timezone)),
        dailyFlow,
        streakDays: longestStreak,
        xp: account?.xp ?? 0,
        habits: habitsToday,
        expenses: {
          totalMinor: expenseTotal,
          count: expenses.length,
          budgetRemainingMinor: budgetRemaining,
        },
        nutrition: {
          totals: nutrition?.totals ?? {
            calories: 0,
            proteinG: 0,
            carbsG: 0,
            fatG: 0,
          },
          calorieTarget,
        },
        water: { totalMl: waterTotal, targetMl: waterTargetMl },
        timeline,
        suggestions: suggestions.map(withId),
        featuredInsight: insight ? withId(insight) : null,
        weeklyFlow,
      };
    },
  );

  api.get(
    '/timeline',
    {
      onRequest: [app.requireAuth],
      schema: {
        querystring: z.object({
          localDate: localDateSchema.optional(),
          limit: z.coerce.number().int().min(1).max(200).default(100),
        }),
      },
    },
    async (req) => {
      const localDate = (req.query.localDate ??
        todayLocalDate(req.user.timezone)) as LocalDate;

      return {
        localDate,
        items: await timelineFor(req.user.id, localDate, req.query.limit),
      };
    },
  );
}
