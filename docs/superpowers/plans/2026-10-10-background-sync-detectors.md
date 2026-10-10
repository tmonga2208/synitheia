# Background Sync and New Detectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Health and Calendar sync while the app is closed, detectors run whenever a sync lands, four new detectors exist, and actionable suggestions raise a local notification.

**Architecture:** The API's detectors become one pure function per file over a context the runner loads once; both sync services call the runner and return the suggestions that call created. On the phone, sync logic moves out of React hooks into plain runner functions shared by the foreground hooks and one `expo-background-task` task, which posts local notifications for actionable suggestions under a pure, tested policy.

**Tech Stack:** TypeScript, Fastify + Mongoose (API), vitest with `mongodb-memory-server`, React Native / Expo SDK 54, `expo-background-task`, `expo-task-manager`, `expo-notifications`, `expo-secure-store`, AsyncStorage, zod schemas in `packages/shared`.

**Spec:** `docs/superpowers/specs/2026-10-10-background-sync-detectors-design.md`

## Global Constraints

- Background sources are Health (iOS) and Calendar (both platforms) only. No background location, no background weather, no HealthKit background delivery, no server scheduler, no remote push.
- Detectors are deterministic, never call an LLM, and never write a domain record. Only `POST /inferences/:id/resolve` writes.
- All day arithmetic goes through `packages/shared/src/time/local-date.ts`. Never use a UTC date range for "today". Detectors take `ctx.now`; they never read the clock.
- Money stays in integer minor units and is formatted with `formatMoney` in code.
- A background read that returns nothing is a no-op, never a post of nulls and never an error.
- Never request an OS permission from the background task.
- A background task must never sign the user out.
- New dependencies: `expo-background-task` and `expo-task-manager` only, installed with `npx expo install`.
- Thresholds, verbatim from the spec: unusual spending 1.5× the same-weekday mean, 3+ samples, excess ≥ 10,000 minor units; low activity after 19:00, under 60% of the 14-day mean, 7+ days; habit slipping 90 minutes past the median of 5+ completions in 28 days, before 22:00; notifications max 2 per local day, none 22:00–07:00.
- History window is 56 days. `possible_meal` and `low_water` keep reading only the last 21 days of it, so their behaviour does not change.
- Workout → habit and habit slipping apply to **daily** habits only, and never to `steps`-measure habits. (The spec says "scheduled today"; weekly habits have no per-day completion to compare against. This narrowing is deliberate.)
- Match the surrounding code's comment style: comments explain why, not what.
- Run `pnpm check` from the repo root before every commit that touches code. It must pass.

## Review Focus

Conditions the spec implies that are most likely to bite, each pinned by a test in the task named:

1. **A habit already completed between suggestion and confirm** must not be logged twice or have its count inflated. Task 7.
2. **An expired refresh token during a background sync** must leave the stored tokens alone, so the user is not signed out while the phone is in a pocket. Task 9.
3. **Old workout events whose activity is a number** (`"37"`, from before the reader fix in Task 11) must still match "run" habits rather than silently never matching. Task 6.
4. **Expenses in a foreign currency** must not inflate today's total or the baseline for unusual spending. Task 3.
5. **Corrupt or missing local prefs / notify state** (AsyncStorage returning garbage or throwing) must fall back to defaults instead of crashing the background task. Task 10.

---

## File Structure

```
packages/shared/src/domain/
  inference.ts                 + low_activity, syncSuggestionSchema, syncResultSchema, rankSuggestions
  inference.test.ts            new

apps/api/src/context/
  detectors.ts                 DELETED (split below)
  detectors.test.ts            MOVED to detectors/run.test.ts
  detectors/
    types.ts                   DetectorContext, HabitToday, Detection, Detector
    labels.ts                  timeLabel, minutesLabel, WEEKDAY_NAMES
    testing.ts                 fakeEvent, baseCtx (test-only helpers)
    run.ts                     loads context, runs all, upserts, returns created
    afterSync.ts               detectAfterSync: run + never throw
    possibleMeal.ts            moved
    lowWater.ts                moved
    unusualSpending.ts (+ .test.ts)
    lowActivity.ts     (+ .test.ts)
    habitSlipping.ts   (+ .test.ts)
    workoutMatch.ts    (+ .test.ts)
    workoutHabit.ts    (+ .test.ts)
apps/api/src/modules/
  inference/service.ts (+ .test.ts)   confirmHabitSuggestion
  inference/routes.ts                 habit branch
  habits/service.ts                   logHabit gains a source parameter
  health/service.ts, calendar/service.ts   return suggestions
  health/sync-suggestions.test.ts     new
  today/routes.ts                     currency + ranking

apps/mobile/src/
  api/client.ts (+ client.test.ts)    keychain option, migration, background-safe refresh
  sync/
    sourcePrefs.ts      (+ .test.ts)
    registration.ts     (+ .test.ts)  shouldRegister (pure)
    notifyPolicy.ts     (+ .test.ts)
    notifySuggestions.ts
    runHealthSync.ts    (+ .test.ts)
    runCalendarSync.ts  (+ .test.ts)
    contextSync.ts      (+ .test.ts)  the task body, with injected deps
    backgroundTask.ts                 defineTask, syncBackgroundRegistration
    useSourcePrefsMirror.ts
  health/useHealthSync.ts, calendar/useCalendarSync.ts   thin wrappers
  health/healthkit.ts                 workout kind as a name
apps/mobile/app/_layout.tsx, (tabs)/index.tsx, privacy.tsx
apps/mobile/app.json, package.json
ARCHITECTURE.md
```

All commands run from the repo root of this worktree unless a step says otherwise.

---

### Task 1: Shared contract — suggestion type, sync result, ranking

**Files:**
- Modify: `packages/shared/src/domain/inference.ts`
- Test: `packages/shared/src/domain/inference.test.ts` (create)

**Interfaces:**
- Produces:
  - `inferenceTypeSchema` now includes `'low_activity'`
  - `syncSuggestionSchema`, `type SyncSuggestion = { id: string; type: InferenceType; title: string; actionable: boolean }`
  - `syncResultSchema` — `z.object({ suggestions: z.array(syncSuggestionSchema).default([]) }).passthrough()`
  - `rankSuggestions<T extends { confidence: number; proposed: { kind: string } }>(items: readonly T[]): T[]`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/domain/inference.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  inferenceTypeSchema,
  rankSuggestions,
  syncResultSchema,
  syncSuggestionSchema,
} from './inference.js';

describe('inference contract', () => {
  it('accepts low_activity as a suggestion type', () => {
    expect(inferenceTypeSchema.parse('low_activity')).toBe('low_activity');
  });

  it('parses a sync suggestion', () => {
    const parsed = syncSuggestionSchema.parse({
      id: '6a7025c8d36b5e0013390202',
      type: 'possible_habit_completion',
      title: 'Mark Morning run done?',
      actionable: true,
    });
    expect(parsed.actionable).toBe(true);
  });

  it('defaults suggestions to [] so an older API response still parses', () => {
    const parsed = syncResultSchema.parse({ days: 7, stepsApplied: 0 });
    expect(parsed.suggestions).toEqual([]);
  });
});

describe('rankSuggestions', () => {
  const s = (id: string, kind: string, confidence: number) => ({
    id,
    confidence,
    proposed: { kind },
  });

  it('puts actionable suggestions ahead of observations, whatever their confidence', () => {
    const ranked = rankSuggestions([
      s('obs-high', 'observation', 0.9),
      s('habit-low', 'habit', 0.65),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['habit-low', 'obs-high']);
  });

  it('orders by confidence within each group', () => {
    const ranked = rankSuggestions([
      s('obs-a', 'observation', 0.6),
      s('food', 'food', 0.62),
      s('obs-b', 'observation', 0.8),
      s('habit', 'habit', 0.8),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['habit', 'food', 'obs-b', 'obs-a']);
  });

  it('does not mutate its input', () => {
    const input = [s('a', 'observation', 0.6), s('b', 'habit', 0.7)];
    rankSuggestions(input);
    expect(input.map((r) => r.id)).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @synitheia/shared exec vitest run src/domain/inference.test.ts`
Expected: FAIL — `rankSuggestions` / `syncResultSchema` are not exported.

- [ ] **Step 3: Implement**

In `packages/shared/src/domain/inference.ts`, add `'low_activity'` to `inferenceTypeSchema` after `'low_water'`:

```ts
  'low_water',
  'low_activity',
]);
```

Append to the end of the file:

```ts
/**
 * What a sync route tells the client it just created.
 *
 * Deliberately only what a notification needs. The background task has no screen to
 * render evidence on, and a suggestion's full body is one `GET /today` away.
 */
export const syncSuggestionSchema = z.object({
  id: objectIdSchema,
  type: inferenceTypeSchema,
  title: z.string(),
  /** True when confirming would write something. Observations are never actionable. */
  actionable: z.boolean(),
});
export type SyncSuggestion = z.infer<typeof syncSuggestionSchema>;

/**
 * The part of a sync response the client parses. `passthrough` and the default exist so
 * a client talking to an API one deploy behind still gets a valid, empty list.
 */
export const syncResultSchema = z
  .object({ suggestions: z.array(syncSuggestionSchema).default([]) })
  .passthrough();
export type SyncResult = z.infer<typeof syncResultSchema>;

/**
 * Order suggestions for the three slots Today has.
 *
 * Something the user can confirm outranks something they can only read: with six
 * detectors, a confident observation would otherwise push the one-tap card off the screen.
 */
export function rankSuggestions<T extends { confidence: number; proposed: { kind: string } }>(
  items: readonly T[],
): T[] {
  const actionable = (item: T): number => (item.proposed.kind === 'observation' ? 0 : 1);
  return [...items].sort(
    (a, b) => actionable(b) - actionable(a) || b.confidence - a.confidence,
  );
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @synitheia/shared exec vitest run src/domain/inference.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Build shared and commit**

```bash
pnpm --filter @synitheia/shared build
pnpm check
git add packages/shared/src/domain/inference.ts packages/shared/src/domain/inference.test.ts
git commit -m "feat(shared): sync suggestion contract, low_activity type, suggestion ranking"
```

---

### Task 2: Split detectors into pure functions over a loaded context

No behaviour change for the two existing detectors. This task creates the structure every later API task plugs into.

**Files:**
- Create: `apps/api/src/context/detectors/types.ts`, `labels.ts`, `testing.ts`, `run.ts`, `possibleMeal.ts`, `lowWater.ts`
- Delete: `apps/api/src/context/detectors.ts`
- Move: `apps/api/src/context/detectors.test.ts` → `apps/api/src/context/detectors/run.test.ts`
- Modify: `apps/api/src/modules/today/routes.ts` (import path only)

**Interfaces:**
- Consumes: `SyncSuggestion`, `InferenceType`, `ProposedPayload`, `Evidence` from `@synitheia/shared` (Task 1)
- Produces:
  - `type EventLean`, `interface HabitToday`, `interface DetectorContext`, `interface Detection`, `type Detector = (ctx: DetectorContext) => Detection[]` (`types.ts`)
  - `timeLabel(instant: Date, timezone: string): string`, `minutesLabel(minutes: number): string`, `WEEKDAY_NAMES: readonly string[]` (`labels.ts`)
  - `fakeEvent(...)`, `baseCtx(overrides?)` (`testing.ts`)
  - `runDetectors(userId: string, timezone: string, localDate?: LocalDate, options?: { now?: Date; currency?: string | null }): Promise<SyncSuggestion[]>` (`run.ts`)
  - `const DETECTORS: Detector[]` in `run.ts` — later tasks append to it

- [ ] **Step 1: Create `types.ts`**

```ts
import type { Types } from 'mongoose';
import type {
  Evidence,
  HabitMeasure,
  InferenceType,
  LocalDate,
  ProposedPayload,
} from '@synitheia/shared';
import type { PersonalEventDoc } from '../../db/models.js';

/** InferSchemaType omits _id; detectors cite event ids as evidence, so they need it. */
export type EventLean = PersonalEventDoc & { _id: Types.ObjectId };

/** A habit as a detector needs it: what it is, and how far along today is. */
export interface HabitToday {
  id: string;
  name: string;
  measure: HabitMeasure;
  frequency: 'daily' | 'weekly';
  targetCount: number;
  /** "HH:mm", or null when the habit has no reminder. */
  reminderTime: string | null;
  countToday: number;
}

/**
 * Everything a detector may look at, loaded once by the runner.
 *
 * Detectors are pure functions of this object. They do not query, and they do not read
 * the clock — `now` is handed in — which is what lets every rule be tested with plain
 * objects instead of a database and fake timers.
 */
export interface DetectorContext {
  userId: string;
  timezone: string;
  localDate: LocalDate;
  now: Date;
  /** The user's home currency, or null when the caller did not supply one. */
  currency: string | null;
  /** Today's events. */
  events: EventLean[];
  /** The 56 days before today, oldest data included. */
  history: EventLean[];
  /** Habits scheduled today, not archived. */
  habits: HabitToday[];
  /** Habits the user has rejected a completion suggestion for. */
  rejectedHabitIds: ReadonlySet<string>;
  waterTargetMl: number;
}

export interface Detection {
  /** Unique per (user, day). Per-habit detectors put the habit id in here. */
  detector: string;
  type: InferenceType;
  confidence: number;
  title: string;
  description: string | null;
  evidence: Evidence[];
  supportingEventIds: Types.ObjectId[];
  proposed: ProposedPayload;
}

export type Detector = (ctx: DetectorContext) => Detection[];
```

If `HabitMeasure` is not exported from `@synitheia/shared`, export it from `packages/shared/src/domain/habit.ts` next to `habitMeasureSchema` (`export type HabitMeasure = z.infer<typeof habitMeasureSchema>;`) and rebuild shared. `measureOf` in that file already uses the type, so it exists.

- [ ] **Step 2: Create `labels.ts`**

```ts
/** "1:04 PM" in the user's zone. */
export function timeLabel(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  }).format(instant);
}

/** Minutes since local midnight → "8:40 AM". No zone: the input is already local. */
export function minutesLabel(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = Math.round(minutes % 60);
  const suffix = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Indexed by `localWeekdayIndex`: 0 = Monday … 6 = Sunday. */
export const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;
```

- [ ] **Step 3: Create `possibleMeal.ts` and `lowWater.ts` by moving the existing code**

`possibleMeal.ts`: move `MEAL_WINDOWS` and `detectPossibleMeal` from `context/detectors.ts` verbatim (including their comments), with exactly these changes:

```ts
import { SUGGEST_THRESHOLD, addLocalDays, localMinutesOfDay, type Evidence } from '@synitheia/shared';
import { timeLabel } from './labels.js';
import type { Detection, Detector } from './types.js';

/** This rule was tuned on three weeks of history; the runner now loads eight. */
const LOOKBACK_DAYS = 21;
```

- signature becomes `export const detectPossibleMeal: Detector = (ctx) => {`
- `return null;` → `return [];` (three places), and the final `return { ... };` → `return [{ ... }];`
- the `similarPast` filter gains one leading line so it still only sees 21 days:

```ts
    const since = addLocalDays(ctx.localDate, -LOOKBACK_DAYS);
    const similarPast = ctx.history.filter((e) => {
      if (e.localDate < since) return false;
      if (e.type !== 'expense.created') return false;
```

`lowWater.ts`: move `detectLowWater` verbatim, and move the water-total and baseline arithmetic out of the old `runDetectors` into it, so it reads only `ctx`:

```ts
import { addLocalDays, localMinutesOfDay } from '@synitheia/shared';
import type { Detector } from './types.js';

const LOOKBACK_DAYS = 21;

/**
 * Water is trending well below this user's own normal.
 *
 * Compared against the user's own baseline, never a population norm — "8 glasses a day"
 * is a marketing slogan, and telling someone they are failing against a number that was
 * never theirs is exactly the generic nagging the brief rules out.
 */
export const detectLowWater: Detector = (ctx) => {
  const totalOf = (e: { metadata: unknown }): number =>
    (e.metadata as { totalMlToday?: number }).totalMlToday ?? 0;

  const todayMl = ctx.events
    .filter((e) => e.type === 'water.logged')
    .reduce((acc, e) => Math.max(acc, totalOf(e)), 0);

  const since = addLocalDays(ctx.localDate, -LOOKBACK_DAYS);
  const waterByDay = new Map<string, number>();
  for (const e of ctx.history) {
    if (e.type !== 'water.logged' || e.localDate < since) continue;
    waterByDay.set(e.localDate, Math.max(waterByDay.get(e.localDate) ?? 0, totalOf(e)));
  }

  const baselineMl =
    waterByDay.size > 0
      ? [...waterByDay.values()].reduce((a, b) => a + b, 0) / waterByDay.size
      : 0;

  // Needs a real baseline. With three days of history, "below your usual" is noise.
  if (baselineMl < 500) return [];

  // Do not fire before the evening — at 10am, everyone is "behind" on water.
  if (localMinutesOfDay(ctx.now, ctx.timezone) < 19 * 60) return [];

  if (todayMl >= baselineMl * 0.6) return [];

  return [
    {
      detector: 'low_water_vs_baseline',
      type: 'low_water',
      confidence: 0.8,
      title: `You've had ${todayMl} ml today`,
      description: `That's well below your usual ${Math.round(baselineMl)} ml by this time. Your target is ${ctx.waterTargetMl} ml.`,
      evidence: [
        {
          eventId: null,
          label: `Your recent daily average is ${Math.round(baselineMl)} ml`,
          weight: 1,
        },
      ],
      supportingEventIds: [],
      proposed: { kind: 'observation' },
    },
  ];
};
```

- [ ] **Step 4: Create `run.ts`**

```ts
import { Types } from 'mongoose';
import {
  addLocalDays,
  measureOf,
  todayLocalDate,
  type LocalDate,
  type SyncSuggestion,
} from '@synitheia/shared';
import {
  HabitLogModel,
  InferredContextModel,
  PersonalEventModel,
  UserPreferenceModel,
} from '../../db/models.js';
import { scheduledOn } from '../../modules/habits/service.js';
import { detectLowWater } from './lowWater.js';
import { detectPossibleMeal } from './possibleMeal.js';
import type { Detector, DetectorContext, EventLean, HabitToday } from './types.js';

/**
 * Detectors — the "Detect → Infer" half of the loop.
 *
 * Every rule here is DETERMINISTIC. No LLM is involved, and that is a deliberate
 * safety boundary, not a cost decision: a hallucinated meal written into someone's
 * calorie log, or a hallucinated ₹400 into their expenses, is a real harm, and a model
 * that is right 95% of the time will do it roughly once a fortnight. Rules are auditable,
 * explainable, and wrong in ways we can actually fix.
 *
 * A detector NEVER writes a domain record. It writes an InferredContext — a question.
 * Only the user's confirmation (see modules/inference/routes.ts) creates real data.
 */

/** Eight weeks, so a same-weekday baseline has up to eight samples. */
const HISTORY_DAYS = 56;

export const DETECTORS: Detector[] = [detectPossibleMeal, detectLowWater];

export interface RunOptions {
  /** Injected so tests and backfills do not depend on the wall clock. */
  now?: Date;
  /** The user's home currency. Without it, currency-dependent rules stay silent. */
  currency?: string | null;
}

/**
 * Run every detector for a user's day and persist any new suggestions.
 *
 * Returns only what THIS call created. The (userId, detector, localDate) unique index
 * means a detector asks a given question at most once per day; a second run finds the
 * row already there and reports nothing, which is what lets a caller notify on the
 * return value without tracking what it has already shown.
 */
export async function runDetectors(
  userId: string,
  timezone: string,
  localDate: LocalDate = todayLocalDate(timezone),
  options: RunOptions = {},
): Promise<SyncSuggestion[]> {
  const uid = new Types.ObjectId(userId);

  const [events, history, prefs, scheduled, logs, rejected] = await Promise.all([
    PersonalEventModel.find({ userId: uid, localDate }).lean<EventLean[]>(),
    PersonalEventModel.find({
      userId: uid,
      // Anchored on the day being evaluated, not the wall clock: a run for a past
      // localDate must see the weeks before THAT day, or its history is empty.
      localDate: { $gte: addLocalDays(localDate, -HISTORY_DAYS), $lt: localDate },
    }).lean<EventLean[]>(),
    UserPreferenceModel.findOne({ userId: uid }).lean(),
    scheduledOn(userId, localDate),
    HabitLogModel.find({ userId: uid, localDate }, { habitId: 1, count: 1 }).lean(),
    InferredContextModel.find(
      { userId: uid, type: 'possible_habit_completion', status: 'rejected' },
      { proposed: 1 },
    ).lean(),
  ]);

  const countByHabit = new Map(logs.map((l) => [l.habitId.toString(), l.count]));

  const habits: HabitToday[] = scheduled
    .filter((h) => !h.archivedAt)
    .map((h) => ({
      id: h._id.toString(),
      name: h.name,
      measure: measureOf(h as { measure?: HabitToday['measure'] | null }),
      frequency: h.frequency as HabitToday['frequency'],
      targetCount: h.targetCount,
      reminderTime: h.reminderTime ?? null,
      countToday: countByHabit.get(h._id.toString()) ?? 0,
    }));

  const rejectedHabitIds = new Set(
    rejected
      .map((r) => (r.proposed as { habitId?: unknown }).habitId)
      .filter((id): id is string => typeof id === 'string'),
  );

  const ctx: DetectorContext = {
    userId,
    timezone,
    localDate,
    now: options.now ?? new Date(),
    currency: options.currency ?? null,
    events,
    history,
    habits,
    rejectedHabitIds,
    waterTargetMl: prefs?.waterTargetMl ?? 2500,
  };

  const detections = DETECTORS.flatMap((detect) => detect(ctx));
  const created: SyncSuggestion[] = [];

  for (const d of detections) {
    const result = await InferredContextModel.updateOne(
      { userId: uid, detector: d.detector, localDate },
      {
        $setOnInsert: {
          userId: uid,
          detector: d.detector,
          localDate,
          type: d.type,
          confidence: d.confidence,
          title: d.title,
          description: d.description,
          evidence: d.evidence,
          supportingEventIds: d.supportingEventIds,
          proposed: d.proposed,
          status: 'pending',
          // Stale suggestions are noise. A "did you have lunch?" card from four days
          // ago is not a question anyone wants to answer.
          expiresAt: new Date(ctx.now.getTime() + 48 * 60 * 60 * 1000),
          resolvedAt: null,
          correction: null,
        },
      },
      { upsert: true },
    );

    if (result.upsertedCount > 0 && result.upsertedId) {
      created.push({
        id: result.upsertedId.toString(),
        type: d.type,
        title: d.title,
        actionable: d.proposed.kind !== 'observation',
      });
    }
  }

  return created;
}
```

- [ ] **Step 5: Create `testing.ts`**

```ts
import { Types } from 'mongoose';
import { asLocalDate, toLocalDate } from '@synitheia/shared';
import type { DetectorContext, EventLean } from './types.js';

/**
 * Test-only builders. Detectors are pure, so most of their tests need objects, not Mongo.
 * Imported only from *.test.ts files.
 */

export const TEST_TZ = 'Asia/Kolkata';
/** A Sunday. `localWeekdayIndex` → 6. */
export const TEST_DAY = asLocalDate('2026-07-12');

/** An instant at `HH:mm` IST on `day`. IST is UTC+5:30 with no DST, so this is exact. */
export function istAt(localTime: string, day: string = TEST_DAY): Date {
  const [h, m] = localTime.split(':').map(Number) as [number, number];
  const utcMinutes = h * 60 + m - (5 * 60 + 30);
  return new Date(Date.parse(`${day}T00:00:00Z`) + utcMinutes * 60_000);
}

export function fakeEvent(input: {
  type: string;
  at: Date;
  metadata?: Record<string, unknown>;
  source?: string;
}): EventLean {
  return {
    _id: new Types.ObjectId(),
    type: input.type,
    source: input.source ?? 'manual',
    timestamp: input.at,
    timezone: TEST_TZ,
    localDate: toLocalDate(input.at, TEST_TZ),
    metadata: { type: input.type, ...(input.metadata ?? {}) },
  } as unknown as EventLean;
}

export function baseCtx(overrides: Partial<DetectorContext> = {}): DetectorContext {
  return {
    userId: new Types.ObjectId().toString(),
    timezone: TEST_TZ,
    localDate: TEST_DAY,
    now: istAt('20:00'),
    currency: 'INR',
    events: [],
    history: [],
    habits: [],
    rejectedHabitIds: new Set(),
    waterTargetMl: 2500,
    ...overrides,
  };
}
```

- [ ] **Step 6: Move the test file and delete the old module**

```bash
git mv apps/api/src/context/detectors.test.ts apps/api/src/context/detectors/run.test.ts
git rm apps/api/src/context/detectors.ts
```

In `run.test.ts`:
- change the three relative imports: `'../db/models.js'` → `'../../db/models.js'`, `'./engine.js'` → `'../engine.js'`, `'./detectors.js'` → `'./run.js'`
- the model sync in `beforeAll` gains `HabitModel.syncIndexes()` and `HabitLogModel.syncIndexes()` (import both from `'../../db/models.js'`), and `afterEach` gains `HabitModel.deleteMany({})` and `HabitLogModel.deleteMany({})`
- `expect(await runDetectors(userId, IST, TODAY)).toBe(1);` → `expect(await runDetectors(userId, IST, TODAY)).toHaveLength(1);`

Add one test at the end of the `possible_meal detector` block, pinning the new return contract:

```ts
  it('returns what it created, and nothing on a second run', async () => {
    const userId = freshUser();
    await foodExpense(userId, at('13:04'));

    const first = await runDetectors(userId, IST, TODAY);
    expect(first).toEqual([
      expect.objectContaining({ type: 'possible_meal', actionable: true }),
    ]);
    expect(first[0]!.id).toMatch(/^[a-f\d]{24}$/);

    expect(await runDetectors(userId, IST, TODAY)).toEqual([]);
  });
```

In `apps/api/src/modules/today/routes.ts`, change the import of `runDetectors` to `'../../context/detectors/run.js'`. Leave the call as it is; Task 8 changes it.

- [ ] **Step 7: Run the suite**

Run: `pnpm --filter @synitheia/api exec vitest run src/context/detectors`
Expected: PASS — the 14 existing tests plus the new one.

- [ ] **Step 8: Commit**

```bash
pnpm check
git add -A apps/api/src/context apps/api/src/modules/today/routes.ts packages/shared
git commit -m "refactor(api): split detectors into pure functions over a loaded context"
```

---

### Task 3: Unusual spending detector

**Files:**
- Create: `apps/api/src/context/detectors/unusualSpending.ts`
- Test: `apps/api/src/context/detectors/unusualSpending.test.ts`
- Modify: `apps/api/src/context/detectors/run.ts` (register)

**Interfaces:**
- Consumes: `Detector`, `DetectorContext` (Task 2); `baseCtx`, `fakeEvent`, `istAt` (Task 2); `WEEKDAY_NAMES` (Task 2)
- Produces: `detectUnusualSpending: Detector` — detector name `unusual_spending_vs_weekday`, type `unusual_spending`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { detectUnusualSpending } from './unusualSpending.js';
import { baseCtx, fakeEvent, istAt } from './testing.js';

/** Sundays before TEST_DAY (2026-07-12). */
const SUNDAYS = ['2026-07-05', '2026-06-28', '2026-06-21', '2026-06-14'];

const spend = (amountMinor: number, day?: string, currency = 'INR') =>
  fakeEvent({
    type: 'expense.created',
    at: istAt('14:00', day),
    metadata: { amountMinor, currency, categoryName: 'Food' },
  });

describe('unusual spending', () => {
  it('fires when today is well above the same-weekday average', () => {
    const ctx = baseCtx({
      events: [spend(90_000)],
      history: SUNDAYS.slice(0, 3).map((d) => spend(40_000, d)),
    });

    const [d] = detectUnusualSpending(ctx);

    expect(d).toBeDefined();
    expect(d!.type).toBe('unusual_spending');
    expect(d!.proposed).toEqual({ kind: 'observation' });
    expect(d!.title).toBe("You've spent more than usual for a Sunday");
    // Formatted in code, in the user's currency — never a bare minor-unit number.
    expect(d!.description).toContain('₹900');
    expect(d!.description).toContain('₹400');
    expect(d!.evidence.some((e) => e.label.includes('3 Sundays'))).toBe(true);
  });

  it('needs three prior same-weekdays before it says anything', () => {
    const ctx = baseCtx({
      events: [spend(90_000)],
      history: SUNDAYS.slice(0, 2).map((d) => spend(40_000, d)),
    });
    expect(detectUnusualSpending(ctx)).toEqual([]);
  });

  it('ignores other weekdays in the baseline', () => {
    const ctx = baseCtx({
      events: [spend(90_000)],
      // Three Saturdays, not Sundays.
      history: ['2026-07-11', '2026-07-04', '2026-06-27'].map((d) => spend(40_000, d)),
    });
    expect(detectUnusualSpending(ctx)).toEqual([]);
  });

  it('does not fire just under 1.5×', () => {
    const ctx = baseCtx({
      events: [spend(59_900)],
      history: SUNDAYS.slice(0, 3).map((d) => spend(40_000, d)),
    });
    expect(detectUnusualSpending(ctx)).toEqual([]);
  });

  it('does not fire on ratio alone when the excess is small', () => {
    // 2× the average, but only ₹40 over it.
    const ctx = baseCtx({
      events: [spend(8_000)],
      history: SUNDAYS.slice(0, 3).map((d) => spend(4_000, d)),
    });
    expect(detectUnusualSpending(ctx)).toEqual([]);
  });

  it('leaves foreign-currency expenses out of both sides', () => {
    const ctx = baseCtx({
      // ₹300 at home plus a large USD charge: only the INR counts toward today.
      events: [spend(30_000), spend(500_000, undefined, 'USD')],
      history: SUNDAYS.slice(0, 3).map((d) => spend(40_000, d)),
    });
    expect(detectUnusualSpending(ctx)).toEqual([]);
  });

  it('sums several expenses on one day into one sample', () => {
    const ctx = baseCtx({
      events: [spend(50_000), spend(40_000)],
      history: SUNDAYS.slice(0, 3).flatMap((d) => [spend(20_000, d), spend(20_000, d)]),
    });
    expect(detectUnusualSpending(ctx)).toHaveLength(1);
  });

  it('is silent without a home currency', () => {
    const ctx = baseCtx({
      currency: null,
      events: [spend(90_000)],
      history: SUNDAYS.slice(0, 3).map((d) => spend(40_000, d)),
    });
    expect(detectUnusualSpending(ctx)).toEqual([]);
  });

  it('is more confident at 2× and with more samples, and never certain', () => {
    const base = detectUnusualSpending(
      baseCtx({
        events: [spend(65_000)],
        history: SUNDAYS.slice(0, 3).map((d) => spend(40_000, d)),
      }),
    )[0]!;
    const strong = detectUnusualSpending(
      baseCtx({
        events: [spend(90_000)],
        history: [...SUNDAYS, '2026-06-07', '2026-05-31'].map((d) => spend(40_000, d)),
      }),
    )[0]!;

    expect(base.confidence).toBeCloseTo(0.6);
    expect(strong.confidence).toBeCloseTo(0.8);
    expect(strong.confidence).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @synitheia/api exec vitest run src/context/detectors/unusualSpending.test.ts`
Expected: FAIL — cannot find module `./unusualSpending.js`.

- [ ] **Step 3: Implement**

```ts
import { asMinor, formatMoney, localWeekdayIndex, type LocalDate } from '@synitheia/shared';
import { WEEKDAY_NAMES } from './labels.js';
import type { Detector, EventLean } from './types.js';

const MIN_SAMPLES = 3;
const RATIO = 1.5;
/** ₹100. Stops ₹60 against a ₹40 average from firing on ratio alone. */
const MIN_EXCESS_MINOR = 10_000;

/**
 * Today's spending is well above this user's own normal for this weekday.
 *
 * Same weekday, not a rolling average: a Saturday is not an anomaly for being a Saturday,
 * and comparing it to Tuesdays would fire every weekend.
 */
export const detectUnusualSpending: Detector = (ctx) => {
  const currency = ctx.currency;
  if (!currency) return [];

  // A foreign charge cannot be added to rupees, and converting it would mean inventing a
  // rate. It is left out of both today and the baseline.
  const isHomeExpense = (e: EventLean): boolean =>
    e.type === 'expense.created' &&
    (e.metadata as { currency?: string }).currency === currency;
  const amountOf = (e: EventLean): number =>
    (e.metadata as { amountMinor?: number }).amountMinor ?? 0;

  const todayEvents = ctx.events.filter(isHomeExpense);
  const today = todayEvents.reduce((sum, e) => sum + amountOf(e), 0);
  if (today === 0) return [];

  const weekday = localWeekdayIndex(ctx.localDate);
  const byDay = new Map<string, number>();
  for (const e of ctx.history) {
    if (!isHomeExpense(e)) continue;
    if (localWeekdayIndex(e.localDate as LocalDate) !== weekday) continue;
    byDay.set(e.localDate, (byDay.get(e.localDate) ?? 0) + amountOf(e));
  }

  const samples = [...byDay.values()].filter((total) => total > 0);
  if (samples.length < MIN_SAMPLES) return [];

  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  if (today < mean * RATIO) return [];
  if (today - mean < MIN_EXCESS_MINOR) return [];

  let confidence = 0.6;
  if (today >= mean * 2) confidence += 0.1;
  if (samples.length >= 6) confidence += 0.1;

  const dayName = WEEKDAY_NAMES[weekday]!;
  const todayLabel = formatMoney(asMinor(today), currency);
  const meanLabel = formatMoney(asMinor(Math.round(mean)), currency);

  return [
    {
      detector: 'unusual_spending_vs_weekday',
      type: 'unusual_spending',
      confidence,
      title: `You've spent more than usual for a ${dayName}`,
      description: `${todayLabel} today, against a usual ${meanLabel}.`,
      evidence: [
        { eventId: null, label: `${todayLabel} spent today`, weight: 0.5 },
        {
          eventId: null,
          label: `Your ${dayName} average is ${meanLabel}, based on ${samples.length} ${dayName}s`,
          weight: 0.5,
        },
      ],
      supportingEventIds: todayEvents.map((e) => e._id),
      proposed: { kind: 'observation' },
    },
  ];
};
```

If `formatMoney(asMinor(90_000), 'INR')` renders as `₹900.00` rather than `₹900`, the `toContain('₹900')` assertions still hold. Do not change the formatter.

- [ ] **Step 4: Register it**

In `run.ts`, import `detectUnusualSpending` and extend the list:

```ts
export const DETECTORS: Detector[] = [detectPossibleMeal, detectLowWater, detectUnusualSpending];
```

- [ ] **Step 5: Run and commit**

Run: `pnpm --filter @synitheia/api exec vitest run src/context/detectors`
Expected: PASS.

```bash
pnpm check
git add apps/api/src/context/detectors
git commit -m "feat(api): unusual spending detector against the same-weekday baseline"
```

---

### Task 4: Low activity detector

**Files:**
- Create: `apps/api/src/context/detectors/lowActivity.ts`
- Test: `apps/api/src/context/detectors/lowActivity.test.ts`
- Modify: `apps/api/src/context/detectors/run.ts` (register)

**Interfaces:**
- Consumes: `Detector` (Task 2); `'low_activity'` type (Task 1)
- Produces: `detectLowActivity: Detector` — detector name `low_activity_vs_baseline`, type `low_activity`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { addLocalDays } from '@synitheia/shared';
import { detectLowActivity } from './lowActivity.js';
import { TEST_DAY, baseCtx, fakeEvent, istAt } from './testing.js';

const steps = (count: number, day?: string) =>
  fakeEvent({
    type: 'steps.recorded',
    source: 'health',
    at: istAt('12:00', day),
    metadata: { steps: count, distanceM: null },
  });

/** `n` consecutive days before TEST_DAY, each with `count` steps. */
const pastDays = (n: number, count: number) =>
  Array.from({ length: n }, (_, i) => steps(count, addLocalDays(TEST_DAY, -(i + 1))));

describe('low activity', () => {
  it('fires in the evening when steps are far below the 14-day average', () => {
    const [d] = detectLowActivity(
      baseCtx({ now: istAt('20:00'), events: [steps(3_000)], history: pastDays(10, 8_000) }),
    );

    expect(d).toBeDefined();
    expect(d!.type).toBe('low_activity');
    expect(d!.title).toBe('A quieter day than usual');
    expect(d!.description).toContain('3,000');
    expect(d!.description).toContain('8,000');
    expect(d!.proposed).toEqual({ kind: 'observation' });
  });

  it('does not fire before 7 PM, when everyone is legitimately behind', () => {
    expect(
      detectLowActivity(
        baseCtx({ now: istAt('18:59'), events: [steps(1_000)], history: pastDays(10, 8_000) }),
      ),
    ).toEqual([]);
  });

  it('fires at exactly 7 PM', () => {
    expect(
      detectLowActivity(
        baseCtx({ now: istAt('19:00'), events: [steps(1_000)], history: pastDays(10, 8_000) }),
      ),
    ).toHaveLength(1);
  });

  it('needs seven days of step data', () => {
    expect(
      detectLowActivity(
        baseCtx({ events: [steps(1_000)], history: pastDays(6, 8_000) }),
      ),
    ).toEqual([]);
  });

  it('does not treat a day with no step data as a low day', () => {
    // Health did not sync, or the phone stayed home. Absence is not zero.
    expect(detectLowActivity(baseCtx({ events: [], history: pastDays(10, 8_000) }))).toEqual([]);
  });

  it('does not fire at 60% of the average', () => {
    expect(
      detectLowActivity(baseCtx({ events: [steps(4_800)], history: pastDays(10, 8_000) })),
    ).toEqual([]);
  });

  it('only looks at the last 14 days', () => {
    // Ten high days, but all older than two weeks: not a baseline.
    const old = Array.from({ length: 10 }, (_, i) =>
      steps(8_000, addLocalDays(TEST_DAY, -(15 + i))),
    );
    expect(detectLowActivity(baseCtx({ events: [steps(1_000)], history: old }))).toEqual([]);
  });

  it('is more confident under 40%', () => {
    const mild = detectLowActivity(
      baseCtx({ events: [steps(4_000)], history: pastDays(10, 8_000) }),
    )[0]!;
    const strong = detectLowActivity(
      baseCtx({ events: [steps(2_000)], history: pastDays(10, 8_000) }),
    )[0]!;
    expect(mild.confidence).toBeCloseTo(0.6);
    expect(strong.confidence).toBeCloseTo(0.7);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @synitheia/api exec vitest run src/context/detectors/lowActivity.test.ts`
Expected: FAIL — cannot find module `./lowActivity.js`.

- [ ] **Step 3: Implement**

```ts
import { addLocalDays, localMinutesOfDay } from '@synitheia/shared';
import type { Detector, EventLean } from './types.js';

const LOOKBACK_DAYS = 14;
const MIN_DAYS = 7;
const EVENING_MINUTES = 19 * 60;
const RATIO = 0.6;

const stepsOf = (e: EventLean): number => (e.metadata as { steps?: number }).steps ?? 0;

/**
 * Steps are well under this user's own recent normal, late enough in the day to mean it.
 *
 * Against their own average, never 10,000: a number from a 1960s pedometer advert is not
 * a baseline for anyone.
 */
export const detectLowActivity: Detector = (ctx) => {
  // No step event today means Health has not reported, not that the user sat still.
  const todayEvent = ctx.events.find((e) => e.type === 'steps.recorded');
  if (!todayEvent) return [];

  if (localMinutesOfDay(ctx.now, ctx.timezone) < EVENING_MINUTES) return [];

  const since = addLocalDays(ctx.localDate, -LOOKBACK_DAYS);
  const recent = ctx.history.filter(
    (e) => e.type === 'steps.recorded' && e.localDate >= since,
  );
  if (recent.length < MIN_DAYS) return [];

  const mean = recent.reduce((sum, e) => sum + stepsOf(e), 0) / recent.length;
  const today = stepsOf(todayEvent);
  if (mean <= 0 || today >= mean * RATIO) return [];

  const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

  return [
    {
      detector: 'low_activity_vs_baseline',
      type: 'low_activity',
      confidence: today < mean * 0.4 ? 0.7 : 0.6,
      title: 'A quieter day than usual',
      description: `${fmt(today)} steps so far, against a usual ${fmt(mean)}.`,
      evidence: [
        { eventId: todayEvent._id.toString(), label: `${fmt(today)} steps today`, weight: 0.5 },
        {
          eventId: null,
          label: `Your average is ${fmt(mean)} steps, over ${recent.length} recent days`,
          weight: 0.5,
        },
      ],
      supportingEventIds: [todayEvent._id],
      proposed: { kind: 'observation' },
    },
  ];
};
```

- [ ] **Step 4: Register, run, commit**

In `run.ts` append `detectLowActivity` to `DETECTORS`.

Run: `pnpm --filter @synitheia/api exec vitest run src/context/detectors`
Expected: PASS.

```bash
pnpm check
git add apps/api/src/context/detectors
git commit -m "feat(api): low activity detector against the 14-day step baseline"
```

---

### Task 5: Habit slipping detector

**Files:**
- Create: `apps/api/src/context/detectors/habitSlipping.ts`
- Test: `apps/api/src/context/detectors/habitSlipping.test.ts`
- Modify: `apps/api/src/context/detectors/run.ts` (register)

**Interfaces:**
- Consumes: `Detector`, `HabitToday` (Task 2); `minutesLabel` (Task 2)
- Produces: `detectHabitSlipping: Detector` — detector name `habit_slipping:<habitId>`, type `missed_habit`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { addLocalDays } from '@synitheia/shared';
import { detectHabitSlipping } from './habitSlipping.js';
import { TEST_DAY, baseCtx, fakeEvent, istAt } from './testing.js';
import type { HabitToday } from './types.js';

const HABIT_ID = '6a7025c8d36b5e0013390aaa';

const habit = (overrides: Partial<HabitToday> = {}): HabitToday => ({
  id: HABIT_ID,
  name: 'Reading',
  measure: 'check',
  frequency: 'daily',
  targetCount: 1,
  reminderTime: null,
  countToday: 0,
  ...overrides,
});

/** `n` past completions at `time`, one per day going back from yesterday. */
const completions = (n: number, time: string, habitId = HABIT_ID) =>
  Array.from({ length: n }, (_, i) =>
    fakeEvent({
      type: 'habit.completed',
      at: istAt(time, addLocalDays(TEST_DAY, -(i + 1))),
      metadata: { habitId, habitName: 'Reading' },
    }),
  );

describe('habit slipping', () => {
  it('fires 90 minutes past the usual completion time', () => {
    const [d] = detectHabitSlipping(
      baseCtx({ now: istAt('10:10'), habits: [habit()], history: completions(6, '08:40') }),
    );

    expect(d).toBeDefined();
    expect(d!.detector).toBe(`habit_slipping:${HABIT_ID}`);
    expect(d!.type).toBe('missed_habit');
    expect(d!.title).toBe('Reading is usually done by now');
    expect(d!.evidence[0]!.label).toBe(
      'Usually completed around 8:40 AM, based on 6 of the last 28 days',
    );
    expect(d!.proposed).toEqual({ kind: 'observation' });
  });

  it('does not fire at 89 minutes past', () => {
    expect(
      detectHabitSlipping(
        baseCtx({ now: istAt('10:09'), habits: [habit()], history: completions(6, '08:40') }),
      ),
    ).toEqual([]);
  });

  it('needs five past completions', () => {
    expect(
      detectHabitSlipping(
        baseCtx({ now: istAt('12:00'), habits: [habit()], history: completions(4, '08:40') }),
      ),
    ).toEqual([]);
  });

  it('is silent once the habit is done today', () => {
    expect(
      detectHabitSlipping(
        baseCtx({
          now: istAt('12:00'),
          habits: [habit({ countToday: 1 })],
          history: completions(6, '08:40'),
        }),
      ),
    ).toEqual([]);
  });

  it('is silent from 10 PM — too late to act on', () => {
    expect(
      detectHabitSlipping(
        baseCtx({ now: istAt('22:00'), habits: [habit()], history: completions(6, '08:40') }),
      ),
    ).toEqual([]);
  });

  it('defers to a reminder that is still to come today', () => {
    expect(
      detectHabitSlipping(
        baseCtx({
          now: istAt('12:00'),
          habits: [habit({ reminderTime: '19:00' })],
          history: completions(6, '08:40'),
        }),
      ),
    ).toEqual([]);
  });

  it('fires when the reminder has already passed', () => {
    expect(
      detectHabitSlipping(
        baseCtx({
          now: istAt('12:00'),
          habits: [habit({ reminderTime: '09:00' })],
          history: completions(6, '08:40'),
        }),
      ),
    ).toHaveLength(1);
  });

  it('skips weekly habits and step habits', () => {
    const ctx = baseCtx({
      now: istAt('12:00'),
      habits: [habit({ frequency: 'weekly' }), habit({ measure: 'steps', targetCount: 8000 })],
      history: completions(6, '08:40'),
    });
    expect(detectHabitSlipping(ctx)).toEqual([]);
  });

  it('uses the median, so one late night does not move the usual time', () => {
    const history = [
      ...completions(5, '08:40'),
      fakeEvent({
        type: 'habit.completed',
        at: istAt('21:30', addLocalDays(TEST_DAY, -6)),
        metadata: { habitId: HABIT_ID, habitName: 'Reading' },
      }),
    ];
    expect(
      detectHabitSlipping(baseCtx({ now: istAt('10:10'), habits: [habit()], history })),
    ).toHaveLength(1);
  });

  it('ignores completions older than 28 days and other habits', () => {
    const old = Array.from({ length: 6 }, (_, i) =>
      fakeEvent({
        type: 'habit.completed',
        at: istAt('08:40', addLocalDays(TEST_DAY, -(29 + i))),
        metadata: { habitId: HABIT_ID, habitName: 'Reading' },
      }),
    );
    const other = completions(6, '08:40', '6a7025c8d36b5e0013390bbb');
    expect(
      detectHabitSlipping(
        baseCtx({ now: istAt('12:00'), habits: [habit()], history: [...old, ...other] }),
      ),
    ).toEqual([]);
  });

  it('is more confident with ten or more completions', () => {
    const few = detectHabitSlipping(
      baseCtx({ now: istAt('12:00'), habits: [habit()], history: completions(5, '08:40') }),
    )[0]!;
    const many = detectHabitSlipping(
      baseCtx({ now: istAt('12:00'), habits: [habit()], history: completions(10, '08:40') }),
    )[0]!;
    expect(few.confidence).toBeCloseTo(0.6);
    expect(many.confidence).toBeCloseTo(0.7);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @synitheia/api exec vitest run src/context/detectors/habitSlipping.test.ts`
Expected: FAIL — cannot find module `./habitSlipping.js`.

- [ ] **Step 3: Implement**

```ts
import { addLocalDays, localMinutesOfDay } from '@synitheia/shared';
import { minutesLabel } from './labels.js';
import type { Detection, Detector } from './types.js';

const LOOKBACK_DAYS = 28;
const MIN_COMPLETIONS = 5;
const GRACE_MINUTES = 90;
const CUTOFF_MINUTES = 22 * 60;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/**
 * A habit that is normally done by now, and is not.
 *
 * An observation, not a reminder: it fires from the user's own behaviour rather than a
 * time they set, and it stays silent whenever a reminder they did set is still to come.
 */
export const detectHabitSlipping: Detector = (ctx) => {
  const nowMinutes = localMinutesOfDay(ctx.now, ctx.timezone);
  // Past ten there is nothing left to do about it but feel bad.
  if (nowMinutes >= CUTOFF_MINUTES) return [];

  const since = addLocalDays(ctx.localDate, -LOOKBACK_DAYS);
  const detections: Detection[] = [];

  for (const habit of ctx.habits) {
    // Weekly habits have no "by this time today"; step habits complete from Health.
    if (habit.frequency !== 'daily' || habit.measure === 'steps') continue;
    if (habit.countToday >= habit.targetCount) continue;
    if (habit.reminderTime && toMinutes(habit.reminderTime) > nowMinutes) continue;

    const minutes = ctx.history
      .filter(
        (e) =>
          e.type === 'habit.completed' &&
          e.localDate >= since &&
          (e.metadata as { habitId?: string }).habitId === habit.id,
      )
      .map((e) => localMinutesOfDay(e.timestamp, ctx.timezone));

    if (minutes.length < MIN_COMPLETIONS) continue;

    const usual = median(minutes);
    if (nowMinutes < usual + GRACE_MINUTES) continue;

    detections.push({
      detector: `habit_slipping:${habit.id}`,
      type: 'missed_habit',
      confidence: minutes.length >= 10 ? 0.7 : 0.6,
      title: `${habit.name} is usually done by now`,
      description: null,
      evidence: [
        {
          eventId: null,
          label: `Usually completed around ${minutesLabel(usual)}, based on ${minutes.length} of the last ${LOOKBACK_DAYS} days`,
          weight: 1,
        },
      ],
      supportingEventIds: [],
      proposed: { kind: 'observation' },
    });
  }

  return detections;
};
```

- [ ] **Step 4: Register, run, commit**

In `run.ts` append `detectHabitSlipping` to `DETECTORS`.

Run: `pnpm --filter @synitheia/api exec vitest run src/context/detectors`
Expected: PASS.

```bash
pnpm check
git add apps/api/src/context/detectors
git commit -m "feat(api): habit slipping detector from the user's own completion times"
```

---

### Task 6: Workout → habit detector

**Files:**
- Create: `apps/api/src/context/detectors/workoutMatch.ts`, `workoutHabit.ts`
- Test: `apps/api/src/context/detectors/workoutMatch.test.ts`, `workoutHabit.test.ts`
- Modify: `apps/api/src/context/detectors/run.ts` (register), `run.test.ts` (one integration test)

**Interfaces:**
- Consumes: `Detector`, `HabitToday`, `DetectorContext.rejectedHabitIds` (Task 2)
- Produces:
  - `activityName(raw: string): string` and `matchWorkout(habitName: string, activity: string): 'specific' | 'generic' | null` (`workoutMatch.ts`)
  - `detectWorkoutHabit: Detector` — detector name `workout_habit:<habitId>`, type `possible_habit_completion`, proposed `{ kind: 'habit', habitId, count }`

- [ ] **Step 1: Write the failing matching test**

`workoutMatch.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { activityName, matchWorkout } from './workoutMatch.js';

describe('activityName', () => {
  it('passes a HealthKit name through, lower-cased', () => {
    expect(activityName('running')).toBe('running');
    expect(activityName('traditionalStrengthTraining')).toBe('traditionalstrengthtraining');
  });

  it('translates the numeric codes older events were stored with', () => {
    expect(activityName('37')).toBe('running');
    expect(activityName('52')).toBe('walking');
    expect(activityName('13')).toBe('cycling');
    expect(activityName('50')).toBe('traditionalstrengthtraining');
  });

  it('leaves an unknown code as it is rather than guessing', () => {
    expect(activityName('9999')).toBe('9999');
  });
});

describe('matchWorkout', () => {
  it.each([
    ['Morning run', 'running', 'specific'],
    ['Go Running', 'running', 'specific'],
    ['Evening jog', 'running', 'specific'],
    ['Yoga', 'yoga', 'specific'],
    ['Lift weights', 'traditionalStrengthTraining', 'specific'],
    ['Strength', 'functionalStrengthTraining', 'specific'],
    ['Bike to work', 'cycling', 'specific'],
    ['Swim', 'swimming', 'specific'],
    ['Walk the dog', 'walking', 'specific'],
    ['Morning run', '37', 'specific'],
  ] as const)('%s ← %s is a specific match', (habit, activity, expected) => {
    expect(matchWorkout(habit, activity)).toBe(expected);
  });

  it.each([
    ['Workout', 'running'],
    ['Gym', 'traditionalStrengthTraining'],
    ['Exercise 30 min', 'yoga'],
    ['Cardio', 'cycling'],
    ['Daily training', 'other'],
  ] as const)('%s ← %s is a generic match', (habit, activity) => {
    expect(matchWorkout(habit, activity)).toBe('generic');
  });

  it.each([
    ['Read 20 pages', 'running'],
    ['Drink water', 'yoga'],
    // Whole words only: "brunch" contains "run", "trainspotting" contains "train".
    ['Brunch with mum', 'running'],
    ['Trainspotting notes', 'running'],
    // A specific habit does not match a different activity.
    ['Morning run', 'yoga'],
    ['Yoga', 'swimming'],
  ] as const)('%s ← %s does not match', (habit, activity) => {
    expect(matchWorkout(habit, activity)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @synitheia/api exec vitest run src/context/detectors/workoutMatch.test.ts`
Expected: FAIL — cannot find module `./workoutMatch.js`.

- [ ] **Step 3: Implement `workoutMatch.ts`**

```ts
/**
 * Matching a Health workout to a habit by the habit's name.
 *
 * Habits have no "exercise" category, so the name is all there is. That is a guess, which
 * is why this only ever feeds a question ("Mark Morning run done?") and never a write,
 * and why one rejection silences it for that habit.
 */

/**
 * HKWorkoutActivityType raw values → names.
 *
 * The device reader used to send `String(workoutActivityType)`, which for a numeric enum
 * is "37", not "running". The reader now sends the name, but events already stored carry
 * the number, and they must keep matching.
 */
const HK_CODES: Record<string, string> = {
  '13': 'cycling',
  '14': 'dance',
  '16': 'elliptical',
  '20': 'functionalstrengthtraining',
  '24': 'hiking',
  '35': 'rowing',
  '37': 'running',
  '46': 'swimming',
  '50': 'traditionalstrengthtraining',
  '52': 'walking',
  '57': 'yoga',
  '59': 'coretraining',
  '63': 'highintensityintervaltraining',
  '66': 'pilates',
  '73': 'mixedcardio',
  '77': 'cardiodance',
  '78': 'socialdance',
};

export function activityName(raw: string): string {
  const trimmed = raw.trim();
  return HK_CODES[trimmed] ?? trimmed.toLowerCase();
}

/** Habit-name words that mean "any workout counts". */
const GENERIC_WORDS = new Set([
  'workout',
  'exercise',
  'gym',
  'training',
  'train',
  'fitness',
  'cardio',
]);

/** Habit-name words → the fragment an activity name must contain. */
const SPECIFIC_WORDS: Record<string, string> = {
  run: 'running',
  running: 'running',
  jog: 'running',
  jogging: 'running',
  walk: 'walking',
  walking: 'walking',
  cycle: 'cycling',
  cycling: 'cycling',
  bike: 'cycling',
  biking: 'cycling',
  swim: 'swimming',
  swimming: 'swimming',
  yoga: 'yoga',
  strength: 'strength',
  weights: 'strength',
  lifting: 'strength',
  lift: 'strength',
  hike: 'hiking',
  hiking: 'hiking',
  pilates: 'pilates',
  dance: 'dance',
  dancing: 'dance',
};

export function matchWorkout(
  habitName: string,
  activity: string,
): 'specific' | 'generic' | null {
  const words = habitName.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const name = activityName(activity);

  // Whole words on the habit side: "brunch" must not match "run".
  for (const word of words) {
    const fragment = SPECIFIC_WORDS[word];
    if (fragment && name.includes(fragment)) return 'specific';
  }

  // Only a generic word matches any workout. A habit that names one activity and nothing
  // else ("Morning run") falls through to null for a yoga session.
  if (words.some((word) => GENERIC_WORDS.has(word))) return 'generic';

  return null;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @synitheia/api exec vitest run src/context/detectors/workoutMatch.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing detector test**

`workoutHabit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { detectWorkoutHabit } from './workoutHabit.js';
import { baseCtx, fakeEvent, istAt } from './testing.js';
import type { HabitToday } from './types.js';

const RUN_ID = '6a7025c8d36b5e0013390aaa';
const GYM_ID = '6a7025c8d36b5e0013390bbb';

const habit = (overrides: Partial<HabitToday> = {}): HabitToday => ({
  id: RUN_ID,
  name: 'Morning run',
  measure: 'check',
  frequency: 'daily',
  targetCount: 1,
  reminderTime: null,
  countToday: 0,
  ...overrides,
});

const workout = (activity: string, durationMin = 32) =>
  fakeEvent({
    type: 'workout.detected',
    source: 'health',
    at: istAt('12:00'),
    metadata: { activity, durationMin, calories: 310 },
  });

describe('workout → habit', () => {
  it('asks to mark a matching habit done', () => {
    const event = workout('running');
    const [d] = detectWorkoutHabit(baseCtx({ events: [event], habits: [habit()] }));

    expect(d).toBeDefined();
    expect(d!.detector).toBe(`workout_habit:${RUN_ID}`);
    expect(d!.type).toBe('possible_habit_completion');
    expect(d!.title).toBe('Mark Morning run done?');
    expect(d!.proposed).toEqual({ kind: 'habit', habitId: RUN_ID, count: 1 });
    expect(d!.evidence[0]!.label).toBe('Running, 32 min, from Apple Health');
    expect(d!.supportingEventIds).toEqual([event._id]);
    expect(d!.confidence).toBeCloseTo(0.8);
  });

  it('is less sure of a generic match', () => {
    const [d] = detectWorkoutHabit(
      baseCtx({ events: [workout('yoga')], habits: [habit({ id: GYM_ID, name: 'Workout' })] }),
    );
    expect(d!.confidence).toBeCloseTo(0.65);
  });

  it('proposes the minutes for a duration habit', () => {
    const [d] = detectWorkoutHabit(
      baseCtx({
        events: [workout('running', 32.4)],
        habits: [habit({ measure: 'duration', targetCount: 30 })],
      }),
    );
    expect(d!.proposed).toEqual({ kind: 'habit', habitId: RUN_ID, count: 32 });
  });

  it('proposes at least one minute for a very short workout', () => {
    const [d] = detectWorkoutHabit(
      baseCtx({
        events: [workout('running', 0.2)],
        habits: [habit({ measure: 'duration', targetCount: 30 })],
      }),
    );
    expect((d!.proposed as { count: number }).count).toBe(1);
  });

  it('says nothing when there is no workout', () => {
    expect(detectWorkoutHabit(baseCtx({ habits: [habit()] }))).toEqual([]);
  });

  it('says nothing for a habit already done today', () => {
    expect(
      detectWorkoutHabit(
        baseCtx({ events: [workout('running')], habits: [habit({ countToday: 1 })] }),
      ),
    ).toEqual([]);
  });

  it('never asks again about a habit the user has rejected', () => {
    expect(
      detectWorkoutHabit(
        baseCtx({
          events: [workout('running')],
          habits: [habit()],
          rejectedHabitIds: new Set([RUN_ID]),
        }),
      ),
    ).toEqual([]);
  });

  it('skips step habits and weekly habits', () => {
    expect(
      detectWorkoutHabit(
        baseCtx({
          events: [workout('walking')],
          habits: [
            habit({ name: 'Walk', measure: 'steps', targetCount: 8000 }),
            habit({ id: GYM_ID, name: 'Walk', frequency: 'weekly' }),
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('asks once per habit, preferring the specific match', () => {
    const run = workout('running', 20);
    const yoga = workout('yoga', 45);
    const detections = detectWorkoutHabit(
      baseCtx({
        events: [yoga, run],
        habits: [habit(), habit({ id: GYM_ID, name: 'Workout' })],
      }),
    );

    expect(detections.map((d) => d.detector).sort()).toEqual(
      [`workout_habit:${RUN_ID}`, `workout_habit:${GYM_ID}`].sort(),
    );
    const runDetection = detections.find((d) => d.detector.endsWith(RUN_ID))!;
    expect(runDetection.supportingEventIds).toEqual([run._id]);
  });

  it('labels an old numeric activity by its name', () => {
    const [d] = detectWorkoutHabit(baseCtx({ events: [workout('37')], habits: [habit()] }));
    expect(d!.evidence[0]!.label).toBe('Running, 32 min, from Apple Health');
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `pnpm --filter @synitheia/api exec vitest run src/context/detectors/workoutHabit.test.ts`
Expected: FAIL — cannot find module `./workoutHabit.js`.

- [ ] **Step 7: Implement `workoutHabit.ts`**

```ts
import { activityName, matchWorkout } from './workoutMatch.js';
import type { Detection, Detector, EventLean } from './types.js';

const CONFIDENCE = { specific: 0.8, generic: 0.65 } as const;

/** "traditionalstrengthtraining" is not something to show a person. */
function displayActivity(raw: string): string {
  const name = activityName(raw);
  if (name.includes('strength')) return 'Strength training';
  if (/^\d+$/.test(name)) return 'Workout';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Health recorded a workout, and a habit that looks like it is not done yet.
 *
 * This asks; it does not log. Step habits are the one place Health writes directly, and
 * that is because a step count IS the measurement the habit asks for. "A run happened"
 * is only evidence that "Morning run" was done — the user decides.
 */
export const detectWorkoutHabit: Detector = (ctx) => {
  const workouts = ctx.events.filter((e) => e.type === 'workout.detected');
  if (workouts.length === 0) return [];

  const detections: Detection[] = [];

  for (const habit of ctx.habits) {
    if (habit.frequency !== 'daily' || habit.measure === 'steps') continue;
    if (habit.countToday >= habit.targetCount) continue;
    if (ctx.rejectedHabitIds.has(habit.id)) continue;

    let best: { event: EventLean; kind: 'specific' | 'generic' } | null = null;
    for (const event of workouts) {
      const activity = (event.metadata as { activity?: string }).activity ?? '';
      const kind = matchWorkout(habit.name, activity);
      if (!kind) continue;
      if (!best || (kind === 'specific' && best.kind === 'generic')) best = { event, kind };
    }
    if (!best) continue;

    const meta = best.event.metadata as { activity?: string; durationMin?: number };
    const minutes = Math.round(meta.durationMin ?? 0);

    detections.push({
      detector: `workout_habit:${habit.id}`,
      type: 'possible_habit_completion',
      confidence: CONFIDENCE[best.kind],
      title: `Mark ${habit.name} done?`,
      description: null,
      evidence: [
        {
          eventId: best.event._id.toString(),
          label: `${displayActivity(meta.activity ?? '')}, ${minutes} min, from Apple Health`,
          weight: 1,
        },
      ],
      supportingEventIds: [best.event._id],
      proposed: {
        kind: 'habit',
        habitId: habit.id,
        // A duration habit is credited the minutes; anything else, one completion.
        count: habit.measure === 'duration' ? Math.max(1, minutes) : 1,
      },
    });
  }

  return detections;
};
```

- [ ] **Step 8: Register and add the integration test**

In `run.ts` append `detectWorkoutHabit` to `DETECTORS`.

In `run.test.ts`, add imports for `HabitModel` and `InferredContextModel` if not present, and add this block at the end of the file. It proves the runner actually loads habits and rejections from Mongo, which the pure tests cannot:

```ts
describe('workout → habit, through the runner', () => {
  async function runHabit(userId: string) {
    return HabitModel.create({
      userId: new Types.ObjectId(userId),
      name: 'Morning run',
      icon: 'activity',
      color: '#7D927D',
      frequency: 'daily',
      measure: 'check',
      targetCount: 1,
    });
  }

  async function workout(userId: string) {
    return emit({
      userId,
      source: 'health',
      timestamp: at('12:00'),
      timezone: IST,
      dedupeKey: dedupeKey('health', 'workout', `${TODAY}:0`),
      metadata: { type: 'workout.detected', activity: 'running', durationMin: 32, calories: 300 },
    });
  }

  it('creates one actionable suggestion for the matching habit', async () => {
    const userId = freshUser();
    const habit = await runHabit(userId);
    await workout(userId);

    const created = await runDetectors(userId, IST, TODAY, { now: at('13:00') });

    expect(created).toEqual([
      expect.objectContaining({
        type: 'possible_habit_completion',
        title: 'Mark Morning run done?',
        actionable: true,
      }),
    ]);
    const stored = await InferredContextModel.findOne({ userId }).lean();
    expect(stored!.proposed).toEqual({ kind: 'habit', habitId: habit._id.toString(), count: 1 });
  });

  it('stays silent on later days once the user has rejected it for that habit', async () => {
    const userId = freshUser();
    const habit = await runHabit(userId);

    // Yesterday's suggestion, rejected.
    await InferredContextModel.create({
      userId: new Types.ObjectId(userId),
      type: 'possible_habit_completion',
      confidence: 0.8,
      detector: `workout_habit:${habit._id.toString()}`,
      title: 'Mark Morning run done?',
      proposed: { kind: 'habit', habitId: habit._id.toString(), count: 1 },
      status: 'rejected',
      localDate: '2026-07-11',
      expiresAt: at('12:00'),
      resolvedAt: at('12:00', '2026-07-11'),
    });

    await workout(userId);

    expect(await runDetectors(userId, IST, TODAY, { now: at('13:00') })).toEqual([]);
  });
});
```

- [ ] **Step 9: Run and commit**

Run: `pnpm --filter @synitheia/api exec vitest run src/context/detectors`
Expected: PASS.

```bash
pnpm check
git add apps/api/src/context/detectors
git commit -m "feat(api): workout → habit suggestion, matched by habit name"
```

---

### Task 7: Confirming a habit suggestion

**Files:**
- Create: `apps/api/src/modules/inference/service.ts`
- Test: `apps/api/src/modules/inference/service.test.ts`
- Modify: `apps/api/src/modules/habits/service.ts` (`logHabit` gains a `source` parameter)
- Modify: `apps/api/src/modules/inference/routes.ts` (habit branch)

**Interfaces:**
- Consumes: `logHabit(user, habitId, input, logger?)` (existing)
- Produces:
  - `logHabit(user, habitId, input, logger?, source: 'manual' | 'inferred' = 'manual')`
  - `confirmHabitSuggestion(user: AuthedUser, suggestion: { localDate: LocalDate; proposed: { habitId: string; count: number } }, logger?): Promise<{ logged: boolean; reason?: 'already_complete' | 'habit_gone' }>`

- [ ] **Step 1: Write the failing test**

`apps/api/src/modules/inference/service.test.ts`:

```ts
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { todayLocalDate } from '@synitheia/shared';
import { HabitLogModel, HabitModel, PersonalEventModel, UserModel } from '../../db/models.js';
import { confirmHabitSuggestion } from './service.js';

let mongo: MongoMemoryReplSet;
const IST = 'Asia/Kolkata';
const TODAY = todayLocalDate(IST);

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    HabitModel.syncIndexes(),
    HabitLogModel.syncIndexes(),
    PersonalEventModel.syncIndexes(),
  ]);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await Promise.all([
    HabitModel.deleteMany({}),
    HabitLogModel.deleteMany({}),
    PersonalEventModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);
});

async function setup(habit: { measure?: string; targetCount?: number } = {}) {
  // grantAwards needs a real User document, or it logs an error for XP it cannot apply.
  const userDoc = await UserModel.create({
    email: `${new Types.ObjectId().toString()}@example.com`,
    name: 'Test',
    timezone: IST,
    currency: 'INR',
  });
  const user = { id: userDoc._id.toString(), timezone: IST, currency: 'INR' };
  const doc = await HabitModel.create({
    userId: userDoc._id,
    name: 'Morning run',
    icon: 'activity',
    color: '#7D927D',
    frequency: 'daily',
    measure: habit.measure ?? 'check',
    targetCount: habit.targetCount ?? 1,
  });
  return { user, habitId: doc._id.toString() };
}

describe('confirmHabitSuggestion', () => {
  it('logs the habit, marked as inferred', async () => {
    const { user, habitId } = await setup();

    const result = await confirmHabitSuggestion(user, {
      localDate: TODAY,
      proposed: { habitId, count: 1 },
    });

    expect(result).toEqual({ logged: true });
    const log = await HabitLogModel.findOne({ habitId: new Types.ObjectId(habitId) }).lean();
    expect(log!.count).toBe(1);
    expect(log!.source).toBe('inferred');
    expect(log!.completedAt).toBeTruthy();
  });

  it('adds minutes to what a duration habit already has', async () => {
    const { user, habitId } = await setup({ measure: 'duration', targetCount: 60 });
    await HabitLogModel.create({
      userId: new Types.ObjectId(user.id),
      habitId: new Types.ObjectId(habitId),
      localDate: TODAY,
      count: 10,
      targetCount: 60,
    });

    await confirmHabitSuggestion(user, { localDate: TODAY, proposed: { habitId, count: 32 } });

    const log = await HabitLogModel.findOne({ habitId: new Types.ObjectId(habitId) }).lean();
    expect(log!.count).toBe(42);
  });

  it('does not log twice when the habit was completed in the meantime', async () => {
    const { user, habitId } = await setup();
    await HabitLogModel.create({
      userId: new Types.ObjectId(user.id),
      habitId: new Types.ObjectId(habitId),
      localDate: TODAY,
      count: 1,
      targetCount: 1,
      completedAt: new Date(),
    });

    const result = await confirmHabitSuggestion(user, {
      localDate: TODAY,
      proposed: { habitId, count: 1 },
    });

    expect(result).toEqual({ logged: false, reason: 'already_complete' });
    const log = await HabitLogModel.findOne({ habitId: new Types.ObjectId(habitId) }).lean();
    expect(log!.count).toBe(1);
    expect(log!.source).toBe('manual');
  });

  it('resolves quietly when the habit has been archived', async () => {
    const { user, habitId } = await setup();
    await HabitModel.updateOne({ _id: habitId }, { $set: { archivedAt: new Date() } });

    const result = await confirmHabitSuggestion(user, {
      localDate: TODAY,
      proposed: { habitId, count: 1 },
    });

    expect(result).toEqual({ logged: false, reason: 'habit_gone' });
    expect(await HabitLogModel.countDocuments({})).toBe(0);
  });

  it("cannot log another user's habit", async () => {
    const { habitId } = await setup();
    const { user: stranger } = await setup();

    const result = await confirmHabitSuggestion(stranger, {
      localDate: TODAY,
      proposed: { habitId, count: 1 },
    });

    expect(result).toEqual({ logged: false, reason: 'habit_gone' });
    expect(await HabitLogModel.countDocuments({})).toBe(0);
  });
});
```

If `UserModel.create` rejects for a missing required field, read the `userSchema` in `apps/api/src/db/models.ts` (near line 20) and add the fields it requires. Do not weaken the test.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @synitheia/api exec vitest run src/modules/inference/service.test.ts`
Expected: FAIL — cannot find module `./service.js`.

- [ ] **Step 3: Give `logHabit` a source**

In `apps/api/src/modules/habits/service.ts`, add a fifth parameter to `logHabit` after `logger`:

```ts
  logger?: Pick<FastifyBaseLogger, 'warn'>,
  /**
   * `'inferred'` when a confirmed suggestion is doing the logging. Recorded on the log
   * forever, so the app can always say what the user entered and what it proposed.
   */
  source: 'manual' | 'inferred' = 'manual',
): Promise<{ log: HabitLogDoc; habit: HabitHydrated }> {
```

and in the upsert's `$set`, replace `source: 'manual',` with `source,`. Leave the `emit` call's `source: 'manual'` and its `dedupeKey` untouched: the timeline row is keyed on habit and day, and changing its source would create a second row for a habit completed by confirmation and then edited by hand.

- [ ] **Step 4: Implement `service.ts`**

```ts
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
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @synitheia/api exec vitest run src/modules/inference/service.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Wire the route**

In `apps/api/src/modules/inference/routes.ts`, import the service and `LocalDate`:

```ts
import { objectIdSchema, resolveInferenceSchema, type LocalDate } from '@synitheia/shared';
import { confirmHabitSuggestion } from './service.js';
```

and add this branch immediately after the closing brace of the `if (proposed.kind === 'food') { ... }` block, before `inference.status = 'confirmed';`:

```ts
      if (proposed.kind === 'habit') {
        created = await confirmHabitSuggestion(
          req.user,
          {
            localDate: inference.localDate as LocalDate,
            proposed: {
              habitId: String(proposed.habitId),
              count: Number(proposed.count),
            },
          },
          req.log,
        );
      }
```

- [ ] **Step 7: Commit**

```bash
pnpm check
git add apps/api/src/modules/inference apps/api/src/modules/habits/service.ts
git commit -m "feat(api): confirm a habit suggestion through logHabit, marked inferred"
```

---

### Task 8: Detect on sync, and rank Today's suggestions

**Files:**
- Create: `apps/api/src/context/detectors/afterSync.ts`
- Modify: `apps/api/src/modules/health/service.ts`, `apps/api/src/modules/calendar/service.ts`, `apps/api/src/modules/today/routes.ts`
- Test: `apps/api/src/modules/health/sync-suggestions.test.ts` (create)

**Interfaces:**
- Consumes: `runDetectors` (Task 2), `rankSuggestions`, `SyncSuggestion` (Task 1)
- Produces:
  - `detectAfterSync(user: { id: string; timezone: string; currency?: string }, logger?): Promise<SyncSuggestion[]>` — never throws
  - `health/service.sync` returns `{ days: number; stepsApplied: number; suggestions: SyncSuggestion[] }`
  - `calendar/service.sync` returns `{ events: number; added: number; suggestions: SyncSuggestion[] }`

- [ ] **Step 1: Write the failing test**

`apps/api/src/modules/health/sync-suggestions.test.ts`:

```ts
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { todayLocalDate, type SyncHealthInput } from '@synitheia/shared';
import {
  DataSourceConnectionModel,
  HabitLogModel,
  HabitModel,
  InferredContextModel,
  PersonalEventModel,
  UserPreferenceModel,
} from '../../db/models.js';
import * as calendar from '../calendar/service.js';
import * as health from './service.js';

let mongo: MongoMemoryReplSet;
const IST = 'Asia/Kolkata';

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    PersonalEventModel.syncIndexes(),
    InferredContextModel.syncIndexes(),
    HabitModel.syncIndexes(),
    HabitLogModel.syncIndexes(),
  ]);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await Promise.all([
    PersonalEventModel.deleteMany({}),
    InferredContextModel.deleteMany({}),
    HabitModel.deleteMany({}),
    HabitLogModel.deleteMany({}),
    DataSourceConnectionModel.deleteMany({}),
    UserPreferenceModel.deleteMany({}),
  ]);
});

async function connectedUser(source: 'health' | 'calendar') {
  const user = { id: new Types.ObjectId().toString(), timezone: IST, currency: 'INR' };
  await DataSourceConnectionModel.create({
    userId: new Types.ObjectId(user.id),
    source,
    status: 'connected',
  });
  return user;
}

function dayWithRun(): SyncHealthInput {
  return {
    days: [
      {
        localDate: todayLocalDate(IST),
        steps: null,
        activeEnergyKcal: null,
        exerciseMinutes: null,
        sleepMinutes: null,
        sleepStart: null,
        sleepEnd: null,
        restingHeartRate: null,
        workouts: [{ kind: 'running', minutes: 32, energyKcal: 300 }],
      },
    ],
  };
}

describe('health sync → suggestions', () => {
  it('returns the suggestion a synced workout creates', async () => {
    const user = await connectedUser('health');
    await HabitModel.create({
      userId: new Types.ObjectId(user.id),
      name: 'Morning run',
      icon: 'activity',
      color: '#7D927D',
      frequency: 'daily',
      measure: 'check',
      targetCount: 1,
    });

    const result = await health.sync(user, dayWithRun());

    expect(result.suggestions).toEqual([
      expect.objectContaining({
        type: 'possible_habit_completion',
        title: 'Mark Morning run done?',
        actionable: true,
      }),
    ]);
  });

  it('returns nothing the second time the same data is synced', async () => {
    const user = await connectedUser('health');
    await HabitModel.create({
      userId: new Types.ObjectId(user.id),
      name: 'Morning run',
      icon: 'activity',
      color: '#7D927D',
      frequency: 'daily',
      measure: 'check',
      targetCount: 1,
    });

    await health.sync(user, dayWithRun());
    const second = await health.sync(user, dayWithRun());

    expect(second.suggestions).toEqual([]);
    expect(await InferredContextModel.countDocuments({})).toBe(1);
  });

  it('returns an empty list, not an error, when nothing is worth suggesting', async () => {
    const user = await connectedUser('health');
    const result = await health.sync(user, dayWithRun());
    expect(result.suggestions).toEqual([]);
    expect(result.days).toBe(1);
  });
});

describe('calendar sync → suggestions', () => {
  it('carries a suggestions list on its response', async () => {
    const user = await connectedUser('calendar');
    const result = await calendar.sync(user, { events: [] });
    expect(result).toEqual({ events: 0, added: 0, suggestions: [] });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @synitheia/api exec vitest run src/modules/health/sync-suggestions.test.ts`
Expected: FAIL — `result.suggestions` is `undefined`.

- [ ] **Step 3: Create `afterSync.ts`**

```ts
import type { FastifyBaseLogger } from 'fastify';
import { todayLocalDate, type SyncSuggestion } from '@synitheia/shared';
import { runDetectors } from './run.js';

/**
 * Run detectors because data just arrived, and say what that produced.
 *
 * Never throws. A sync that stored the user's steps must not report failure because a
 * rule that reads them had a bug — the client would retry a write that already worked.
 */
export async function detectAfterSync(
  user: { id: string; timezone: string; currency?: string },
  logger?: Pick<FastifyBaseLogger, 'warn'>,
): Promise<SyncSuggestion[]> {
  try {
    return await runDetectors(user.id, user.timezone, todayLocalDate(user.timezone), {
      currency: user.currency ?? null,
    });
  } catch (err: unknown) {
    logger?.warn({ err }, 'detectors failed after sync; returning no suggestions');
    return [];
  }
}
```

- [ ] **Step 4: Call it from both services**

`apps/api/src/modules/health/service.ts`:
- add `currency?: string;` to the local `AuthedUser` interface
- import `detectAfterSync` from `'../../context/detectors/afterSync.js'` and `type SyncSuggestion` from `@synitheia/shared`
- change `sync`'s return type to `Promise<{ days: number; stepsApplied: number; suggestions: SyncSuggestion[] }>`
- replace the final `return { days: input.days.length, stepsApplied };` with:

```ts
  // After the consent row is stamped, so a detector failure cannot leave "last synced"
  // stale for a sync that did store its data.
  const suggestions = await detectAfterSync(user, logger);

  return { days: input.days.length, stepsApplied, suggestions };
```

`apps/api/src/modules/calendar/service.ts`:
- give `sync` an optional third parameter `logger?: Pick<FastifyBaseLogger, 'warn'>` (import the type from `fastify`), and add `currency?: string` to its user type the same way
- return type becomes `Promise<{ events: number; added: number; suggestions: SyncSuggestion[] }>`
- replace the final return with:

```ts
  const suggestions = await detectAfterSync(user, logger);

  return { events: input.events.length, added, suggestions };
```

`apps/api/src/modules/calendar/routes.ts`: pass the logger — `async (req) => service.sync(req.user, req.body, req.log),`.

- [ ] **Step 5: Rank Today's suggestions and pass the currency**

In `apps/api/src/modules/today/routes.ts`:
- import `rankSuggestions` from `@synitheia/shared`
- change the detector call to pass the currency:

```ts
        await runDetectors(user.id, user.timezone, today, { currency: user.currency }).catch(
```

(keep the existing `.catch` body and its comment exactly as they are)

- in the `Promise.all`, replace the suggestion query's `.sort({ confidence: -1 }).limit(3).lean()` with a bounded fetch:

```ts
        InferredContextModel.find({
          userId: uid,
          status: 'pending',
          expiresAt: { $gt: new Date() },
        })
          // Ranked in code below. 20 is far more than six detectors can have pending.
          .limit(20)
          .lean(),
```

- where the handler builds its response (`suggestions: suggestions.map(withId)`), rank and cut first:

```ts
        // Actionable first, then confidence — see rankSuggestions.
        suggestions: rankSuggestions(
          suggestions as { confidence: number; proposed: { kind: string } }[],
        )
          .slice(0, 3)
          .map((s) => withId(s as (typeof suggestions)[number])),
```

If `suggestions` is referenced between the query and the response (line ~176), apply the same `rankSuggestions(...).slice(0, 3)` once into a `const ranked` right after the `Promise.all` and use `ranked` in both places instead.

- [ ] **Step 6: Run and commit**

Run: `pnpm --filter @synitheia/api exec vitest run`
Expected: PASS, including `src/modules/today/xp.test.ts`, which exercises the Today route.

```bash
pnpm check
git add apps/api/src
git commit -m "feat(api): run detectors when a sync lands and return what they created"
```

---

### Task 9: Mobile API client — background-readable tokens, background-safe refresh

**Files:**
- Modify: `apps/mobile/src/api/client.ts`
- Test: `apps/mobile/src/api/client.test.ts` (create)

**Interfaces:**
- Produces:
  - `request<T>(path, options)` accepts `background?: boolean`
  - `api.post<T>(path, body?, options?: { background?: boolean })`
  - `migrateTokenAccessibility(): Promise<void>`
  - `setTokens` writes with `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`

- [ ] **Step 1: Write the failing test**

`apps/mobile/src/api/client.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const setItemAsync = vi.fn(async (key: string, value: string, _options?: unknown) => {
  store.set(key, value);
});
const getItemAsync = vi.fn(async (key: string) => store.get(key) ?? null);
const deleteItemAsync = vi.fn(async (key: string) => {
  store.delete(key);
});

vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'afterFirstUnlockThisDeviceOnly',
  setItemAsync,
  getItemAsync,
  deleteItemAsync,
}));
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { apiUrl: 'https://api.test' } } },
}));

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

const client = await import('./client.js');

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  store.clear();
  setItemAsync.mockClear();
  deleteItemAsync.mockClear();
  fetchMock.mockReset();
});

describe('token storage', () => {
  it('stores tokens so a background task can read them on a locked phone', async () => {
    await client.setTokens('access', 'refresh');

    for (const call of setItemAsync.mock.calls) {
      expect(call[2]).toEqual({ keychainAccessible: 'afterFirstUnlockThisDeviceOnly' });
    }
    expect(setItemAsync).toHaveBeenCalledTimes(2);
  });

  it('rewrites existing tokens once, then never again', async () => {
    store.set('synitheia.access', 'old-access');
    store.set('synitheia.refresh', 'old-refresh');

    await client.migrateTokenAccessibility();
    expect(setItemAsync.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(['synitheia.access', 'synitheia.refresh']),
    );
    expect(store.get('synitheia.refresh')).toBe('old-refresh');

    setItemAsync.mockClear();
    await client.migrateTokenAccessibility();
    expect(setItemAsync).not.toHaveBeenCalled();
  });

  it('does nothing when there is no session to migrate', async () => {
    await client.migrateTokenAccessibility();
    expect(setItemAsync.mock.calls.some((c) => c[0] === 'synitheia.access')).toBe(false);
  });
});

describe('a refresh that fails', () => {
  beforeEach(() => {
    store.set('synitheia.access', 'stale');
    store.set('synitheia.refresh', 'expired');
    // The request 401s, then the refresh itself is refused.
    fetchMock.mockResolvedValueOnce(json(401)).mockResolvedValueOnce(json(401));
  });

  it('signs the user out in the foreground', async () => {
    const expired = vi.fn();
    client.setSessionExpiredHandler(expired);

    await expect(client.api.post('/health/sync', {})).rejects.toThrow();

    expect(store.has('synitheia.refresh')).toBe(false);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('leaves the session alone in the background', async () => {
    const expired = vi.fn();
    client.setSessionExpiredHandler(expired);

    await expect(
      client.api.post('/health/sync', {}, { background: true }),
    ).rejects.toThrow();

    // The phone is in a pocket. The next foreground request decides what happens.
    expect(store.get('synitheia.refresh')).toBe('expired');
    expect(store.get('synitheia.access')).toBe('stale');
    expect(expired).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @synitheia/mobile exec vitest run src/api/client.test.ts`
Expected: FAIL — `migrateTokenAccessibility` is not a function, and the options assertion fails.

If the file fails at import instead (something else `client.ts` imports needs mocking), add a `vi.mock` factory for that module too. Do not change `client.ts` to make it importable.

- [ ] **Step 3: Implement**

In `apps/mobile/src/api/client.ts`:

Below the `REFRESH_KEY` constant:

```ts
const MIGRATED_KEY = 'synitheia.tokens.v2';

/**
 * Readable after the first unlock since boot, on this device only.
 *
 * The default (readable only while unlocked) made every background sync on a locked
 * phone fail auth. This is the narrowest class that works in the background: the tokens
 * still never leave the device and never reach iCloud Keychain.
 */
const TOKEN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};
```

Replace `setTokens`:

```ts
export async function setTokens(access: string, refresh: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_KEY, access, TOKEN_OPTIONS),
    SecureStore.setItemAsync(REFRESH_KEY, refresh, TOKEN_OPTIONS),
  ]);
}

/**
 * Re-store tokens written before TOKEN_OPTIONS existed. Runs once, from the foreground,
 * where the old items are still readable.
 */
export async function migrateTokenAccessibility(): Promise<void> {
  if ((await SecureStore.getItemAsync(MIGRATED_KEY)) !== null) return;

  const [access, refresh] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_KEY),
    SecureStore.getItemAsync(REFRESH_KEY),
  ]);
  if (access !== null && refresh !== null) await setTokens(access, refresh);

  await SecureStore.setItemAsync(MIGRATED_KEY, '1', TOKEN_OPTIONS);
}
```

Change `refreshAccessToken` to take a flag, and guard the sign-out:

```ts
async function refreshAccessToken(preserveSession = false): Promise<string | null> {
```

```ts
      if (!res.ok) {
        // A background task must never sign the user out: they are not looking, and the
        // next foreground request will find the same dead token and handle it properly.
        if (!preserveSession) {
          await clearTokens();
          onSessionExpired?.();
        }
        return null;
      }
```

Add to `RequestOptions`:

```ts
  /** Set by background sync. A failed refresh then leaves the stored session untouched. */
  background?: boolean;
```

In `request`, destructure it out so it never reaches `fetch` (`const { body, _retried, headers, background, ...rest } = options;`), and wherever `request` calls `refreshAccessToken()` and retries, pass it through: `refreshAccessToken(background === true)` and `request<T>(path, { ...options, _retried: true })` (the spread already carries `background`).

Change `api.post`:

```ts
  post: <T>(path: string, body?: unknown, options?: { background?: boolean }) =>
    request<T>(path, { method: 'POST', body, ...options }),
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @synitheia/mobile exec vitest run src/api/client.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
pnpm check
git add apps/mobile/src/api
git commit -m "feat(mobile): tokens readable in the background; background refresh never signs out"
```

---

### Task 10: Mobile pure modules — prefs, registration rule, notification policy

**Files:**
- Create: `apps/mobile/src/sync/sourcePrefs.ts`, `registration.ts`, `notifyPolicy.ts`
- Test: `apps/mobile/src/sync/sourcePrefs.test.ts`, `registration.test.ts`, `notifyPolicy.test.ts`

**Interfaces:**
- Consumes: `SyncSuggestion`, `toLocalDate`, `localMinutesOfDay` from `@synitheia/shared`
- Produces:
  - `interface SourcePrefs { health: boolean; calendar: boolean; background: boolean }`, `DEFAULT_PREFS`, `readSourcePrefs(): Promise<SourcePrefs>`, `writeSourcePrefs(patch: Partial<SourcePrefs>): Promise<SourcePrefs>`, `clearSourcePrefs(): Promise<void>`
  - `shouldRegister(input: { signedIn: boolean; prefs: SourcePrefs }): boolean`
  - `interface NotifyState { localDate: string; count: number; notifiedIds: string[] }`, `selectNotifiable(suggestions: readonly SyncSuggestion[], state: NotifyState | null, now: Date, timeZone: string): { toNotify: SyncSuggestion[]; nextState: NotifyState }`, `parseNotifyState(raw: string | null): NotifyState | null`

- [ ] **Step 1: Write the failing tests**

`registration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { shouldRegister } from './registration.js';

const prefs = (p: Partial<{ health: boolean; calendar: boolean; background: boolean }>) => ({
  health: false,
  calendar: false,
  background: true,
  ...p,
});

describe('shouldRegister', () => {
  it('registers when signed in with a connected source and the switch on', () => {
    expect(shouldRegister({ signedIn: true, prefs: prefs({ health: true }) })).toBe(true);
    expect(shouldRegister({ signedIn: true, prefs: prefs({ calendar: true }) })).toBe(true);
  });

  it('does not register when signed out', () => {
    expect(shouldRegister({ signedIn: false, prefs: prefs({ health: true }) })).toBe(false);
  });

  it('does not register with nothing connected', () => {
    expect(shouldRegister({ signedIn: true, prefs: prefs({}) })).toBe(false);
  });

  it('does not register when the user has switched background sync off', () => {
    expect(
      shouldRegister({ signedIn: true, prefs: prefs({ health: true, background: false }) }),
    ).toBe(false);
  });
});
```

`notifyPolicy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { SyncSuggestion } from '@synitheia/shared';
import { parseNotifyState, selectNotifiable } from './notifyPolicy.js';

const IST = 'Asia/Kolkata';
/** `HH:mm` IST on 2026-07-12. */
const at = (time: string, day = '2026-07-12'): Date => {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return new Date(Date.parse(`${day}T00:00:00Z`) + (h * 60 + m - 330) * 60_000);
};

const s = (id: string, actionable = true): SyncSuggestion => ({
  id,
  type: actionable ? 'possible_habit_completion' : 'unusual_spending',
  title: `Suggestion ${id}`,
  actionable,
});

describe('selectNotifiable', () => {
  it('notifies an actionable suggestion in the daytime', () => {
    const { toNotify, nextState } = selectNotifiable([s('a')], null, at('14:00'), IST);
    expect(toNotify.map((x) => x.id)).toEqual(['a']);
    expect(nextState).toEqual({ localDate: '2026-07-12', count: 1, notifiedIds: ['a'] });
  });

  it('never notifies an observation', () => {
    const { toNotify } = selectNotifiable([s('a', false)], null, at('14:00'), IST);
    expect(toNotify).toEqual([]);
  });

  it('never notifies the same suggestion twice', () => {
    const state = { localDate: '2026-07-12', count: 1, notifiedIds: ['a'] };
    const { toNotify, nextState } = selectNotifiable([s('a')], state, at('15:00'), IST);
    expect(toNotify).toEqual([]);
    expect(nextState).toEqual(state);
  });

  it('stops at two a day', () => {
    const { toNotify, nextState } = selectNotifiable(
      [s('a'), s('b'), s('c')],
      null,
      at('14:00'),
      IST,
    );
    expect(toNotify.map((x) => x.id)).toEqual(['a', 'b']);
    expect(nextState.count).toBe(2);

    const later = selectNotifiable([s('d')], nextState, at('16:00'), IST);
    expect(later.toNotify).toEqual([]);
  });

  it('starts a fresh count on a new local day', () => {
    const state = { localDate: '2026-07-11', count: 2, notifiedIds: ['x', 'y'] };
    const { toNotify, nextState } = selectNotifiable([s('a')], state, at('09:00'), IST);
    expect(toNotify.map((x) => x.id)).toEqual(['a']);
    expect(nextState.localDate).toBe('2026-07-12');
    expect(nextState.count).toBe(1);
    // Yesterday's ids are kept so a re-delivered suggestion still cannot repeat.
    expect(nextState.notifiedIds).toEqual(['x', 'y', 'a']);
  });

  it.each(['22:00', '23:30', '00:15', '06:59'])('stays quiet at %s', (time) => {
    expect(selectNotifiable([s('a')], null, at(time), IST).toNotify).toEqual([]);
  });

  it.each(['07:00', '21:59'])('may notify at %s', (time) => {
    expect(selectNotifiable([s('a')], null, at(time), IST).toNotify).toHaveLength(1);
  });

  it("uses the user's zone, not UTC, for the day and the quiet hours", () => {
    // 01:00 UTC on the 12th is 06:30 IST: still quiet, and already the 12th locally.
    const now = new Date('2026-07-12T01:00:00Z');
    const { toNotify, nextState } = selectNotifiable([s('a')], null, now, IST);
    expect(toNotify).toEqual([]);
    expect(nextState.localDate).toBe('2026-07-12');
  });

  it('keeps the remembered ids bounded', () => {
    const ids = Array.from({ length: 60 }, (_, i) => `old-${i}`);
    const state = { localDate: '2026-07-11', count: 0, notifiedIds: ids };
    const { nextState } = selectNotifiable([s('new')], state, at('09:00'), IST);
    expect(nextState.notifiedIds).toHaveLength(50);
    expect(nextState.notifiedIds.at(-1)).toBe('new');
  });
});

describe('parseNotifyState', () => {
  it('reads back what was stored', () => {
    const state = { localDate: '2026-07-12', count: 1, notifiedIds: ['a'] };
    expect(parseNotifyState(JSON.stringify(state))).toEqual(state);
  });

  it.each([null, '', 'not json', '{"count":"two"}', '[]', '{"localDate":5}'])(
    'treats %j as no state rather than throwing',
    (raw) => {
      expect(parseNotifyState(raw)).toBeNull();
    },
  );
});
```

`sourcePrefs.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getItem = vi.fn<(key: string) => Promise<string | null>>();
const setItem = vi.fn<(key: string, value: string) => Promise<void>>();
const removeItem = vi.fn<(key: string) => Promise<void>>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem, setItem, removeItem },
}));

const { DEFAULT_PREFS, clearSourcePrefs, readSourcePrefs, writeSourcePrefs } = await import(
  './sourcePrefs.js'
);

beforeEach(() => {
  getItem.mockReset().mockResolvedValue(null);
  setItem.mockReset().mockResolvedValue(undefined);
  removeItem.mockReset().mockResolvedValue(undefined);
});

describe('sourcePrefs', () => {
  it('defaults to nothing connected and the background switch on', async () => {
    expect(await readSourcePrefs()).toEqual({ health: false, calendar: false, background: true });
    expect(DEFAULT_PREFS.background).toBe(true);
  });

  it('merges a patch into what is stored and returns the result', async () => {
    getItem.mockResolvedValue(JSON.stringify({ health: true, calendar: false, background: true }));

    const next = await writeSourcePrefs({ calendar: true });

    expect(next).toEqual({ health: true, calendar: true, background: true });
    expect(setItem).toHaveBeenCalledWith('synitheia.sync-prefs', JSON.stringify(next));
  });

  it.each(['not json', '[]', '{"health":"yes"}', '42'])(
    'falls back to defaults when storage holds %j',
    async (raw) => {
      getItem.mockResolvedValue(raw);
      expect(await readSourcePrefs()).toEqual(DEFAULT_PREFS);
    },
  );

  it('falls back to defaults when storage throws', async () => {
    getItem.mockRejectedValue(new Error('storage unavailable'));
    expect(await readSourcePrefs()).toEqual(DEFAULT_PREFS);
  });

  it('does not reject when a write fails', async () => {
    setItem.mockRejectedValue(new Error('disk full'));
    await expect(writeSourcePrefs({ health: true })).resolves.toEqual({
      health: true,
      calendar: false,
      background: true,
    });
  });

  it('clears on sign-out', async () => {
    await clearSourcePrefs();
    expect(removeItem).toHaveBeenCalledWith('synitheia.sync-prefs');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @synitheia/mobile exec vitest run src/sync`
Expected: FAIL — the three modules do not exist.

- [ ] **Step 3: Implement `registration.ts`**

```ts
import type { SourcePrefs } from './sourcePrefs.js';

/**
 * Whether the background task should exist at all.
 *
 * Unregistering when there is nothing to do matters: a registered task that wakes to do
 * nothing still spends the OS's limited background budget, and the OS responds by waking
 * the app less often when there IS something to do.
 */
export function shouldRegister(input: { signedIn: boolean; prefs: SourcePrefs }): boolean {
  const { signedIn, prefs } = input;
  return signedIn && prefs.background && (prefs.health || prefs.calendar);
}
```

- [ ] **Step 4: Implement `sourcePrefs.ts`**

```ts
/**
 * A local mirror of which sources are connected, plus the background switch.
 *
 * The server is the authority on consent and re-checks it on every sync. This mirror
 * exists so the background task does not even READ the OS's health or calendar data for
 * a source the user has switched off — it has no network-free way to ask the server.
 *
 * AsyncStorage is imported lazily for the same reason ThemeProvider does it: the module
 * checks for `window` at import time and throws under Node.
 */

export interface SourcePrefs {
  health: boolean;
  calendar: boolean;
  /** "Sync in the background" on Connected Context. On until the user turns it off. */
  background: boolean;
}

export const DEFAULT_PREFS: SourcePrefs = { health: false, calendar: false, background: true };

const KEY = 'synitheia.sync-prefs';

async function storage() {
  const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
  return AsyncStorage;
}

function parse(raw: string | null): SourcePrefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return DEFAULT_PREFS;
    const v = value as Record<string, unknown>;
    if (
      typeof v.health !== 'boolean' ||
      typeof v.calendar !== 'boolean' ||
      typeof v.background !== 'boolean'
    ) {
      return DEFAULT_PREFS;
    }
    return { health: v.health, calendar: v.calendar, background: v.background };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Never rejects. A background task that cannot read its prefs does nothing, safely. */
export async function readSourcePrefs(): Promise<SourcePrefs> {
  try {
    return parse(await (await storage()).getItem(KEY));
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Never rejects. Returns the merged value even if persisting it failed. */
export async function writeSourcePrefs(patch: Partial<SourcePrefs>): Promise<SourcePrefs> {
  const next = { ...(await readSourcePrefs()), ...patch };
  try {
    await (await storage()).setItem(KEY, JSON.stringify(next));
  } catch {
    // The in-memory answer is still right for this call; the next foreground load of the
    // sources list writes it again.
  }
  return next;
}

export async function clearSourcePrefs(): Promise<void> {
  try {
    await (await storage()).removeItem(KEY);
  } catch {
    // Nothing useful to do; a stale mirror is corrected by the server refusing the sync.
  }
}
```

- [ ] **Step 5: Implement `notifyPolicy.ts`**

```ts
import { localMinutesOfDay, toLocalDate, type SyncSuggestion } from '@synitheia/shared';

/**
 * Which suggestions may raise a notification right now.
 *
 * Pure on purpose: the rules that decide whether the phone buzzes are exactly the ones
 * that must not be wrong, and none of them need a device to test.
 */

export const MAX_PER_DAY = 2;
const QUIET_FROM = 22 * 60;
const QUIET_UNTIL = 7 * 60;
const REMEMBERED_IDS = 50;

export interface NotifyState {
  /** The local day `count` belongs to. */
  localDate: string;
  count: number;
  notifiedIds: string[];
}

export function parseNotifyState(raw: string | null): NotifyState | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const v = value as Record<string, unknown>;
    if (
      typeof v.localDate !== 'string' ||
      typeof v.count !== 'number' ||
      !Array.isArray(v.notifiedIds) ||
      !v.notifiedIds.every((id) => typeof id === 'string')
    ) {
      return null;
    }
    return { localDate: v.localDate, count: v.count, notifiedIds: v.notifiedIds as string[] };
  } catch {
    return null;
  }
}

export function selectNotifiable(
  suggestions: readonly SyncSuggestion[],
  state: NotifyState | null,
  now: Date,
  timeZone: string,
): { toNotify: SyncSuggestion[]; nextState: NotifyState } {
  const today = toLocalDate(now, timeZone);
  const base: NotifyState = {
    localDate: today,
    // A new local day starts a new count; the ids are kept so nothing can repeat.
    count: state !== null && state.localDate === today ? state.count : 0,
    notifiedIds: state?.notifiedIds ?? [],
  };

  const minutes = localMinutesOfDay(now, timeZone);
  const quiet = minutes >= QUIET_FROM || minutes < QUIET_UNTIL;
  if (quiet) return { toNotify: [], nextState: base };

  const seen = new Set(base.notifiedIds);
  const toNotify: SyncSuggestion[] = [];

  for (const suggestion of suggestions) {
    if (base.count + toNotify.length >= MAX_PER_DAY) break;
    // An observation is something to read in Today, not something to be interrupted by.
    if (!suggestion.actionable || seen.has(suggestion.id)) continue;
    seen.add(suggestion.id);
    toNotify.push(suggestion);
  }

  return {
    toNotify,
    nextState: {
      localDate: today,
      count: base.count + toNotify.length,
      notifiedIds: [...base.notifiedIds, ...toNotify.map((s) => s.id)].slice(-REMEMBERED_IDS),
    },
  };
}
```

- [ ] **Step 6: Run them and watch them pass**

Run: `pnpm --filter @synitheia/mobile exec vitest run src/sync`
Expected: PASS.

Then run the three files 20 times in a loop to make sure none is order- or timing-dependent (a theme test in this package was flaky for exactly that reason):

```bash
for i in $(seq 1 20); do pnpm --filter @synitheia/mobile exec vitest run src/sync >/dev/null 2>&1 || echo "FAILED on run $i"; done
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
pnpm check
git add apps/mobile/src/sync
git commit -m "feat(mobile): source prefs mirror, registration rule, notification policy"
```

---

### Task 11: Sync runners, shared by the hooks

**Files:**
- Create: `apps/mobile/src/sync/runHealthSync.ts`, `runCalendarSync.ts`
- Test: `apps/mobile/src/sync/runHealthSync.test.ts`, `runCalendarSync.test.ts`
- Modify: `apps/mobile/src/health/useHealthSync.ts`, `apps/mobile/src/calendar/useCalendarSync.ts`, `apps/mobile/src/health/healthkit.ts`, `apps/mobile/app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `api.post(path, body, { background })` (Task 9); `syncResultSchema`, `SyncSuggestion` (Task 1)
- Produces:
  - `interface SyncRunResult { ok: boolean; skipped: boolean; suggestions: SyncSuggestion[] }`
  - `runHealthSync(options?: { background?: boolean }): Promise<SyncRunResult>` — never throws
  - `runCalendarSync(options?: { background?: boolean }): Promise<SyncRunResult>` — never throws
  - `useCalendarSync(enabled = false)` — now syncs on foreground when `enabled`

- [ ] **Step 1: Write the failing tests**

`runHealthSync.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const isSupported = vi.fn<() => boolean>();
const readHealth = vi.fn();
const post = vi.fn();

vi.mock('../health/healthkit.js', () => ({ isSupported, readHealth }));
vi.mock('../api/client.js', () => ({ api: { post } }));

const { runHealthSync } = await import('./runHealthSync.js');

const day = (overrides: Record<string, unknown> = {}) => ({
  localDate: '2026-07-12',
  steps: 4000,
  activeEnergyKcal: null,
  exerciseMinutes: null,
  sleepMinutes: null,
  sleepStart: null,
  sleepEnd: null,
  restingHeartRate: null,
  workouts: [],
  ...overrides,
});

beforeEach(() => {
  isSupported.mockReset().mockReturnValue(true);
  readHealth.mockReset();
  post.mockReset();
});

describe('runHealthSync', () => {
  it('posts what it read and returns the suggestions the server created', async () => {
    const payload = { days: [day()] };
    readHealth.mockResolvedValue(payload);
    post.mockResolvedValue({
      days: 1,
      stepsApplied: 0,
      suggestions: [
        { id: '6a7025c8d36b5e0013390202', type: 'possible_habit_completion', title: 'Mark Run done?', actionable: true },
      ],
    });

    const result = await runHealthSync({ background: true });

    expect(post).toHaveBeenCalledWith('/health/sync', payload, { background: true });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.suggestions).toHaveLength(1);
  });

  it('skips on a platform with no health store', async () => {
    isSupported.mockReturnValue(false);
    expect(await runHealthSync()).toEqual({ ok: true, skipped: true, suggestions: [] });
    expect(readHealth).not.toHaveBeenCalled();
  });

  it('treats an empty read as a no-op — a locked phone, not an empty week', async () => {
    readHealth.mockResolvedValue({ days: [day({ steps: null })] });
    expect(await runHealthSync()).toEqual({ ok: true, skipped: true, suggestions: [] });
    // Posting it would overwrite real numbers with nulls.
    expect(post).not.toHaveBeenCalled();
  });

  it('treats a null read as a no-op', async () => {
    readHealth.mockResolvedValue(null);
    expect(await runHealthSync()).toEqual({ ok: true, skipped: true, suggestions: [] });
  });

  it('still posts when only body metrics came back', async () => {
    readHealth.mockResolvedValue({ days: [day({ steps: null })], body: { weightKg: 70 } });
    post.mockResolvedValue({ days: 1, stepsApplied: 0 });
    expect((await runHealthSync()).skipped).toBe(false);
  });

  it('reports failure without throwing when the read fails', async () => {
    readHealth.mockRejectedValue(new Error('HealthKit unavailable'));
    expect(await runHealthSync()).toEqual({ ok: false, skipped: false, suggestions: [] });
  });

  it('reports failure without throwing when the network fails', async () => {
    readHealth.mockResolvedValue({ days: [day()] });
    post.mockRejectedValue(new Error('offline'));
    expect(await runHealthSync()).toEqual({ ok: false, skipped: false, suggestions: [] });
  });

  it('accepts a response from an API that does not send suggestions yet', async () => {
    readHealth.mockResolvedValue({ days: [day()] });
    post.mockResolvedValue({ days: 1, stepsApplied: 0 });
    expect(await runHealthSync()).toEqual({ ok: true, skipped: false, suggestions: [] });
  });

  it('ignores a malformed suggestions field rather than failing a sync that worked', async () => {
    readHealth.mockResolvedValue({ days: [day()] });
    post.mockResolvedValue({ days: 1, suggestions: 'nope' });
    expect(await runHealthSync()).toEqual({ ok: true, skipped: false, suggestions: [] });
  });
});
```

`runCalendarSync.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const isSupported = vi.fn<() => boolean>();
const readCalendar = vi.fn();
const post = vi.fn();

vi.mock('../calendar/calendar.js', () => ({ isSupported, readCalendar }));
vi.mock('../api/client.js', () => ({ api: { post } }));

const { runCalendarSync } = await import('./runCalendarSync.js');

beforeEach(() => {
  isSupported.mockReset().mockReturnValue(true);
  readCalendar.mockReset();
  post.mockReset();
});

describe('runCalendarSync', () => {
  it('posts the window it read, even when it is empty', async () => {
    // An empty calendar is a valid outcome: it is how a deleted meeting leaves the day.
    readCalendar.mockResolvedValue([]);
    post.mockResolvedValue({ events: 0, added: 0, suggestions: [] });

    const result = await runCalendarSync({ background: true });

    expect(post).toHaveBeenCalledWith('/calendar/sync', { events: [] }, { background: true });
    expect(result).toEqual({ ok: true, skipped: false, suggestions: [] });
  });

  it('skips where there is no calendar', async () => {
    isSupported.mockReturnValue(false);
    expect(await runCalendarSync()).toEqual({ ok: true, skipped: true, suggestions: [] });
  });

  it('reports failure without throwing', async () => {
    readCalendar.mockRejectedValue(new Error('permission revoked'));
    expect(await runCalendarSync()).toEqual({ ok: false, skipped: false, suggestions: [] });
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @synitheia/mobile exec vitest run src/sync/runHealthSync.test.ts src/sync/runCalendarSync.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the runners**

`runHealthSync.ts`:

```ts
import { syncResultSchema, type SyncSuggestion } from '@synitheia/shared';
import { api } from '../api/client.js';
import { isSupported, readHealth } from '../health/healthkit.js';

const WINDOW_DAYS = 7;

export interface SyncRunResult {
  /** False only when something was attempted and failed. */
  ok: boolean;
  /** True when there was nothing to send. Not a failure. */
  skipped: boolean;
  suggestions: SyncSuggestion[];
}

const SKIPPED: SyncRunResult = { ok: true, skipped: true, suggestions: [] };
const FAILED: SyncRunResult = { ok: false, skipped: false, suggestions: [] };

/**
 * One Apple Health sync. No React, no query client, never throws — the same function
 * serves the foreground hook and the background task.
 *
 * A failure is reported, not raised. Health is an assist the user did not invoke; the
 * caller decides whether a failed assist is worth telling anyone about, and the answer
 * has so far always been no.
 */
export async function runHealthSync(
  options: { background?: boolean } = {},
): Promise<SyncRunResult> {
  if (!isSupported()) return SKIPPED;

  try {
    const payload = await readHealth(WINDOW_DAYS);
    if (!payload) return SKIPPED;

    const hasAnything =
      payload.days.some(
        (d) => d.steps != null || d.activeEnergyKcal != null || d.sleepMinutes != null,
      ) || Object.keys(payload.body ?? {}).length > 0;

    // iOS never says "permission denied" for reads, and returns nothing while the phone
    // is locked. Posting an empty week would blank out real data with nulls.
    if (!hasAnything) return SKIPPED;

    const response = await api.post<unknown>('/health/sync', payload, {
      background: options.background === true,
    });

    // The sync itself succeeded. A response we cannot read costs a notification, no more.
    const parsed = syncResultSchema.safeParse(response);
    return { ok: true, skipped: false, suggestions: parsed.success ? parsed.data.suggestions : [] };
  } catch {
    return FAILED;
  }
}
```

`runCalendarSync.ts`:

```ts
import { syncResultSchema } from '@synitheia/shared';
import { api } from '../api/client.js';
import { isSupported, readCalendar } from '../calendar/calendar.js';
import type { SyncRunResult } from './runHealthSync.js';

/**
 * One calendar sync. Same contract as `runHealthSync`: no React, never throws.
 *
 * Unlike Health, an empty read IS sent. The server mirrors the whole window each time,
 * and "no events" is how a cancelled meeting stops appearing on the day.
 */
export async function runCalendarSync(
  options: { background?: boolean } = {},
): Promise<SyncRunResult> {
  if (!isSupported()) return { ok: true, skipped: true, suggestions: [] };

  try {
    const events = await readCalendar();
    const response = await api.post<unknown>(
      '/calendar/sync',
      { events },
      { background: options.background === true },
    );
    const parsed = syncResultSchema.safeParse(response);
    return { ok: true, skipped: false, suggestions: parsed.success ? parsed.data.suggestions : [] };
  } catch {
    return { ok: false, skipped: false, suggestions: [] };
  }
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm --filter @synitheia/mobile exec vitest run src/sync`
Expected: PASS.

- [ ] **Step 5: Make the hooks thin wrappers**

`apps/mobile/src/health/useHealthSync.ts` — replace the body of `sync` (keep every existing comment block above it, and keep `connectHealth` and `HealthConnectResult` untouched):

```ts
  const sync = useCallback(async () => {
    if (inFlight.current) return;

    inFlight.current = true;
    try {
      const result = await runHealthSync();
      if (!result.ok || result.skipped) return;

      // Steps may have completed a step habit, which moves the ring and the timeline.
      await queryClient.invalidateQueries({ queryKey: ['today'] });
      await queryClient.invalidateQueries({ queryKey: ['habits'] });
      await queryClient.invalidateQueries({ queryKey: ['health-body'] });
    } finally {
      inFlight.current = false;
    }
  }, [queryClient]);
```

Update its imports: remove `api`, `readHealth` and the `WINDOW_DAYS` constant; keep `isAvailable`, `isSupported`, `requestPermissions` (still used by `connectHealth`); add `import { runHealthSync } from '../sync/runHealthSync.js';`.

`apps/mobile/src/calendar/useCalendarSync.ts` — replace the hook (keep `connectCalendar` and its comment):

```ts
/**
 * Keep the device calendar and Synítheia in step.
 *
 * `enabled` gates the AUTOMATIC foreground sync only — the returned `sync()` always runs,
 * for the same reason as `useHealthSync`: Connected Context calls it by hand the instant
 * the user connects the source, before any `enabled` prop has re-rendered.
 */
export function useCalendarSync(enabled = false): { sync: () => Promise<void> } {
  const queryClient = useQueryClient();
  // Guarded against overlap so a fast double-tap on the source doesn't fire two syncs
  // that race each other's writes.
  const inFlight = useRef(false);

  const sync = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await runCalendarSync();
      if (result.ok && !result.skipped) {
        await queryClient.invalidateQueries({ queryKey: ['today'] });
      }
    } finally {
      inFlight.current = false;
    }
  }, [queryClient]);

  useEffect(() => {
    if (!enabled) return;

    void sync();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sync();
    });
    return () => subscription.remove();
  }, [enabled, sync]);

  return { sync };
}
```

Imports for that file: `import { useCallback, useEffect, useRef } from 'react';`, `import { AppState } from 'react-native';`, `import { useQueryClient } from '@tanstack/react-query';`, `import { runCalendarSync } from '../sync/runCalendarSync.js';`, and keep `isSupported`, `requestPermissions` from `./calendar.js` (drop `readCalendar` and `api`).

- [ ] **Step 6: Sync Calendar on foreground from Today**

In `apps/mobile/app/(tabs)/index.tsx`, next to `healthConnected`:

```ts
  const calendarConnected =
    healthSources.data?.items.some((s) => s.source === 'calendar' && s.status === 'connected') ??
    false;

  useHealthSync(healthConnected);
  // The same runner the background task uses. A connected calendar had no reason to be
  // stale in the foreground; it was only ever read when the source was switched on.
  useCalendarSync(calendarConnected);
```

and import `useCalendarSync` from `'../../src/calendar/useCalendarSync.js'`.

- [ ] **Step 7: Send the workout's name, not its number**

Open the installed library's type for `workoutActivityType`:

```bash
grep -rn "WorkoutActivityType" apps/mobile/node_modules/@kingstinct/react-native-healthkit/src --include="*.ts" -l | head
```

and read the enum definition in the file it names.

- If `WorkoutActivityType` is a **numeric enum** (`running = 37`, …): in `apps/mobile/src/health/healthkit.ts`, import `WorkoutActivityType` from the library and change the mapping in `readWorkouts`:

```ts
      // The enum is numeric, so `String()` of it is "37". Reverse-map to the name the
      // schema promises ("running"); the server still understands the old numbers for
      // events already stored.
      kind: WorkoutActivityType[w.workoutActivityType] ?? 'workout',
```

- If it is already a **string** union or string enum: leave `healthkit.ts` unchanged and note that in the commit message.

Either way the server-side `activityName` (Task 6) handles both forms.

- [ ] **Step 8: Commit**

```bash
pnpm check
git add apps/mobile
git commit -m "refactor(mobile): sync runners shared by hooks; calendar syncs on foreground"
```

---

### Task 12: The background task, notifications, and app wiring

**Files:**
- Create: `apps/mobile/src/sync/contextSync.ts`, `notifySuggestions.ts`, `backgroundTask.ts`, `useSourcePrefsMirror.ts`
- Test: `apps/mobile/src/sync/contextSync.test.ts`
- Modify: `apps/mobile/package.json`, `apps/mobile/app.json`, `apps/mobile/app/_layout.tsx`, `apps/mobile/app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `readSourcePrefs`, `writeSourcePrefs`, `clearSourcePrefs` (Task 10); `shouldRegister` (Task 10); `selectNotifiable`, `parseNotifyState` (Task 10); `runHealthSync`, `runCalendarSync`, `SyncRunResult` (Task 11); `hasSession`, `migrateTokenAccessibility` (Task 9)
- Produces:
  - `runContextSync(deps?: ContextSyncDeps): Promise<'skipped' | 'ok' | 'failed'>`
  - `notifySuggestions(suggestions: readonly SyncSuggestion[]): Promise<void>` — never throws
  - `CONTEXT_SYNC_TASK = 'synitheia.context-sync'`, `syncBackgroundRegistration(): Promise<void>` — never throws
  - `useSourcePrefsMirror(items: { source: string; status: string }[] | undefined): void`

- [ ] **Step 1: Install the two dependencies**

```bash
cd apps/mobile && npx expo install expo-background-task expo-task-manager && cd ../..
```

Expected: both appear in `apps/mobile/package.json` with SDK-54-compatible versions, and `pnpm-lock.yaml` changes. Then add the plugin to `apps/mobile/app.json`, in the `plugins` array after `"expo-apple-authentication"`:

```json
      "expo-background-task",
```

Read the installed package's types before writing code against it:

```bash
sed -n 1,80p apps/mobile/node_modules/expo-background-task/build/BackgroundTask.d.ts
sed -n 1,40p apps/mobile/node_modules/expo-background-task/build/BackgroundTask.types.d.ts
```

The code below uses `registerTaskAsync(name, { minimumInterval })` (minutes), `unregisterTaskAsync(name)`, and `BackgroundTaskResult.Success` / `.Failed`. If the installed version names any of these differently, use the installed names and say so in the commit message.

- [ ] **Step 2: Write the failing test for the task body**

`contextSync.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { runContextSync, type ContextSyncDeps } from './contextSync.js';

const suggestion = {
  id: '6a7025c8d36b5e0013390202',
  type: 'possible_habit_completion' as const,
  title: 'Mark Run done?',
  actionable: true,
};

function deps(overrides: Partial<ContextSyncDeps> = {}): ContextSyncDeps {
  return {
    readSourcePrefs: vi.fn(async () => ({ health: true, calendar: true, background: true })),
    hasSession: vi.fn(async () => true),
    runHealthSync: vi.fn(async () => ({ ok: true, skipped: false, suggestions: [] })),
    runCalendarSync: vi.fn(async () => ({ ok: true, skipped: false, suggestions: [] })),
    notifySuggestions: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('runContextSync', () => {
  it('runs every connected source in background mode and notifies what came back', async () => {
    const d = deps({
      runHealthSync: vi.fn(async () => ({ ok: true, skipped: false, suggestions: [suggestion] })),
    });

    expect(await runContextSync(d)).toBe('ok');

    expect(d.runHealthSync).toHaveBeenCalledWith({ background: true });
    expect(d.runCalendarSync).toHaveBeenCalledWith({ background: true });
    expect(d.notifySuggestions).toHaveBeenCalledWith([suggestion]);
  });

  it('does nothing when the user switched background sync off', async () => {
    const d = deps({
      readSourcePrefs: vi.fn(async () => ({ health: true, calendar: true, background: false })),
    });
    expect(await runContextSync(d)).toBe('skipped');
    expect(d.runHealthSync).not.toHaveBeenCalled();
    expect(d.runCalendarSync).not.toHaveBeenCalled();
  });

  it('does nothing when signed out', async () => {
    const d = deps({ hasSession: vi.fn(async () => false) });
    expect(await runContextSync(d)).toBe('skipped');
    expect(d.runHealthSync).not.toHaveBeenCalled();
  });

  it('does not read a source the user has switched off', async () => {
    const d = deps({
      readSourcePrefs: vi.fn(async () => ({ health: false, calendar: true, background: true })),
    });
    expect(await runContextSync(d)).toBe('ok');
    expect(d.runHealthSync).not.toHaveBeenCalled();
    expect(d.runCalendarSync).toHaveBeenCalledTimes(1);
  });

  it('is still ok when one source fails and the other works', async () => {
    const d = deps({
      runHealthSync: vi.fn(async () => ({ ok: false, skipped: false, suggestions: [] })),
    });
    expect(await runContextSync(d)).toBe('ok');
  });

  it('is ok when health had nothing to send — a locked phone is not a failure', async () => {
    const d = deps({
      readSourcePrefs: vi.fn(async () => ({ health: true, calendar: false, background: true })),
      runHealthSync: vi.fn(async () => ({ ok: true, skipped: true, suggestions: [] })),
    });
    expect(await runContextSync(d)).toBe('ok');
  });

  it('fails only when everything it attempted failed', async () => {
    const d = deps({
      runHealthSync: vi.fn(async () => ({ ok: false, skipped: false, suggestions: [] })),
      runCalendarSync: vi.fn(async () => ({ ok: false, skipped: false, suggestions: [] })),
    });
    expect(await runContextSync(d)).toBe('failed');
    expect(d.notifySuggestions).not.toHaveBeenCalled();
  });

  it('does not call the notifier with an empty list', async () => {
    const d = deps();
    await runContextSync(d);
    expect(d.notifySuggestions).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @synitheia/mobile exec vitest run src/sync/contextSync.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `contextSync.ts`**

The defaults are imported lazily so this file — and its test — never loads React Native or Expo modules.

```ts
import type { SyncSuggestion } from '@synitheia/shared';
import type { SyncRunResult } from './runHealthSync.js';
import type { SourcePrefs } from './sourcePrefs.js';

export interface ContextSyncDeps {
  readSourcePrefs: () => Promise<SourcePrefs>;
  hasSession: () => Promise<boolean>;
  runHealthSync: (options: { background: boolean }) => Promise<SyncRunResult>;
  runCalendarSync: (options: { background: boolean }) => Promise<SyncRunResult>;
  notifySuggestions: (suggestions: readonly SyncSuggestion[]) => Promise<void>;
}

async function defaultDeps(): Promise<ContextSyncDeps> {
  const [prefs, client, health, calendar, notify] = await Promise.all([
    import('./sourcePrefs.js'),
    import('../api/client.js'),
    import('./runHealthSync.js'),
    import('./runCalendarSync.js'),
    import('./notifySuggestions.js'),
  ]);
  return {
    readSourcePrefs: prefs.readSourcePrefs,
    hasSession: client.hasSession,
    runHealthSync: health.runHealthSync,
    runCalendarSync: calendar.runCalendarSync,
    notifySuggestions: notify.notifySuggestions,
  };
}

/**
 * The body of the background task: sync whatever is connected, then say so if it matters.
 *
 * Sources run one after the other, not in parallel. The OS gives a background task a
 * short, unspecified budget; two overlapping network calls that are both cut off are
 * worth less than one that finished.
 *
 * `'failed'` is reported only when every attempt failed. The OS backs off a task that
 * reports failure, and a locked phone that could sync its calendar but not Health has
 * not failed.
 */
export async function runContextSync(
  injected?: ContextSyncDeps,
): Promise<'skipped' | 'ok' | 'failed'> {
  const deps = injected ?? (await defaultDeps());

  const prefs = await deps.readSourcePrefs();
  if (!prefs.background || (!prefs.health && !prefs.calendar)) return 'skipped';
  if (!(await deps.hasSession())) return 'skipped';

  const results: SyncRunResult[] = [];
  if (prefs.health) results.push(await deps.runHealthSync({ background: true }));
  if (prefs.calendar) results.push(await deps.runCalendarSync({ background: true }));

  if (results.every((r) => !r.ok)) return 'failed';

  const suggestions = results.flatMap((r) => r.suggestions);
  if (suggestions.length > 0) await deps.notifySuggestions(suggestions);

  return 'ok';
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @synitheia/mobile exec vitest run src/sync/contextSync.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Implement `notifySuggestions.ts`**

```ts
import * as Notifications from 'expo-notifications';
import type { SyncSuggestion } from '@synitheia/shared';
import { parseNotifyState, selectNotifiable } from './notifyPolicy.js';

const STATE_KEY = 'synitheia.notify-state';

/** Carried on the notification so a tap can be recognised as one of ours. */
export interface SuggestionNotificationData {
  suggestionId: string;
}

async function storage() {
  const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
  return AsyncStorage;
}

/**
 * Post local notifications for the suggestions the policy allows.
 *
 * Local, not push: the phone already has the suggestion in hand, so there is no server
 * to round-trip through and no token to register.
 *
 * Never throws, and never asks for permission. A background task cannot show a permission
 * sheet, and a suggestion that fails to notify is still waiting in Today.
 */
export async function notifySuggestions(suggestions: readonly SyncSuggestion[]): Promise<void> {
  try {
    if (!(await Notifications.getPermissionsAsync()).granted) return;

    const store = await storage();
    const state = parseNotifyState(await store.getItem(STATE_KEY));
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

    const { toNotify, nextState } = selectNotifiable(suggestions, state, new Date(), timeZone);
    if (toNotify.length === 0) return;

    // State first. If the write succeeds and a notification then fails, the user misses
    // one nudge; the other order risks the same nudge twice.
    await store.setItem(STATE_KEY, JSON.stringify(nextState));

    for (const suggestion of toNotify) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: suggestion.title,
          body: 'Tap to confirm in Today.',
          data: { suggestionId: suggestion.id } satisfies SuggestionNotificationData,
        },
        // Null trigger: deliver now.
        trigger: null,
      });
    }
  } catch {
    // The suggestion is still in Today. Nothing here is worth failing a sync over.
  }
}
```

- [ ] **Step 7: Implement `backgroundTask.ts`**

```ts
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { hasSession } from '../api/client.js';
import { runContextSync } from './contextSync.js';
import { shouldRegister } from './registration.js';
import { readSourcePrefs } from './sourcePrefs.js';

export const CONTEXT_SYNC_TASK = 'synitheia.context-sync';

/** Minutes. A request, not a schedule: the OS runs it when battery and usage allow. */
const MINIMUM_INTERVAL = 30;

/**
 * Defined at module scope, and this module is imported from the root layout, because a
 * background launch starts the JS runtime without rendering any screen. A task defined
 * inside a component would not exist when the OS came looking for it.
 *
 * Best-effort by nature. iOS will not run it after a force-quit, defers it in Low Power
 * Mode, and never runs it in the Simulator.
 */
TaskManager.defineTask(CONTEXT_SYNC_TASK, async () => {
  try {
    const outcome = await runContextSync();
    return outcome === 'failed'
      ? BackgroundTask.BackgroundTaskResult.Failed
      : BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/**
 * Make the task's registration match what the user has set up. The one place that
 * registers or unregisters. Safe to call repeatedly and never throws — it is called from
 * effects that have no useful way to handle a failure.
 */
export async function syncBackgroundRegistration(): Promise<void> {
  try {
    const [prefs, signedIn, registered] = await Promise.all([
      readSourcePrefs(),
      hasSession(),
      TaskManager.isTaskRegisteredAsync(CONTEXT_SYNC_TASK),
    ]);

    const wanted = shouldRegister({ signedIn, prefs });

    if (wanted && !registered) {
      await BackgroundTask.registerTaskAsync(CONTEXT_SYNC_TASK, {
        minimumInterval: MINIMUM_INTERVAL,
      });
    } else if (!wanted && registered) {
      await BackgroundTask.unregisterTaskAsync(CONTEXT_SYNC_TASK);
    }
  } catch {
    // Background tasks can be unavailable (restricted by the OS, or the Simulator). The
    // app works without them; foreground sync is unaffected.
  }
}
```

- [ ] **Step 8: Implement `useSourcePrefsMirror.ts`**

```ts
import { useEffect } from 'react';
import { syncBackgroundRegistration } from './backgroundTask.js';
import { writeSourcePrefs } from './sourcePrefs.js';

/**
 * Keep the local prefs mirror, and the task's registration, in step with the server's
 * list of sources.
 *
 * Driven by the `/data-sources` query rather than by the toggle handler, so it also
 * covers a user who connected Health before this feature existed, and one who changed a
 * source on another device.
 */
export function useSourcePrefsMirror(
  items: { source: string; status: string }[] | undefined,
): void {
  const connected = (source: string): boolean | undefined =>
    items?.some((s) => s.source === source && s.status === 'connected');

  const health = connected('health');
  const calendar = connected('calendar');

  useEffect(() => {
    // Undefined means the list has not loaded. Writing `false` then would unregister the
    // task on every cold start until the request came back.
    if (health === undefined || calendar === undefined) return;

    void writeSourcePrefs({ health, calendar }).then(() => syncBackgroundRegistration());
  }, [health, calendar]);
}
```

- [ ] **Step 9: Wire the app**

`apps/mobile/app/_layout.tsx`:

Add imports:

```ts
import * as Notifications from 'expo-notifications';
import { migrateTokenAccessibility } from '../src/api/client.js';
// Imported for its side effect: this is what defines the background task.
import { syncBackgroundRegistration } from '../src/sync/backgroundTask.js';
import { clearSourcePrefs } from '../src/sync/sourcePrefs.js';
```

In `AuthGate`, change the first effect so tokens are migrated before anything reads them:

```ts
  useEffect(() => {
    init();
    // Before hydrate: tokens stored by an older build must be re-stored where a
    // background task can read them, and hydrate is the first thing that reads them.
    void migrateTokenAccessibility().finally(() => void hydrate());
  }, [hydrate, init]);
```

Add two effects to `AuthGate`, after the routing effect:

```ts
  useEffect(() => {
    if (status === 'loading') return;

    // Signed out: the mirror must not outlive the session, or the next account on this
    // phone would inherit the last one's "connected" sources.
    const settle = status === 'anon' ? clearSourcePrefs() : Promise.resolve();
    void settle.then(() => syncBackgroundRegistration());
  }, [status]);

  useEffect(() => {
    // A tap on a suggestion notification lands on Today, where its card already is.
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as
        | { suggestionId?: unknown }
        | undefined;
      if (typeof data?.suggestionId === 'string') router.replace('/');
    });
    return () => subscription.remove();
  }, [router]);
```

`apps/mobile/app/(tabs)/index.tsx`: after the `healthSources` query, add

```ts
  useSourcePrefsMirror(healthSources.data?.items);
```

and import it from `'../../src/sync/useSourcePrefsMirror.js'`.

- [ ] **Step 10: Check and commit**

```bash
pnpm install
pnpm check
git add apps/mobile pnpm-lock.yaml
git commit -m "feat(mobile): background context sync task with suggestion notifications"
```

Expected: `pnpm check` passes. Typecheck is the meaningful gate for `backgroundTask.ts` and `notifySuggestions.ts`, which have no unit tests because they are thin calls into native modules.

---

### Task 13: The "Sync in the background" switch

**Files:**
- Modify: `apps/mobile/app/privacy.tsx`

**Interfaces:**
- Consumes: `readSourcePrefs`, `writeSourcePrefs` (Task 10); `syncBackgroundRegistration` (Task 12); `useSourcePrefsMirror` (Task 12)

- [ ] **Step 1: Read the screen first**

Read `apps/mobile/app/privacy.tsx` in full. Note the names it already uses: the `sources` query, the `t` theme object, `Text` variants, the `Switch` props on the "Collect this data" row (around line 540), and the `styles.consents` / `styles.consentRow` / `styles.consentCopy` entries. The new row reuses those exactly; it introduces no new visual pattern.

- [ ] **Step 2: Add state and the mirror**

Inside the screen component, after the `updateSource` mutation:

```tsx
  // Connecting a source here must reach the background task without a trip via Today.
  useSourcePrefsMirror(sources.data?.items);

  const [backgroundSync, setBackgroundSync] = useState(true);

  useEffect(() => {
    void readSourcePrefs().then((prefs) => setBackgroundSync(prefs.background));
  }, []);

  const onBackgroundSyncChange = (value: boolean) => {
    // Optimistic: this is a local preference, and the write cannot meaningfully fail.
    setBackgroundSync(value);
    void writeSourcePrefs({ background: value }).then(() => syncBackgroundRegistration());
  };

  const backgroundSources = (sources.data?.items ?? []).filter(
    (s) => (s.source === 'health' || s.source === 'calendar') && s.status === 'connected',
  );
```

Add the imports (`useEffect`, `useState` from `react` if not already imported; `Platform` is already imported):

```tsx
import { syncBackgroundRegistration } from '../src/sync/backgroundTask.js';
import { readSourcePrefs, writeSourcePrefs } from '../src/sync/sourcePrefs.js';
import { useSourcePrefsMirror } from '../src/sync/useSourcePrefsMirror.js';
```

If `sources.data.items` has a different shape from `{ source: string; status: string }[]`, adapt the two expressions to it; do not change the query.

- [ ] **Step 3: Render the row**

Immediately after the block that renders the list of source cards, and before the next section:

```tsx
        {/* Only when there is something it would sync. A switch for a task that cannot
            run is the same non-choice as a switch on an unavailable source. */}
        {backgroundSources.length > 0 ? (
          <View style={styles.consents}>
            <View style={styles.consentRow}>
              <View style={styles.consentCopy}>
                <Text variant="bodyMedium" color={t.textPrimary}>
                  Sync in the background
                </Text>
                <Text variant="caption" color={t.textFaint}>
                  {Platform.OS === 'ios'
                    ? 'Keeps Health and Calendar up to date when your phone allows it. This is best-effort: iOS decides when it runs, and it stops if you force-quit the app.'
                    : 'Keeps Calendar up to date when your phone allows it. This is best-effort: Android decides when it runs.'}
                </Text>
              </View>

              <Switch
                value={backgroundSync}
                onValueChange={onBackgroundSyncChange}
                accessibilityLabel="Sync in the background"
                trackColor={{ false: t.border, true: t.accent }}
              />
            </View>
          </View>
        ) : null}
```

Copy any further `Switch` props the existing "Collect this data" switch passes (`thumbColor`, `ios_backgroundColor`) so the two look identical.

- [ ] **Step 4: Check and commit**

```bash
pnpm check
git add apps/mobile/app/privacy.tsx
git commit -m "feat(mobile): background sync switch on Connected Context"
```

---

### Task 14: Documentation and verification

**Files:**
- Modify: `ARCHITECTURE.md`

- [ ] **Step 1: Update the feasibility matrix and phase table**

In `ARCHITECTURE.md`:

- In the passive-data feasibility matrix, update the **Background app execution** row: it is now implemented with `expo-background-task` (BGTaskScheduler on iOS, WorkManager on Android), minimum interval 15 minutes, OS-scheduled, best-effort, does not run after an iOS force-quit or in the Simulator.
- In the **Health data** and **Calendar** rows, change the background-support cell to: synced by the background task; Health reads return nothing while the device is locked.
- In the phase table, Phase 9 (Passive integrations): mark Health and Calendar background sync as done, Weather and Location as foreground-only.
- Phase 10 (Aggregation & inference): list the detectors as `possible_meal`, `low_water`, `unusual_spending`, `possible_habit_completion` (workout → habit), `low_activity`, `missed_habit` (habit slipping), and note that detectors now also run when a sync lands.
- In **Known gaps**, replace the line saying passive collectors are unimplemented with: background wake-up is verified manually on a device and cannot be covered by CI.

Keep the document's existing table formatting and tone.

- [ ] **Step 2: Full check**

```bash
pnpm check
```

Expected: typecheck, lint and all tests pass in `shared`, `api` and `mobile`.

- [ ] **Step 3: Commit**

```bash
git add ARCHITECTURE.md
git commit -m "docs: background sync and the four new detectors"
```

- [ ] **Step 4: Confirm the native modules link**

Push the branch and run both platform builds on it:

```bash
git push -u origin feature/background-sync-detectors
gh workflow run ios.yml --ref feature/background-sync-detectors
gh workflow run android.yml --ref feature/background-sync-detectors
```

Expected: both succeed. A build failure in prebuild, pods or Gradle here most likely means `expo-background-task` or `expo-task-manager` did not link; fix that before anything else. Third-party native modules have failed to link under the New Architecture in this repo before.

- [ ] **Step 5: Manual device verification (cannot be automated)**

This step needs a physical iPhone or Android phone with a dev build, and a person. Do not report the feature as working until it has been done; report it as "built and unit-tested, background wake-up unverified" otherwise.

1. Install a dev build. Sign in. Connect Calendar (and Health on an iPhone signed with a paid developer account).
2. On Connected Context, confirm the "Sync in the background" switch appears and is on.
3. Trigger the task. In a dev build, from a temporary button or the JS console: `await BackgroundTask.triggerTaskWorkerForTestingAsync()`. On iOS, alternatively pause in Xcode and run `e -l objc -- (void)[[BGTaskScheduler sharedScheduler] _simulateLaunchForTaskWithIdentifier:@"com.expo.modules.backgroundtask.processing"]` (use the identifier the plugin wrote to `BGTaskSchedulerPermittedIdentifiers` in the generated Info.plist).
4. Confirm on Connected Context that Calendar's "last synced" time moved.
5. Add a habit named "Morning run". Record a short running workout in Apple Health. Trigger the task again between 07:00 and 22:00 with notifications allowed. Expect one notification, "Mark Morning run done?". Tap it: the app opens on Today with the card. Confirm it: the habit is done.
6. Trigger the task again. Expect no second notification.
7. Lock the phone, trigger the task via Xcode. Expect Calendar to sync and no crash; Health is skipped.
8. Turn the switch off. Trigger again. Expect nothing to sync.
9. Sign out. Confirm in the Xcode console (or `TaskManager.isTaskRegisteredAsync`) that the task is unregistered.
10. **Upgrade path.** Install a build from `main` (before this branch), sign in, then install this build over it without signing out. Open the app once, lock the phone, and trigger the task from Xcode. Expect Calendar to sync: this proves the token migration really moved the tokens to the background-readable class.
11. **Background launch.** Force the task to run from a terminated state (Xcode simulated launch after stopping the app). In the console, check whether the React tree mounts. Either way, expect to still be signed in when the app is next opened.
12. Leave the phone alone overnight with the app backgrounded, not force-quit. In the morning, check whether "last synced" advanced without opening Today first. This is the only test of real OS scheduling; record the result either way.

---

## Spec coverage

| Spec section | Task |
|---|---|
| Platform feasibility table | Task 14 (ARCHITECTURE.md) |
| Dependencies | Task 12 |
| Sync runners; hooks as wrappers; Calendar on foreground | Task 11 |
| The task (steps, failure rule) | Task 12 (`contextSync.ts`, `backgroundTask.ts`) |
| Registration rule and call sites | Tasks 10, 12 |
| Consent mirror | Tasks 10, 12 (`useSourcePrefsMirror`) |
| Token storage and migration | Task 9 |
| Connected Context switch and copy | Task 13 |
| Sync routes return created suggestions | Task 8 |
| Detector file structure, `now` injected, 56-day history | Task 2 |
| Idempotency via detector name | Tasks 5, 6 |
| Today ordering | Tasks 1, 8 |
| Unusual spending | Task 3 |
| Workout → habit, matching, rejection, confirm | Tasks 6, 7 |
| Low activity (+ new type) | Tasks 1, 4 |
| Habit slipping | Task 5 |
| Notifications policy and posting | Tasks 10, 12 |
| Error-handling table | Tasks 8, 9, 11, 12 |
| Manual device check | Task 14 |

Deviations from the spec, all deliberate:

- **Workout → habit and habit slipping are limited to daily habits.** The spec says "scheduled today"; a weekly habit has no per-day completion to test.
- **Habit slipping uses the habit's own `reminderTime`**, not a separate reminders query. That is where a habit's reminder lives in this codebase.
- **Confirming a habit suggestion increments** by the proposed count rather than setting it, so a duration habit keeps minutes already logged.
- **The workout reader may need a fix** (Task 11, Step 7): it appears to send HealthKit's numeric activity code rather than its name. The server handles both.
