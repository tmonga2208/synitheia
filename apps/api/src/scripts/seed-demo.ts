/* eslint-disable no-console -- A CLI seeder's output IS its interface. */
import type { Types } from 'mongoose';
import {
  addLocalDays,
  todayLocalDate,
  type LocalDate,
} from '@synitheia/shared';
import mongoose from 'mongoose';
import { loadEnv } from '../config/env.js';
import {
  DailyNutritionModel,
  ExpenseCategoryModel,
  ExpenseModel,
  FoodEntryModel,
  HabitLogModel,
  HabitModel,
  HealthDayModel,
  PersonalEventModel,
  UserModel,
  UserPreferenceModel,
  WaterEntryModel,
  DataSourceConnectionModel,
} from '../db/models.js';
import * as engine from '../context/engine.js';
import { buildDailySummary } from '../context/aggregator.js';
import { recomputeStreak } from '../modules/habits/service.js';

/**
 * Thirty days of a plausible life.
 *
 * Not noise. Random data would produce an app that LOOKS full and has nothing to say — the
 * insight layer would find no pattern because there would be none, and the demo would
 * quietly prove the opposite of the point.
 *
 * So the days are correlated, on purpose:
 *
 *   · A short night is followed by a low-step, high-calorie day. (Tired people move less
 *     and eat more; this is the single most legible pattern in the data.)
 *   · Fridays and weekends cost more, mostly on Food.
 *   · Habits slip at the weekend, which makes streaks real rather than decorative.
 *   · Workouts drive water up.
 *
 * Deterministic. A seeded PRNG rather than Math.random, so re-running gives the same life
 * and a bug found in the demo can be reproduced.
 */

// mulberry32 — small, fast, and repeatable.
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = rng(20260714);
const between = (lo: number, hi: number): number => lo + rand() * (hi - lo);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;

const DAYS = 30;
const TZ = 'Asia/Kolkata';

/** An instant inside the given local day, at roughly `hour` local time. */
function at(localDate: LocalDate, hour: number, minute = 0): Date {
  // Asia/Kolkata is UTC+5:30, so local hour H is UTC H-5:30 on that date.
  const utcMinutes = hour * 60 + minute - (5 * 60 + 30);
  return new Date(new Date(`${localDate}T00:00:00.000Z`).getTime() + utcMinutes * 60_000);
}

function weekdayOf(localDate: LocalDate): number {
  return new Date(`${localDate}T00:00:00.000Z`).getUTCDay(); // 0 Sun … 6 Sat
}

type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

interface MealSpec {
  mealType: MealType;
  hour: number;
  names: string[];
}

const MEALS: MealSpec[] = [
  { mealType: 'breakfast', hour: 8, names: ['Poha', 'Oats & banana', 'Idli sambar', 'Eggs on toast'] },
  { mealType: 'lunch', hour: 13, names: ['Dal, rice & sabzi', 'Rajma chawal', 'Chicken salad', 'Paneer wrap'] },
  { mealType: 'dinner', hour: 20, names: ['Roti & chicken curry', 'Khichdi', 'Grilled fish', 'Pasta'] },
];

const SNACKS = ['Chai & biscuits', 'Samosa', 'Protein shake', 'Apple', 'Peanuts'];

const MERCHANTS: Record<string, string[]> = {
  Food: ['Swiggy', 'Third Wave Coffee', 'Zomato', 'Rolls Mania', 'Blue Tokai'],
  Groceries: ['BigBasket', 'Zepto', 'Local kirana'],
  Transport: ['Uber', 'Rapido', 'Metro card'],
  Shopping: ['Amazon', 'Decathlon', 'Myntra'],
  Entertainment: ['BookMyShow', 'Spotify', 'Steam'],
  Health: ['Apollo Pharmacy', 'Cult.fit'],
  Bills: ['Airtel', 'Electricity board'],
};

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) throw new Error('usage: seed-demo <email>');

  const env = loadEnv();
  await mongoose.connect(env.MONGO_URI);

  const user = await UserModel.findOne({ email: email.toLowerCase() });
  if (!user) throw new Error(`No user ${email}`);

  const userId = user._id as Types.ObjectId;
  const uid = String(userId);
  const today = todayLocalDate(TZ);

  console.log(`Seeding 30 days for ${email} (${uid})`);

  // ─── Clear the old test data, so the demo is 30 clean days ────────────────
  await Promise.all([
    HabitModel.deleteMany({ userId }),
    HabitLogModel.deleteMany({ userId }),
    ExpenseModel.deleteMany({ userId }),
    FoodEntryModel.deleteMany({ userId }),
    DailyNutritionModel.deleteMany({ userId }),
    WaterEntryModel.deleteMany({ userId }),
    HealthDayModel.deleteMany({ userId }),
    PersonalEventModel.deleteMany({ userId }),
  ]);
  console.log('  cleared previous test data');

  // ─── Preferences ─────────────────────────────────────────────────────────
  await UserPreferenceModel.updateOne(
    { userId },
    {
      $set: {
        trackedDomains: ['habits', 'expenses', 'nutrition', 'water'],
        waterTargetMl: 2500,
        calorieTarget: 2258,
        proteinTargetG: 90,
        monthlyBudgetMinor: 4_500_000, // ₹45,000
        calorieGoal: 'maintain',
        'bodyMetrics.heightCm': 178,
        'bodyMetrics.weightKg': 74,
        'bodyMetrics.biologicalSex': 'male',
        'bodyMetrics.birthDate': '1998-03-22',
        'bodyMetrics.updatedAt': new Date(),
      },
    },
    { upsert: true },
  );

  await DataSourceConnectionModel.updateOne(
    { userId, source: 'health' },
    { $set: { status: 'connected', connectedAt: new Date(), lastSyncedAt: new Date() } },
    { upsert: true },
  );

  await UserModel.updateOne({ _id: userId }, { $set: { onboardedAt: new Date() } });

  // ─── Habits ──────────────────────────────────────────────────────────────
  const habitSpecs = [
    { name: 'Walk', icon: 'Footprints', color: '#7D927D', measure: 'steps', targetCount: 8000, unit: 'steps' },
    { name: 'Read', icon: 'BookOpen', color: '#7D8FA9', measure: 'check', targetCount: 1, unit: null },
    { name: 'Meditate', icon: 'Brain', color: '#A98DA9', measure: 'duration', targetCount: 20, unit: 'min' },
    { name: 'Stretch', icon: 'Waves', color: '#B0917D', measure: 'duration', targetCount: 10, unit: 'min' },
  ] as const;

  const habits = await HabitModel.insertMany(
    habitSpecs.map((h) => ({
      userId,
      name: h.name,
      icon: h.icon,
      color: h.color,
      category: null,
      frequency: 'daily',
      measure: h.measure,
      targetCount: h.targetCount,
      unit: h.unit,
      reminderTime: '19:30',
      currentStreak: 0,
      longestStreak: 0,
      archivedAt: null,
      createdAt: at(addLocalDays(today, -DAYS), 8),
    })),
  );

  const categories = await ExpenseCategoryModel.find({
    $or: [{ userId }, { userId: null }],
  }).lean();
  const catByName = new Map(categories.map((c) => [c.name, c]));

  let sleepDebt = false;

  for (let i = DAYS - 1; i >= 0; i -= 1) {
    const localDate = addLocalDays(today, -i);
    const dow = weekdayOf(localDate);
    const isWeekend = dow === 0 || dow === 6;
    const isFriday = dow === 5;

    // ── Sleep. Short nights cluster around the weekend.
    const shortNight = rand() < (isWeekend || isFriday ? 0.55 : 0.15);
    const sleepMinutes = Math.round(shortNight ? between(280, 350) : between(400, 465));

    /**
     * The correlation the whole demo turns on: yesterday's short night is TODAY's problem.
     * `sleepDebt` carries it forward, so a bad night suppresses the next day's steps and
     * lifts its calories — which is a pattern the insight layer can actually find.
     */
    const tired = sleepDebt;
    sleepDebt = shortNight;

    // ── Steps & energy
    const baseSteps = isWeekend ? between(4000, 8000) : between(7000, 13000);
    const steps = Math.round(tired ? baseSteps * between(0.55, 0.75) : baseSteps);
    const didWorkout = !tired && rand() < (isWeekend ? 0.25 : 0.45);
    const activeEnergy = Math.round(steps * 0.045 + (didWorkout ? between(220, 420) : 0));

    await HealthDayModel.create({
      userId,
      localDate,
      steps,
      activeEnergyKcal: activeEnergy,
      exerciseMinutes: didWorkout ? Math.round(between(30, 55)) : Math.round(between(5, 20)),
      sleepMinutes,
      restingHeartRate: Math.round(between(54, 62)),
      workouts: didWorkout
        ? [
            {
              kind: pick(['running', 'traditionalStrengthTraining', 'cycling']),
              minutes: Math.round(between(30, 50)),
              energyKcal: Math.round(between(220, 420)),
            },
          ]
        : [],
      syncedAt: new Date(),
    });

    await engine.emit({
      userId: uid,
      source: 'health',
      timestamp: at(localDate, 12),
      timezone: TZ,
      metadata: { type: 'steps.recorded', steps, distanceM: null },
      dedupeKey: engine.dedupeKey('health', 'steps', localDate),
    });

    await engine.emit({
      userId: uid,
      source: 'health',
      timestamp: at(localDate, 7),
      timezone: TZ,
      metadata: {
        type: 'sleep.detected',
        durationMin: sleepMinutes,
        startedAt: at(localDate, -1),
        endedAt: at(localDate, 7),
      },
      dedupeKey: engine.dedupeKey('health', 'sleep', localDate),
    });

    // ── Habits. Steps fill themselves from Health; the rest slip at weekends.
    for (const habit of habits) {
      const id = habit._id as Types.ObjectId;
      let count = 0;

      if (habit.measure === 'steps') {
        count = steps; // exactly what Health reported — the auto-fill in action
      } else {
        const adherence = isWeekend ? 0.5 : 0.85;
        if (rand() < adherence) {
          count =
            habit.measure === 'duration'
              ? Math.round(between(habit.targetCount * 0.8, habit.targetCount * 1.4))
              : 1;
        }
      }

      if (count > 0) {
        await HabitLogModel.create({
          userId,
          habitId: id,
          localDate,
          count,
          targetCount: habit.targetCount,
          completedAt: count >= habit.targetCount ? at(localDate, 21) : null,
          source: habit.measure === 'steps' ? 'health' : 'manual',
        });

        if (count >= habit.targetCount) {
          await engine.emit({
            userId: uid,
            source: habit.measure === 'steps' ? 'health' : 'manual',
            timestamp: at(localDate, 21),
            timezone: TZ,
            metadata: {
              type: 'habit.completed',
              habitId: String(id),
              habitName: habit.name,
              habitColor: habit.color,
              count,
              targetCount: habit.targetCount,
              streakAfter: 0, // recomputed from the logs at the end
            },
            dedupeKey: engine.dedupeKey('manual', 'habit', `${localDate}:${String(id)}`),
          });
        }
      }
    }

    // ── Water. More on workout days.
    const glasses = didWorkout ? Math.round(between(7, 10)) : Math.round(between(4, 8));
    for (let g = 0; g < glasses; g += 1) {
      await WaterEntryModel.create({
        userId,
        amountMl: pick([200, 250, 300, 500]),
        loggedAt: at(localDate, 8 + g * 1.5),
        timezone: TZ,
        localDate,
        source: 'manual',
        clientKey: `seed:${localDate}:${g}`,
      });
    }

    // ── Food. A tired day eats more, and later.
    const calorieBias = tired ? between(1.1, 1.25) : between(0.92, 1.05);
    const totals = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };
    const byMeal: Record<string, number> = {};
    let entryCount = 0;

    const meals: (MealSpec & { name: string })[] = MEALS.map((m) => ({
      ...m,
      name: pick(m.names),
    }));

    // A tired day snacks. The extra entry is part of the pattern, not filler.
    if (tired || rand() < 0.5) {
      meals.push({ mealType: 'snack', hour: 17, names: SNACKS, name: pick(SNACKS) });
    }

    for (const meal of meals) {
      const cal = Math.round(
        (meal.mealType === 'snack' ? between(150, 320) : between(420, 720)) * calorieBias,
      );
      const macros = {
        calories: cal,
        proteinG: Math.round(cal * between(0.05, 0.09)),
        carbsG: Math.round(cal * between(0.1, 0.15)),
        fatG: Math.round(cal * between(0.03, 0.05)),
      };

      await FoodEntryModel.create({
        userId,
        name: meal.name,
        mealType: meal.mealType,
        servings: 1,
        macros,
        foodRef: null,
        loggedAt: at(localDate, meal.hour),
        timezone: TZ,
        localDate,
        source: 'manual',
      });

      totals.calories += macros.calories;
      totals.proteinG += macros.proteinG;
      totals.carbsG += macros.carbsG;
      totals.fatG += macros.fatG;
      byMeal[meal.mealType] = (byMeal[meal.mealType] ?? 0) + macros.calories;
      entryCount += 1;

      await engine.emit({
        userId: uid,
        source: 'manual',
        timestamp: at(localDate, meal.hour),
        timezone: TZ,
        metadata: {
          type: 'food.logged',
          foodName: meal.name,
          mealType: meal.mealType,
          calories: macros.calories,
          proteinG: macros.proteinG,
          carbsG: macros.carbsG,
          fatG: macros.fatG,
        },
        dedupeKey: engine.dedupeKey('manual', 'food', `${localDate}:${meal.mealType}`),
      });
    }

    await DailyNutritionModel.create({ userId, localDate, totals, byMeal, entryCount });

    // ── Expenses. Fridays and weekends are the expensive ones.
    const count = isWeekend || isFriday ? Math.round(between(2, 4)) : Math.round(between(1, 3));

    for (let e = 0; e < count; e += 1) {
      const catName =
        isWeekend || isFriday
          ? pick(['Food', 'Food', 'Entertainment', 'Shopping', 'Transport'])
          : pick(['Food', 'Groceries', 'Transport', 'Bills', 'Health']);

      const category = catByName.get(catName) ?? catByName.get('Other')!;
      const merchant = pick(MERCHANTS[catName] ?? ['Local']);

      const base =
        catName === 'Bills'
          ? between(80000, 250000)
          : catName === 'Shopping'
            ? between(70000, 400000)
            : catName === 'Groceries'
              ? between(60000, 220000)
              : between(15000, 90000);

      const amountMinor = Math.round((isWeekend || isFriday ? base * 1.35 : base) / 100) * 100;
      const hour = 9 + Math.round(between(0, 12));

      const expense = await ExpenseModel.create({
        userId,
        amountMinor,
        currency: 'INR',
        categoryId: category._id,
        categoryName: category.name,
        categoryColor: category.color,
        merchant,
        note: null,
        occurredAt: at(localDate, hour),
        timezone: TZ,
        localDate,
        source: 'manual',
        hasReceipt: false,
        paidBy: null,
        billAmountMinor: null,
        participants: [],
      });

      await engine.emit({
        userId: uid,
        source: 'manual',
        timestamp: at(localDate, hour),
        timezone: TZ,
        refId: String(expense._id),
        metadata: {
          type: 'expense.created',
          amountMinor,
          currency: 'INR',
          categoryName: category.name,
          categoryColor: category.color,
          merchant,
          note: null,
        },
        dedupeKey: engine.dedupeKey('manual', 'expense', String(expense._id)),
      });
    }
  }

  // Streaks are a cache; recompute them from the logs we just wrote.
  for (const habit of habits) {
    await recomputeStreak(uid, String(habit._id), TZ);
  }

  /**
   * Build the DailySummary rows.
   *
   * Not optional, and not cosmetic: the insight layer counts DAYS OF HISTORY from these,
   * not from the raw records. Seed 30 days without them and the app reports "you have 2
   * days" and refuses to think — which is exactly what happened the first time I ran this.
   *
   * Built with the real aggregator rather than hand-written, so the demo data goes down the
   * same path production data does. Fabricating summaries would let the seeder disagree
   * with the app and hide a bug rather than surface one.
   */
  for (let i = DAYS - 1; i >= 0; i -= 1) {
    await buildDailySummary(uid, addLocalDays(today, -i));
  }
  console.log('  built 30 daily summaries');

  const [events, expenses, food, water] = await Promise.all([
    PersonalEventModel.countDocuments({ userId }),
    ExpenseModel.countDocuments({ userId }),
    FoodEntryModel.countDocuments({ userId }),
    WaterEntryModel.countDocuments({ userId }),
  ]);

  const fresh = await HabitModel.find({ userId }).lean();

  console.log(`\n  ${DAYS} days seeded`);
  console.log(`  ${events} timeline events · ${expenses} expenses · ${food} meals · ${water} waters`);
  for (const h of fresh) {
    console.log(`  habit: ${h.name.padEnd(9)} streak ${h.currentStreak} (best ${h.longestStreak})`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
