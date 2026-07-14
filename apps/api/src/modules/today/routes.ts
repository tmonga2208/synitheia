import { Types } from 'mongoose';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  addLocalDays,
  computeDailyFlow,
  greetingFor,
  isHabitComplete,
  localDateSchema,
  localMinutesOfDay,
  netMinor,
  startOfLocalWeek,
  todayLocalDate,
  type FlowComponent,
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
import { getDailySummary } from '../../context/aggregator.js';
import { runDetectors } from '../../context/detectors.js';
import * as habits from '../habits/service.js';
import * as subscriptions from '../subscriptions/service.js';

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

        await runDetectors(user.id, user.timezone, today).catch((err: unknown) => {
          req.log.warn({ err }, 'detectors failed; serving Today without suggestions');
        });
      }

      const [
        account,
        prefs,
        habitList,
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
        HabitLogModel.find({ userId: uid, localDate }).lean(),
        ExpenseModel.find(
          { userId: uid, localDate },
          { amountMinor: 1, participants: 1 },
        ).lean(),
        DailyNutritionModel.findOne({ userId: uid, localDate }).lean(),
        WaterEntryModel.find({ userId: uid, localDate }, { amountMl: 1 }).lean(),
        timelineFor(user.id, localDate),
        InferredContextModel.find({
          userId: uid,
          status: 'pending',
          expiresAt: { $gt: new Date() },
        })
          .sort({ confidence: -1 })
          .limit(3)
          .lean(),
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

      const completedCount = habitsToday.filter((h) => h.todayComplete).length;

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
      const tracked = new Set(
        (prefs?.trackedDomains as string[] | undefined) ?? [
          'habits',
          'expenses',
          'nutrition',
          'water',
        ],
      );

      const components: FlowComponent[] = [
        {
          key: 'habits',
          percent:
            habitList.length > 0 ? (completedCount / habitList.length) * 100 : 0,
          active: tracked.has('habits') && habitList.length > 0,
        },
        {
          key: 'water',
          percent: (waterTotal / waterTargetMl) * 100,
          active: tracked.has('water'),
        },
        {
          key: 'nutrition',
          percent: (calories / calorieTarget) * 100,
          // Even for someone who tracks food, an untouched tracker should not drag the
          // ring down before they have eaten anything.
          active: tracked.has('nutrition') && (nutrition?.entryCount ?? 0) > 0,
        },
      ];

      const dailyFlow = computeDailyFlow(components);

      // ── Weekly chart (Monday-anchored, matching the M–S columns in the design)
      const weekStart = startOfLocalWeek(localDate);
      const weeklyFlow = await Promise.all(
        Array.from({ length: 7 }, (_, i) => addLocalDays(weekStart, i)).map(
          async (day) => {
            // Future days in the current week have no data and are drawn empty.
            if (day > today) {
              return { localDate: day, percent: 0, isToday: false };
            }

            const summary = await getDailySummary(user.id, day);
            const parts: FlowComponent[] = [
              {
                key: 'habits',
                percent: summary.habits.completionRate * 100,
                active: summary.habits.scheduled > 0,
              },
              {
                key: 'water',
                percent: (summary.water.totalMl / summary.water.targetMl) * 100,
                active: summary.water.entryCount > 0,
              },
              {
                key: 'nutrition',
                percent:
                  (summary.nutrition.totals.calories / summary.nutrition.calorieTarget) *
                  100,
                active: summary.nutrition.entryCount > 0,
              },
            ];

            return {
              localDate: day,
              percent: computeDailyFlow(parts).percent,
              isToday: day === today,
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
