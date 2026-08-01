# History Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A History screen — a month grid tinted by each day's Daily Flow — and a read-only day screen behind it, so a user can go back to any date and see what they actually did.

**Architecture:** All layout and scoring math lives as pure functions in `@synitheia/shared`, where it is unit-testable without Mongo or React. The API adds one endpoint (`GET /summary/month`) that reads the existing `DailySummary` cache through the existing `getSummariesBetween` range query and maps each document through the *same* `computeDailyFlow` the Today screen uses. The mobile app adds two Stack routes that reuse `ProgressRing`, `HabitCard`, and `Timeline` unchanged. One pre-existing bug is fixed along the way: only expense settle-up currently invalidates `DailySummary`, so habit/water/food writes leave stale documents that the heat-map would read.

**Tech Stack:** TypeScript, zod, Fastify + `fastify-type-provider-zod`, Mongoose, vitest + `mongodb-memory-server`, React Native (Expo SDK 54), expo-router, TanStack Query, `lucide-react-native`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-01-history-calendar-design.md`. Read it before starting.
- **Dates are `LocalDate`** (`YYYY-MM-DD`, branded, user's IANA zone) — never a JS `Date` and never the device's clock. Calendar arithmetic goes through `packages/shared/src/time/local-date.ts` and nothing else. See the comment block at `local-date.ts:99` for why date-fns is forbidden here.
- **Weeks are Monday-anchored**, matching `startOfLocalWeek` and the M–S columns in the Weekly Analysis chart.
- **"No data" is never `0`.** A day with no `DailySummary` is absent from the response and drawn hollow. Same principle as `activity.steps: null` in `apps/api/src/context/aggregator.ts:99`.
- **`computeDailyFlow` in `@synitheia/shared` stays the single source of truth** for the flow percentage. Never reimplement the weighting.
- **Past days are read-only.** No mutation, no logging affordances, no backfill.
- **Styling** comes from `apps/mobile/src/theme/tokens.ts`. Never hardcode a colour, radius, or spacing value in a component.
- **Test runner:** `pnpm --filter @synitheia/shared test`, `pnpm --filter @synitheia/api test`, `pnpm --filter @synitheia/mobile test`. Full gate: `pnpm check` (typecheck + lint + test).
- **Commit after every task.** Conventional commit prefixes, matching the existing log (`feat(shared):`, `feat(api):`, `fix(api):`, `feat(mobile):`).

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `packages/shared/src/time/month-grid.ts` | `MonthKey` type + the Monday-anchored calendar grid layout. Pure. |
| `packages/shared/src/time/month-grid.test.ts` | Tests for the above. |
| `packages/shared/src/time/format.ts` | Human-readable date/month labels rendered without a timezone shifting them. |
| `packages/shared/src/time/format.test.ts` | Tests for the above. |
| `packages/shared/src/domain/month-summary.ts` | The `/summary/month` wire contract + `flowPercentForSummary` + `monthStats`. |
| `packages/shared/src/domain/month-summary.test.ts` | Tests for the above. |
| `apps/api/src/modules/summary/routes.ts` | `GET /summary/month`. |
| `apps/api/src/modules/summary/routes.test.ts` | Integration tests for the above. |
| `apps/api/src/context/aggregator.invalidation.test.ts` | Proves every flow-changing write drops the day's summary. |
| `apps/mobile/src/theme/tokens.test.ts` | Tests `flowTint`. |
| `apps/mobile/src/components/MonthGrid.tsx` | Renders the grid. Fetches nothing. |
| `apps/mobile/app/day/[date].tsx` | One past day, read-only. |
| `apps/mobile/app/history.tsx` | Month paging, stats, states. |

**Modified**

| Path | Change |
|---|---|
| `packages/shared/src/domain/common.ts` | Add `monthKeySchema`. |
| `packages/shared/src/index.ts` | Export the three new modules. |
| `packages/shared/src/domain/today.ts` | Export `DEFAULT_TRACKED_DOMAINS`. |
| `apps/api/src/context/aggregator.ts` | Add `invalidateDailySummary`. |
| `apps/api/src/modules/habits/service.ts` | Invalidate after `logHabit`. |
| `apps/api/src/modules/water/routes.ts` | Invalidate after create and delete. |
| `apps/api/src/modules/nutrition/service.ts` | Invalidate after `rebuildDaily`. |
| `apps/api/src/modules/expenses/service.ts` | Invalidate after create/update/delete; reuse the helper in `settleParticipant`. |
| `apps/api/src/modules/today/routes.ts` | Use the shared `DEFAULT_TRACKED_DOMAINS` instead of an inline literal. |
| `apps/api/src/app.ts` | Register the summary routes. |
| `apps/mobile/src/theme/tokens.ts` | Add `flowTint`. |
| `apps/mobile/src/components/HabitCard.tsx` | Add `readOnly` prop. |
| `apps/mobile/app/(tabs)/index.tsx` | Use shared `formatDayLabel`; add the calendar icon. |
| `apps/mobile/app/_layout.tsx` | Register `history` and `day/[date]`. |

---

## Deviation from the spec (read this)

The spec says the day screen shows "ring, streak/XP chips, habits, totals, timeline."

**The chips have to go.** `GET /today?localDate=` returns `xp` from `UserModel.xp` (a lifetime account total) and `streakDays` from `habit.currentStreak` (the streak *as of now*). Both are current values, not historical ones — `apps/api/src/modules/today/routes.ts` computes them without reference to `localDate`. Rendering "🔥 4 day streak" on July 18's screen would state something false about July 18.

Making them historical would mean recomputing streaks as-of-date and storing an XP ledger — a much larger change than this feature justifies.

**Instead:** the day screen shows a **spend · water · calories** summary row, which is date-accurate because those numbers come from that day's documents. Task 8 implements this. Update the spec's "Screens" section to match when the plan is done.

---

## Task 1: Month grid layout (shared)

**Files:**
- Create: `packages/shared/src/time/month-grid.ts`
- Test: `packages/shared/src/time/month-grid.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `LocalDate`, `addLocalDays`, `eachLocalDay`, `localWeekdayIndex` from `./local-date.js`
- Produces:
  - `type MonthKey = string & { readonly __brand: 'MonthKey' }`
  - `isMonthKey(value: string): value is MonthKey`
  - `asMonthKey(value: string): MonthKey`
  - `monthKeyOf(localDate: LocalDate): MonthKey`
  - `firstOfMonth(month: MonthKey): LocalDate`
  - `lastOfMonth(month: MonthKey): LocalDate`
  - `addMonths(month: MonthKey, delta: number): MonthKey`
  - `monthGridCells(month: MonthKey): (LocalDate | null)[]`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/time/month-grid.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { asLocalDate } from './local-date.js';
import {
  addMonths,
  asMonthKey,
  firstOfMonth,
  isMonthKey,
  lastOfMonth,
  monthGridCells,
  monthKeyOf,
} from './month-grid.js';

describe('isMonthKey', () => {
  it('accepts YYYY-MM', () => {
    expect(isMonthKey('2026-07')).toBe(true);
    expect(isMonthKey('2026-12')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isMonthKey('2026-7')).toBe(false);
    expect(isMonthKey('2026-13')).toBe(false);
    expect(isMonthKey('2026-00')).toBe(false);
    expect(isMonthKey('2026-07-01')).toBe(false);
    expect(isMonthKey('')).toBe(false);
  });
});

describe('asMonthKey', () => {
  it('throws on a malformed month', () => {
    expect(() => asMonthKey('2026-13')).toThrow(RangeError);
  });
});

describe('month boundaries', () => {
  it('finds the first and last day', () => {
    expect(firstOfMonth(asMonthKey('2026-07'))).toBe('2026-07-01');
    expect(lastOfMonth(asMonthKey('2026-07'))).toBe('2026-07-31');
  });

  it('handles 30-day months and February', () => {
    expect(lastOfMonth(asMonthKey('2026-06'))).toBe('2026-06-30');
    expect(lastOfMonth(asMonthKey('2026-02'))).toBe('2026-02-28');
    expect(lastOfMonth(asMonthKey('2024-02'))).toBe('2024-02-29'); // leap
  });

  it('rolls across December', () => {
    expect(lastOfMonth(asMonthKey('2026-12'))).toBe('2026-12-31');
    expect(addMonths(asMonthKey('2026-12'), 1)).toBe('2027-01');
    expect(addMonths(asMonthKey('2026-01'), -1)).toBe('2025-12');
    expect(addMonths(asMonthKey('2026-07'), -3)).toBe('2026-04');
  });

  it('derives a month from a day', () => {
    expect(monthKeyOf(asLocalDate('2026-07-18'))).toBe('2026-07');
  });
});

describe('monthGridCells', () => {
  it('pads a Wednesday-start month with two leading blanks', () => {
    // 2026-07-01 is a Wednesday -> Monday-index 2.
    const cells = monthGridCells(asMonthKey('2026-07'));

    expect(cells.length).toBe(35); // 5 rows of 7
    expect(cells.slice(0, 2)).toEqual([null, null]);
    expect(cells[2]).toBe('2026-07-01');
    expect(cells[32]).toBe('2026-07-31');
    expect(cells.slice(33)).toEqual([null, null]);
  });

  it('adds no leading blanks when the month starts on a Monday', () => {
    // 2026-06-01 is a Monday.
    const cells = monthGridCells(asMonthKey('2026-06'));

    expect(cells[0]).toBe('2026-06-01');
    expect(cells.length).toBe(35);
    expect(cells.filter((c) => c !== null).length).toBe(30);
  });

  it('spills to six rows when a long month starts on a Sunday', () => {
    // 2026-11-01 is a Sunday -> Monday-index 6, plus 30 days = 36 cells.
    const cells = monthGridCells(asMonthKey('2026-11'));

    expect(cells.length).toBe(42); // 6 rows of 7
    expect(cells.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(cells[6]).toBe('2026-11-01');
  });

  it('covers a leap February exactly', () => {
    // 2024-02-01 is a Thursday -> Monday-index 3.
    const cells = monthGridCells(asMonthKey('2024-02'));

    expect(cells.slice(0, 3)).toEqual([null, null, null]);
    expect(cells[3]).toBe('2024-02-01');
    expect(cells.filter((c) => c !== null)).toHaveLength(29);
    expect(cells.length % 7).toBe(0);
  });

  it('always returns whole weeks', () => {
    for (const month of ['2026-01', '2026-02', '2026-08', '2027-05']) {
      expect(monthGridCells(asMonthKey(month)).length % 7).toBe(0);
    }
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @synitheia/shared test month-grid`
Expected: FAIL — `Failed to resolve import "./month-grid.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/time/month-grid.ts`:

```ts
import {
  addLocalDays,
  eachLocalDay,
  localWeekdayIndex,
  type LocalDate,
} from './local-date.js';

/**
 * A calendar month in the user's own timezone, as `YYYY-MM`.
 *
 * Branded for the same reason LocalDate is: a bare string month is trivially
 * confused with a LocalDate that has lost its day, and every query that filters
 * on `localDate: { $gte, $lte }` would silently match nothing.
 */
export type MonthKey = string & { readonly __brand: 'MonthKey' };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonthKey(value: string): value is MonthKey {
  return MONTH_RE.test(value);
}

export function asMonthKey(value: string): MonthKey {
  if (!isMonthKey(value)) {
    throw new RangeError(`Invalid MonthKey: "${value}" (expected YYYY-MM)`);
  }
  return value;
}

export function monthKeyOf(localDate: LocalDate): MonthKey {
  return localDate.slice(0, 7) as MonthKey;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function partsOf(month: MonthKey): [year: number, monthIndex: number] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return [y, m];
}

export function firstOfMonth(month: MonthKey): LocalDate {
  return `${month}-01` as LocalDate;
}

/**
 * Computed as "the day before the first of next month" rather than from a table of
 * month lengths, so February and leap years need no special case.
 */
export function lastOfMonth(month: MonthKey): LocalDate {
  return addLocalDays(firstOfMonth(addMonths(month, 1)), -1);
}

export function addMonths(month: MonthKey, delta: number): MonthKey {
  const [year, m] = partsOf(month);
  // Shift to a 0-based absolute month count so the arithmetic works in both
  // directions without a December/January special case.
  const absolute = year * 12 + (m - 1) + delta;
  return `${Math.floor(absolute / 12)}-${pad((absolute % 12) + 1)}` as MonthKey;
}

/**
 * The month laid out as whole Monday-anchored weeks.
 *
 * `null` is a cell outside the month — the calendar renders it as empty space, not
 * as a day with no data. Those are different things and the grid must not conflate
 * them: an empty cell is "this square is not a date", a hollow cell is "this date
 * has nothing logged".
 *
 * Always a multiple of 7, so the consumer can chunk it into rows without padding.
 */
export function monthGridCells(month: MonthKey): (LocalDate | null)[] {
  const first = firstOfMonth(month);
  const leading = localWeekdayIndex(first);

  const cells: (LocalDate | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...eachLocalDay(first, lastOfMonth(month)),
  ];

  const trailing = (7 - (cells.length % 7)) % 7;
  return [...cells, ...Array.from({ length: trailing }, () => null)];
}
```

- [ ] **Step 4: Export it**

In `packages/shared/src/index.ts`, add below the existing `./time/local-date.js` line:

```ts
export * from './time/month-grid.js';
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm --filter @synitheia/shared test month-grid`
Expected: PASS, all cases green.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/time/month-grid.ts packages/shared/src/time/month-grid.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): MonthKey and Monday-anchored month grid layout"
```

---

## Task 2: Date labels (shared)

`app/(tabs)/index.tsx:41` has a `formatOverline` helper that anchors a `LocalDate` at UTC midnight and formats it *in UTC*, specifically so no timezone shifts the label by a day. Three screens need it now. Move it rather than copy it twice.

**Files:**
- Create: `packages/shared/src/time/format.ts`
- Test: `packages/shared/src/time/format.test.ts`
- Modify: `packages/shared/src/index.ts`, `apps/mobile/app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `LocalDate` from `./local-date.js`, `MonthKey` from `./month-grid.js`
- Produces:
  - `formatDayLabel(localDate: LocalDate): string` → `"Friday, July 18"`
  - `formatShortDayLabel(localDate: LocalDate): string` → `"Fri, Jul 18"`
  - `formatMonthLabel(month: MonthKey): string` → `"July 2026"`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/time/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { asLocalDate } from './local-date.js';
import { asMonthKey } from './month-grid.js';
import { formatDayLabel, formatMonthLabel, formatShortDayLabel } from './format.js';

describe('formatDayLabel', () => {
  it('renders the weekday, month and day', () => {
    expect(formatDayLabel(asLocalDate('2026-07-18'))).toBe('Saturday, July 18');
  });

  it('does not shift across the first of the month', () => {
    // The classic failure: a negative-offset host zone renders this as June 30.
    expect(formatDayLabel(asLocalDate('2026-07-01'))).toBe('Wednesday, July 1');
  });

  it('does not shift across new year', () => {
    expect(formatDayLabel(asLocalDate('2026-01-01'))).toBe('Thursday, January 1');
  });
});

describe('formatShortDayLabel', () => {
  it('abbreviates', () => {
    expect(formatShortDayLabel(asLocalDate('2026-07-18'))).toBe('Sat, Jul 18');
  });
});

describe('formatMonthLabel', () => {
  it('renders the month and year', () => {
    expect(formatMonthLabel(asMonthKey('2026-07'))).toBe('July 2026');
    expect(formatMonthLabel(asMonthKey('2026-01'))).toBe('January 2026');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @synitheia/shared test format`
Expected: FAIL — `Failed to resolve import "./format.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/time/format.ts`:

```ts
import type { LocalDate } from './local-date.js';
import { firstOfMonth, type MonthKey } from './month-grid.js';

/**
 * A LocalDate is a bare calendar label with no timezone attached. Anchoring it at
 * UTC midnight and formatting it *in UTC* is the only way to render it without some
 * zone silently shifting it a day — which is exactly the class of bug local-date.ts
 * exists to prevent.
 */
function anchor(localDate: LocalDate | string): Date {
  return new Date(`${localDate.slice(0, 10)}T00:00:00Z`);
}

const DAY = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
});

const SHORT_DAY = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

const MONTH = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "Saturday, July 18" */
export function formatDayLabel(localDate: LocalDate): string {
  return DAY.format(anchor(localDate));
}

/** "Sat, Jul 18" */
export function formatShortDayLabel(localDate: LocalDate): string {
  return SHORT_DAY.format(anchor(localDate));
}

/** "July 2026" */
export function formatMonthLabel(month: MonthKey): string {
  return MONTH.format(anchor(firstOfMonth(month)));
}
```

- [ ] **Step 4: Export it**

In `packages/shared/src/index.ts`, add below the `./time/month-grid.js` line:

```ts
export * from './time/format.js';
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm --filter @synitheia/shared test format`
Expected: PASS.

- [ ] **Step 6: Replace the copy in the Today screen**

In `apps/mobile/app/(tabs)/index.tsx`, delete the `formatOverline` function and its doc comment (lines 34–48, ending with the closing brace of `formatOverline`), then add `formatDayLabel` to the existing `@synitheia/shared` import block:

```ts
import {
  asMinor,
  formatDayLabel,
  formatMoney,
  type SupportingMetric,
  type TodayResponse,
  HABIT_MEASURES,
  measureOf,
} from '@synitheia/shared';
```

Find the single call site (`const overline = formatOverline(...)`, near the top of the `Today` component body) and change `formatOverline` to `formatDayLabel`. The argument stays the same.

- [ ] **Step 7: Typecheck the mobile app**

Run: `pnpm --filter @synitheia/mobile typecheck`
Expected: PASS, no reference to `formatOverline` remaining.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/time/format.ts packages/shared/src/time/format.test.ts packages/shared/src/index.ts "apps/mobile/app/(tabs)/index.tsx"
git commit -m "feat(shared): timezone-safe day and month labels"
```

---

## Task 3: Month summary contract and scoring (shared)

**Files:**
- Create: `packages/shared/src/domain/month-summary.ts`
- Test: `packages/shared/src/domain/month-summary.test.ts`
- Modify: `packages/shared/src/domain/common.ts`, `packages/shared/src/domain/today.ts`, `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `computeDailyFlow`, `FlowComponent` from `./today.js`; `localDateSchema` from `./common.js`; `diffLocalDays`, `LocalDate` from `../time/local-date.js`
- Produces:
  - `monthKeySchema` (in `common.ts`) — a zod schema validating `YYYY-MM`
  - `DEFAULT_TRACKED_DOMAINS` (in `today.ts`) — `readonly ['habits','expenses','nutrition','water']`
  - `FLOW_RUN_THRESHOLD: 60`
  - `flowPercentForSummary(summary: FlowSummaryInput, trackedDomains: readonly string[]): number`
  - `monthStats(days: readonly MonthDay[]): MonthStats`
  - `monthSummaryResponseSchema` / `type MonthSummaryResponse`
  - `type MonthDay = { localDate: LocalDate; percent: number; eventCount: number }`

- [ ] **Step 1: Add the month key schema**

In `packages/shared/src/domain/common.ts`, directly below `localDateSchema`, add:

```ts
export const monthKeySchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');
```

- [ ] **Step 2: Export the tracked-domain default**

In `packages/shared/src/domain/today.ts`, directly above `export function computeDailyFlow`, add:

```ts
/**
 * The trackers a user is scored against before onboarding records a preference.
 *
 * Duplicated as an inline literal in the Today route before this existed; both the
 * live day and the history grid must gate on the same list or the calendar and the
 * ring will disagree for anyone who never finished onboarding.
 */
export const DEFAULT_TRACKED_DOMAINS = [
  'habits',
  'expenses',
  'nutrition',
  'water',
] as const;
```

- [ ] **Step 3: Write the failing test**

Create `packages/shared/src/domain/month-summary.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { asLocalDate, type LocalDate } from '../time/local-date.js';
import { DEFAULT_TRACKED_DOMAINS } from './today.js';
import {
  flowPercentForSummary,
  monthStats,
  monthSummaryResponseSchema,
  type FlowSummaryInput,
} from './month-summary.js';

function summary(overrides: Partial<FlowSummaryInput> = {}): FlowSummaryInput {
  return {
    habits: { scheduled: 2, completionRate: 1 },
    water: { totalMl: 2500, targetMl: 2500, entryCount: 3 },
    nutrition: { totals: { calories: 2000 }, calorieTarget: 2000, entryCount: 2 },
    ...overrides,
  };
}

describe('flowPercentForSummary', () => {
  it('is 100 when every tracked component is met', () => {
    expect(flowPercentForSummary(summary(), DEFAULT_TRACKED_DOMAINS)).toBe(100);
  });

  it('averages the active components evenly', () => {
    const half = summary({ water: { totalMl: 1250, targetMl: 2500, entryCount: 2 } });
    // habits 100, water 50, nutrition 100 -> 83.33 -> 83
    expect(flowPercentForSummary(half, DEFAULT_TRACKED_DOMAINS)).toBe(83);
  });

  it('excludes a domain the user does not track', () => {
    const noWater = summary({ water: { totalMl: 0, targetMl: 2500, entryCount: 4 } });
    // Water would drag this to 67 if counted; tracking only habits keeps it at 100.
    expect(flowPercentForSummary(noWater, ['habits'])).toBe(100);
  });

  it('excludes a tracker with no entries that day rather than scoring it zero', () => {
    // Matching the weekly chart: an untouched tracker is absent, not a failure.
    const untouched = summary({
      water: { totalMl: 0, targetMl: 2500, entryCount: 0 },
      nutrition: { totals: { calories: 0 }, calorieTarget: 2000, entryCount: 0 },
    });
    expect(flowPercentForSummary(untouched, DEFAULT_TRACKED_DOMAINS)).toBe(100);
  });

  it('scores a tracked habit day with nothing completed as zero, not absent', () => {
    const missed = summary({
      habits: { scheduled: 3, completionRate: 0 },
      water: { totalMl: 0, targetMl: 2500, entryCount: 0 },
      nutrition: { totals: { calories: 0 }, calorieTarget: 2000, entryCount: 0 },
    });
    expect(flowPercentForSummary(missed, DEFAULT_TRACKED_DOMAINS)).toBe(0);
  });

  it('is 0, never NaN, when nothing at all is active', () => {
    const empty = summary({
      habits: { scheduled: 0, completionRate: 0 },
      water: { totalMl: 0, targetMl: 2500, entryCount: 0 },
      nutrition: { totals: { calories: 0 }, calorieTarget: 2000, entryCount: 0 },
    });
    expect(flowPercentForSummary(empty, DEFAULT_TRACKED_DOMAINS)).toBe(0);
  });

  it('clamps an overshot component at 100', () => {
    const overshoot = summary({ water: { totalMl: 9000, targetMl: 2500, entryCount: 5 } });
    expect(flowPercentForSummary(overshoot, DEFAULT_TRACKED_DOMAINS)).toBe(100);
  });
});

function day(localDate: string, percent: number, eventCount = 1) {
  return { localDate: asLocalDate(localDate) as LocalDate, percent, eventCount };
}

describe('monthStats', () => {
  it('is all zeroes for an empty month', () => {
    expect(monthStats([])).toEqual({ avgPercent: 0, daysLogged: 0, bestFlowRun: 0 });
  });

  it('counts only the days present', () => {
    const stats = monthStats([day('2026-07-01', 80), day('2026-07-05', 40)]);
    expect(stats.daysLogged).toBe(2);
  });

  it('averages only the days present, so gaps do not drag the mean down', () => {
    // Two days at 80 and 40 average to 60 — not 60/31 as they would if the 29
    // untouched days counted as zero.
    expect(monthStats([day('2026-07-01', 80), day('2026-07-05', 40)]).avgPercent).toBe(60);
  });

  it('finds the longest consecutive run at or above the threshold', () => {
    const stats = monthStats([
      day('2026-07-01', 90),
      day('2026-07-02', 70),
      day('2026-07-03', 60), // exactly at the threshold — counts
      day('2026-07-04', 20), // breaks the run at 3
      day('2026-07-05', 95),
      day('2026-07-06', 95),
    ]);
    expect(stats.bestFlowRun).toBe(3);
  });

  it('breaks a run on a missing day even when both sides are high', () => {
    const stats = monthStats([
      day('2026-07-01', 90),
      day('2026-07-02', 90),
      // 2026-07-03 absent
      day('2026-07-04', 90),
    ]);
    expect(stats.bestFlowRun).toBe(2);
  });

  it('handles days arriving out of order', () => {
    const stats = monthStats([
      day('2026-07-03', 90),
      day('2026-07-01', 90),
      day('2026-07-02', 90),
    ]);
    expect(stats.bestFlowRun).toBe(3);
  });
});

describe('monthSummaryResponseSchema', () => {
  it('accepts a well-formed payload', () => {
    const parsed = monthSummaryResponseSchema.parse({
      month: '2026-07',
      earliestLocalDate: '2026-03-14',
      days: [{ localDate: '2026-07-18', percent: 82, eventCount: 7 }],
      stats: { avgPercent: 82, daysLogged: 1, bestFlowRun: 1 },
    });
    expect(parsed.days[0]?.percent).toBe(82);
  });

  it('rejects a malformed month', () => {
    expect(() =>
      monthSummaryResponseSchema.parse({
        month: '2026-7',
        earliestLocalDate: '2026-03-14',
        days: [],
        stats: { avgPercent: 0, daysLogged: 0, bestFlowRun: 0 },
      }),
    ).toThrow();
  });

  it('rejects a percent outside 0-100', () => {
    expect(() =>
      monthSummaryResponseSchema.parse({
        month: '2026-07',
        earliestLocalDate: '2026-03-14',
        days: [{ localDate: '2026-07-18', percent: 120, eventCount: 1 }],
        stats: { avgPercent: 0, daysLogged: 0, bestFlowRun: 0 },
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 4: Run the test and confirm it fails**

Run: `pnpm --filter @synitheia/shared test month-summary`
Expected: FAIL — `Failed to resolve import "./month-summary.js"`.

- [ ] **Step 5: Write the implementation**

Create `packages/shared/src/domain/month-summary.ts`:

```ts
import { z } from 'zod';
import { diffLocalDays, type LocalDate } from '../time/local-date.js';
import { localDateSchema, monthKeySchema } from './common.js';
import { computeDailyFlow, type FlowComponent } from './today.js';

/** A day counts toward a run at or above this flow percentage. */
export const FLOW_RUN_THRESHOLD = 60;

/**
 * The slice of a DailySummary that the flow percentage is computed from.
 *
 * Declared structurally rather than importing the Mongoose document type, so this
 * stays a pure function the client can also run.
 */
export interface FlowSummaryInput {
  habits: { scheduled: number; completionRate: number };
  water: { totalMl: number; targetMl: number; entryCount: number };
  nutrition: { totals: { calories: number }; calorieTarget: number; entryCount: number };
}

/**
 * One historical day's flow percentage.
 *
 * A tracker with no entries that day is EXCLUDED rather than scored zero — matching
 * the Weekly Analysis chart, which is the other place historical days are scored. A
 * user who has never opened the food tracker must not have every past day capped at
 * 67% by a tracker they never used. Habits are the exception: a scheduled habit that
 * was not completed is a genuine zero, not an absence.
 */
export function flowPercentForSummary(
  summary: FlowSummaryInput,
  trackedDomains: readonly string[],
): number {
  const tracked = new Set(trackedDomains);

  const components: FlowComponent[] = [
    {
      key: 'habits',
      percent: summary.habits.completionRate * 100,
      active: tracked.has('habits') && summary.habits.scheduled > 0,
    },
    {
      key: 'water',
      percent: (summary.water.totalMl / summary.water.targetMl) * 100,
      active: tracked.has('water') && summary.water.entryCount > 0,
    },
    {
      key: 'nutrition',
      percent:
        (summary.nutrition.totals.calories / summary.nutrition.calorieTarget) * 100,
      active: tracked.has('nutrition') && summary.nutrition.entryCount > 0,
    },
  ];

  return computeDailyFlow(components).percent;
}

export const monthDaySchema = z.object({
  localDate: localDateSchema,
  percent: z.number().int().min(0).max(100),
  eventCount: z.number().int().nonnegative(),
});
export type MonthDay = z.infer<typeof monthDaySchema> & { localDate: LocalDate };

export const monthStatsSchema = z.object({
  avgPercent: z.number().int().min(0).max(100),
  daysLogged: z.number().int().nonnegative(),
  /** Longest consecutive run at or above FLOW_RUN_THRESHOLD. NOT the habit streak. */
  bestFlowRun: z.number().int().nonnegative(),
});
export type MonthStats = z.infer<typeof monthStatsSchema>;

/**
 * Statistics over the days that exist.
 *
 * Absent days are absent, not zero — averaging over the whole calendar month would
 * report a diligent three-day-old account as a 10% month.
 */
export function monthStats(days: readonly MonthDay[]): MonthStats {
  if (days.length === 0) return { avgPercent: 0, daysLogged: 0, bestFlowRun: 0 };

  const sorted = [...days].sort((a, b) => a.localDate.localeCompare(b.localDate));

  const avgPercent = Math.round(
    sorted.reduce((acc, d) => acc + d.percent, 0) / sorted.length,
  );

  let best = 0;
  let run = 0;
  let previous: LocalDate | null = null;

  for (const d of sorted) {
    // A calendar gap breaks the run even if both sides clear the threshold — the
    // user did not keep it up through a day they logged nothing at all.
    const contiguous = previous !== null && diffLocalDays(previous, d.localDate) === 1;
    run = d.percent >= FLOW_RUN_THRESHOLD ? (contiguous ? run + 1 : 1) : 0;
    if (run > best) best = run;
    previous = d.localDate;
  }

  return { avgPercent, daysLogged: sorted.length, bestFlowRun: best };
}

/**
 * The History grid, in one request.
 *
 * Days with nothing logged are ABSENT from `days` rather than present with
 * `percent: 0`. The client draws those hollow. "You weren't using the app" and
 * "you scored zero" are different statements and the wire format must preserve
 * the difference — the same reason `activity.steps` is nullable in DailySummary.
 */
export const monthSummaryResponseSchema = z.object({
  month: monthKeySchema,
  /** Account creation in the user's zone. The client's back-arrow stops here. */
  earliestLocalDate: localDateSchema,
  days: z.array(monthDaySchema),
  stats: monthStatsSchema,
});
export type MonthSummaryResponse = z.infer<typeof monthSummaryResponseSchema>;
```

- [ ] **Step 6: Export it**

In `packages/shared/src/index.ts`, add after the `./domain/summary.js` line:

```ts
export * from './domain/month-summary.js';
```

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `pnpm --filter @synitheia/shared test`
Expected: PASS — the new file plus every pre-existing shared test.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): month summary contract, flow scoring, and month stats"
```

---

## Task 4: Stop serving stale summaries (api)

`DailySummary` is a cache. Exactly one write path invalidates it today — expense settle-up at `apps/api/src/modules/expenses/service.ts:335`. `logHabit`, water entries, and food entries all leave a stale document behind, which is already visible as a Weekly Analysis bar that disagrees with the ring above it.

**Files:**
- Modify: `apps/api/src/context/aggregator.ts`
- Modify: `apps/api/src/modules/habits/service.ts`
- Modify: `apps/api/src/modules/water/routes.ts`
- Modify: `apps/api/src/modules/nutrition/service.ts`
- Modify: `apps/api/src/modules/expenses/service.ts`
- Test: `apps/api/src/context/aggregator.invalidation.test.ts`

**Interfaces:**
- Produces: `invalidateDailySummary(userId: string, localDate: LocalDate): Promise<void>` from `../../context/aggregator.js`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/context/aggregator.invalidation.test.ts`:

```ts
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { asLocalDate } from '@synitheia/shared';
import { DailySummaryModel } from '../db/models.js';
import { invalidateDailySummary } from './aggregator.js';

let mongo: MongoMemoryReplSet;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await DailySummaryModel.syncIndexes();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await DailySummaryModel.deleteMany({});
});

const DAY = asLocalDate('2026-07-18');
const OTHER_DAY = asLocalDate('2026-07-19');

async function seedSummary(userId: string, localDate: string) {
  await DailySummaryModel.create({
    userId: new Types.ObjectId(userId),
    localDate,
    expenses: { totalMinor: 0, count: 0, byCategory: {}, largestMinor: null },
    habits: { scheduled: 0, completed: 0, completionRate: 0, completedIds: [], missedIds: [] },
    nutrition: {
      totals: { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
      entryCount: 0,
      calorieTarget: 2000,
    },
    water: { totalMl: 0, targetMl: 2500, entryCount: 0 },
    activity: { steps: null, workoutMinutes: null, sleepMinutes: null },
    context: {
      weekday: 5,
      calendarEventCount: 0,
      lastCalendarEventEndMin: null,
      weatherCondition: null,
    },
    eventCount: 0,
    sources: [],
    generatedAt: new Date(),
  });
}

describe('invalidateDailySummary', () => {
  it('drops the cached summary for that user and day', async () => {
    const userId = new Types.ObjectId().toString();
    await seedSummary(userId, DAY);

    await invalidateDailySummary(userId, DAY);

    expect(await DailySummaryModel.countDocuments({ localDate: DAY })).toBe(0);
  });

  it('leaves other days alone', async () => {
    const userId = new Types.ObjectId().toString();
    await seedSummary(userId, DAY);
    await seedSummary(userId, OTHER_DAY);

    await invalidateDailySummary(userId, DAY);

    expect(await DailySummaryModel.countDocuments({ localDate: OTHER_DAY })).toBe(1);
  });

  it('leaves other users alone', async () => {
    const mine = new Types.ObjectId().toString();
    const theirs = new Types.ObjectId().toString();
    await seedSummary(mine, DAY);
    await seedSummary(theirs, DAY);

    await invalidateDailySummary(mine, DAY);

    expect(
      await DailySummaryModel.countDocuments({ userId: new Types.ObjectId(theirs) }),
    ).toBe(1);
  });

  it('is a no-op when there is nothing cached', async () => {
    await expect(
      invalidateDailySummary(new Types.ObjectId().toString(), DAY),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @synitheia/api test aggregator.invalidation`
Expected: FAIL — `invalidateDailySummary is not exported`.

- [ ] **Step 3: Add the helper**

In `apps/api/src/context/aggregator.ts`, add at the end of the file:

```ts
/**
 * Drop a day's cached summary so the next read rebuilds it.
 *
 * Every write that changes what a day looked like must call this. A summary is a
 * cache, and a cache nobody invalidates is just a wrong answer with good latency —
 * the Weekly Analysis chart and the History grid both read it directly.
 */
export async function invalidateDailySummary(
  userId: string,
  localDate: LocalDate,
): Promise<void> {
  await DailySummaryModel.deleteOne({
    userId: new Types.ObjectId(userId),
    localDate,
  });
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm --filter @synitheia/api test aggregator.invalidation`
Expected: PASS.

- [ ] **Step 5: Call it from the habit write**

In `apps/api/src/modules/habits/service.ts`, add `invalidateDailySummary` to the imports from `../../context/aggregator.js` (create the import if the file does not already import from there), then in `logHabit` — immediately after `const updated = await recomputeStreak(...)` and before the `if (complete)` block — add:

```ts
  await invalidateDailySummary(user.id, localDate);
```

- [ ] **Step 6: Call it from the water writes**

In `apps/api/src/modules/water/routes.ts`, import the helper:

```ts
import { invalidateDailySummary } from '../../context/aggregator.js';
```

In `createEntry`, immediately before the closing `return { entry, totalMl, targetMl };`:

```ts
  await invalidateDailySummary(user.id, entry.localDate as LocalDate);
```

In the `DELETE /water/:id` handler, replace the `deleteOne` call with `findOneAndDelete` so the deleted row's day is known, and invalidate it:

```ts
      const removed = await WaterEntryModel.findOneAndDelete({
        _id: new Types.ObjectId(req.params.id),
        userId: new Types.ObjectId(req.user.id),
      });

      if (!removed) throw AppError.notFound('Water entry');

      // The timeline is a projection — a mis-tapped glass must vanish from Today too.
      await retractByRef(req.user.id, req.params.id);
      await invalidateDailySummary(req.user.id, removed.localDate as LocalDate);

      return reply.status(204).send();
```

- [ ] **Step 7: Call it from the nutrition write**

`rebuildDaily` is the single funnel for every food change, so one call covers create, update, and delete. In `apps/api/src/modules/nutrition/service.ts`, import the helper and add it immediately before `return daily as DailyNutritionWithId;`:

```ts
  await invalidateDailySummary(userId, localDate);
```

- [ ] **Step 8: Call it from the expense writes and de-duplicate the existing one**

Expenses do not affect the flow percentage, but they do affect `eventCount` and everything the AI context builder reads. In `apps/api/src/modules/expenses/service.ts`:

- Import `invalidateDailySummary` from `../../context/aggregator.js`.
- In `settleParticipant`, replace the inline `DailySummaryModel.deleteOne({...})` block with:

```ts
  await invalidateDailySummary(user.id, expense.localDate as LocalDate);
```

- Add the same call at the end of `createExpense` and `deleteExpense`, using each function's own expense document for the date.
- In `updateExpense`, invalidate **both** the old and the new `localDate` — an expense moved from the 17th to the 18th makes two days stale:

```ts
  if (previousLocalDate !== expense.localDate) {
    await invalidateDailySummary(user.id, previousLocalDate as LocalDate);
  }
  await invalidateDailySummary(user.id, expense.localDate as LocalDate);
```

Capture `previousLocalDate` from the loaded document *before* applying the update.

- If `DailySummaryModel` is now unused in this file, remove it from the `../../db/models.js` import.

- [ ] **Step 9: Run the whole API suite**

Run: `pnpm --filter @synitheia/api test`
Expected: PASS. If an existing test asserted that a summary survived one of these writes, that assertion encoded the bug — update it to expect invalidation.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src
git commit -m "fix(api): invalidate the daily summary on every flow-changing write"
```

---

## Task 5: The month endpoint (api)

**Files:**
- Create: `apps/api/src/modules/summary/routes.ts`
- Test: `apps/api/src/modules/summary/routes.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/modules/today/routes.ts`

**Interfaces:**
- Consumes: `getSummariesBetween` from `../../context/aggregator.js`; `flowPercentForSummary`, `monthStats`, `monthKeySchema`, `firstOfMonth`, `lastOfMonth`, `asMonthKey`, `DEFAULT_TRACKED_DOMAINS` from `@synitheia/shared`
- Produces: `registerSummaryRoutes(app: FastifyInstance): Promise<void>`; the route `GET /summary/month?month=YYYY-MM` returning `MonthSummaryResponse`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/summary/routes.test.ts`. This mirrors the setup style of `apps/api/src/context/detectors.test.ts` — read that file first for the in-memory Mongo conventions.

```ts
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { monthSummaryResponseSchema } from '@synitheia/shared';
import { DailySummaryModel, UserModel, UserPreferenceModel } from '../../db/models.js';
import { monthSummaryFor } from './routes.js';

let mongo: MongoMemoryReplSet;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    DailySummaryModel.syncIndexes(),
    UserModel.syncIndexes(),
    UserPreferenceModel.syncIndexes(),
  ]);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await Promise.all([
    DailySummaryModel.deleteMany({}),
    UserModel.deleteMany({}),
    UserPreferenceModel.deleteMany({}),
  ]);
});

const IST = 'Asia/Kolkata';

async function makeUser(createdAt = new Date('2026-03-14T06:00:00Z')) {
  const user = await UserModel.create({
    email: `${new Types.ObjectId().toString()}@example.com`,
    name: 'Test',
    timezone: IST,
    passwordHash: 'x',
  });
  // `timestamps: true` sets createdAt on insert, so override it explicitly.
  await UserModel.updateOne({ _id: user._id }, { $set: { createdAt } });
  return { id: user._id.toString(), timezone: IST };
}

async function seedDay(
  userId: string,
  localDate: string,
  opts: {
    scheduled?: number;
    completionRate?: number;
    waterMl?: number;
    waterEntries?: number;
    calories?: number;
    foodEntries?: number;
    eventCount?: number;
  } = {},
) {
  await DailySummaryModel.create({
    userId: new Types.ObjectId(userId),
    localDate,
    expenses: { totalMinor: 0, count: 0, byCategory: {}, largestMinor: null },
    habits: {
      scheduled: opts.scheduled ?? 2,
      completed: 0,
      completionRate: opts.completionRate ?? 1,
      completedIds: [],
      missedIds: [],
    },
    nutrition: {
      totals: { calories: opts.calories ?? 0, proteinG: 0, carbsG: 0, fatG: 0 },
      entryCount: opts.foodEntries ?? 0,
      calorieTarget: 2000,
    },
    water: {
      totalMl: opts.waterMl ?? 0,
      targetMl: 2500,
      entryCount: opts.waterEntries ?? 0,
    },
    activity: { steps: null, workoutMinutes: null, sleepMinutes: null },
    context: {
      weekday: 0,
      calendarEventCount: 0,
      lastCalendarEventEndMin: null,
      weatherCondition: null,
    },
    eventCount: opts.eventCount ?? 3,
    sources: [],
    generatedAt: new Date(),
  });
}

describe('monthSummaryFor', () => {
  it('returns a payload matching the wire contract', async () => {
    const user = await makeUser();
    await seedDay(user.id, '2026-07-18');

    const result = await monthSummaryFor(user, '2026-07', '2026-08-01');

    expect(() => monthSummaryResponseSchema.parse(result)).not.toThrow();
    expect(result.month).toBe('2026-07');
  });

  it('omits days with no summary rather than reporting them as zero', async () => {
    const user = await makeUser();
    await seedDay(user.id, '2026-07-18');
    await seedDay(user.id, '2026-07-20');

    const result = await monthSummaryFor(user, '2026-07', '2026-08-01');

    expect(result.days.map((d) => d.localDate)).toEqual(['2026-07-18', '2026-07-20']);
    expect(result.days.some((d) => d.localDate === '2026-07-19')).toBe(false);
  });

  it('scores each day with the shared flow computation', async () => {
    const user = await makeUser();
    // habits 100, water 50, nutrition inactive (no entries) -> 75
    await seedDay(user.id, '2026-07-18', {
      completionRate: 1,
      waterMl: 1250,
      waterEntries: 2,
    });

    const result = await monthSummaryFor(user, '2026-07', '2026-08-01');

    expect(result.days[0]?.percent).toBe(75);
  });

  it('excludes domains the user does not track', async () => {
    const user = await makeUser();
    await UserPreferenceModel.create({
      userId: new Types.ObjectId(user.id),
      trackedDomains: ['habits'],
    });
    // Water at 0 would drag this down if it counted.
    await seedDay(user.id, '2026-07-18', {
      completionRate: 1,
      waterMl: 0,
      waterEntries: 4,
    });

    const result = await monthSummaryFor(user, '2026-07', '2026-08-01');

    expect(result.days[0]?.percent).toBe(100);
  });

  it('never returns a day in the future', async () => {
    const user = await makeUser();
    await seedDay(user.id, '2026-07-18');
    await seedDay(user.id, '2026-07-30'); // after the "today" we pass in

    const result = await monthSummaryFor(user, '2026-07', '2026-07-20');

    expect(result.days.map((d) => d.localDate)).toEqual(['2026-07-18']);
  });

  it('reports account creation, in the user timezone, as the earliest date', async () => {
    // 2026-03-13T20:00Z is already the 14th in IST (+5:30).
    const user = await makeUser(new Date('2026-03-13T20:00:00Z'));

    const result = await monthSummaryFor(user, '2026-07', '2026-08-01');

    expect(result.earliestLocalDate).toBe('2026-03-14');
  });

  it('returns an empty month rather than an error for a month with no data', async () => {
    const user = await makeUser();

    const result = await monthSummaryFor(user, '2026-05', '2026-08-01');

    expect(result.days).toEqual([]);
    expect(result.stats).toEqual({ avgPercent: 0, daysLogged: 0, bestFlowRun: 0 });
  });

  it('does not leak another user’s days', async () => {
    const mine = await makeUser();
    const theirs = await makeUser();
    await seedDay(theirs.id, '2026-07-18');

    const result = await monthSummaryFor(mine, '2026-07', '2026-08-01');

    expect(result.days).toEqual([]);
  });

  it('computes stats over the returned days', async () => {
    const user = await makeUser();
    await seedDay(user.id, '2026-07-01', { completionRate: 1 }); // 100
    await seedDay(user.id, '2026-07-02', { completionRate: 1 }); // 100
    await seedDay(user.id, '2026-07-04', { completionRate: 0 }); // 0

    const result = await monthSummaryFor(user, '2026-07', '2026-08-01');

    expect(result.stats).toEqual({ avgPercent: 67, daysLogged: 3, bestFlowRun: 2 });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @synitheia/api test summary/routes`
Expected: FAIL — `Failed to resolve import "./routes.js"`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/modules/summary/routes.ts`:

```ts
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
```

- [ ] **Step 4: Register the routes**

In `apps/api/src/app.ts`, add the import beside the other module imports:

```ts
import { registerSummaryRoutes } from './modules/summary/routes.js';
```

and the registration immediately after `await registerTodayRoutes(api);`:

```ts
      await registerSummaryRoutes(api);
```

- [ ] **Step 5: Drop the duplicated tracked-domains literal**

In `apps/api/src/modules/today/routes.ts`, add `DEFAULT_TRACKED_DOMAINS` to the `@synitheia/shared` import and replace the inline fallback array in the `const tracked = new Set(...)` expression with it. The behaviour is identical; the list now exists once.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `pnpm --filter @synitheia/api test`
Expected: PASS, including the pre-existing Today tests.

- [ ] **Step 7: Verify the route by hand**

Start Mongo and the API, then:

```bash
pnpm db:up
pnpm api
# in another shell, with a token from POST /auth/login:
curl -s -H "Authorization: Bearer $TOKEN" \
  'http://localhost:3000/summary/month?month=2026-07' | jq
```

Expected: a `{ month, earliestLocalDate, days, stats }` object. A malformed `month` (e.g. `2026-7`) returns 400.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): GET /summary/month for the History grid"
```

---

## Task 6: Flow tint (mobile)

**Files:**
- Modify: `apps/mobile/src/theme/tokens.ts`
- Test: `apps/mobile/src/theme/tokens.test.ts`

**Interfaces:**
- Produces: `flowTint(percent: number): { background: string; text: string }`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/theme/tokens.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { flowTint, palette } from './tokens.js';

describe('flowTint', () => {
  it('gives a full day the solid sage anchor with white text', () => {
    expect(flowTint(100)).toEqual({ background: palette.sage, text: palette.white });
    expect(flowTint(85)).toEqual({ background: palette.sage, text: palette.white });
  });

  it('flips to white text only once the fill is dark enough to carry it', () => {
    expect(flowTint(70).text).toBe(palette.white);
    expect(flowTint(50).text).toBe(palette.stone);
  });

  it('gives a logged-but-zero day a visible fill, distinct from an empty cell', () => {
    const zero = flowTint(0);
    expect(zero.background).toBe(palette.sand);
    expect(zero.background).not.toBe('transparent');
  });

  it('is monotonic — a better day is never a lighter tint', () => {
    const steps = [0, 20, 45, 70, 95].map((p) => flowTint(p).background);
    expect(new Set(steps).size).toBe(5);
  });

  it('clamps out-of-range input rather than throwing', () => {
    expect(flowTint(-10)).toEqual(flowTint(0));
    expect(flowTint(999)).toEqual(flowTint(100));
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @synitheia/mobile test tokens`
Expected: FAIL — `flowTint is not exported`.

- [ ] **Step 3: Write the implementation**

In `apps/mobile/src/theme/tokens.ts`, add below `accentFor`:

```ts
/**
 * A day's flow percentage as a calendar cell fill.
 *
 * Five steps rather than a continuous ramp: a smooth gradient across 31 cells is
 * impossible to read comparatively, and the eye only needs "was this a strong day"
 * at a glance. Text flips to white at the point the sage fill is dark enough to
 * carry it, so contrast holds at both ends of the scale.
 *
 * The lowest step is sand, NOT transparent. A day logged at 0% and a day with
 * nothing logged at all are different statements; the grid draws the latter as a
 * hollow outline and must never reuse this fill for it.
 */
export function flowTint(percent: number): { background: string; text: string } {
  const clamped = Math.min(100, Math.max(0, percent));

  if (clamped >= 85) return { background: palette.sage, text: palette.white };
  if (clamped >= 65) return { background: 'rgba(125, 146, 125, 0.74)', text: palette.white };
  if (clamped >= 40) return { background: 'rgba(125, 146, 125, 0.46)', text: palette.stone };
  if (clamped >= 15) return { background: 'rgba(125, 146, 125, 0.24)', text: palette.stone };
  return { background: palette.sand, text: palette.stoneMuted };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm --filter @synitheia/mobile test tokens`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/theme/tokens.ts apps/mobile/src/theme/tokens.test.ts
git commit -m "feat(mobile): flowTint scale for the History grid"
```

---

## Task 7: The month grid component (mobile)

**Files:**
- Create: `apps/mobile/src/components/MonthGrid.tsx`

**Interfaces:**
- Consumes: `monthGridCells`, `MonthKey`, `LocalDate`, `MonthDay` from `@synitheia/shared`; `flowTint`, `palette`, `radius`, `spacing`, `MIN_TAP_TARGET` from `../theme/tokens.js`; `Text`, `Touchable` from `./primitives.js`
- Produces:

```ts
interface MonthGridProps {
  month: MonthKey;
  days: readonly MonthDay[];
  /** The user's today, so the current day can be marked and later days disabled. */
  today: LocalDate;
  onSelect: (localDate: LocalDate) => void;
}
export function MonthGrid(props: MonthGridProps): JSX.Element
```

- [ ] **Step 1: Write the component**

Create `apps/mobile/src/components/MonthGrid.tsx`:

```tsx
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  formatDayLabel,
  monthGridCells,
  type LocalDate,
  type MonthDay,
  type MonthKey,
} from '@synitheia/shared';
import { Text, Touchable } from './primitives.js';
import { MIN_TAP_TARGET, flowTint, palette, radius, spacing } from '../theme/tokens.js';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

interface MonthGridProps {
  month: MonthKey;
  days: readonly MonthDay[];
  today: LocalDate;
  onSelect: (localDate: LocalDate) => void;
}

/**
 * The month as a Monday-anchored grid of days, tinted by that day's flow.
 *
 * Purely presentational — it fetches nothing and owns no selection state. Three
 * distinct cell states, and conflating any two of them would be a lie:
 *
 *   null cell   — not a date in this month. Empty space.
 *   hollow cell — a real date with nothing logged. Outline only.
 *   tinted cell — a real date with a real percentage.
 */
export function MonthGrid({ month, days, today, onSelect }: MonthGridProps) {
  const cells = useMemo(() => monthGridCells(month), [month]);

  const byDate = useMemo(
    () => new Map(days.map((d) => [d.localDate as string, d])),
    [days],
  );

  return (
    <View>
      <View style={styles.row}>
        {WEEKDAYS.map((label, i) => (
          <View key={`${label}-${i}`} style={styles.cell}>
            <Text variant="caption" color={palette.stoneFaint}>
              {label}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((localDate, i) => {
          if (localDate === null) {
            return <View key={`blank-${i}`} style={styles.cell} />;
          }

          const day = byDate.get(localDate);
          const isToday = localDate === today;
          const isFuture = localDate > today;
          const tint = day ? flowTint(day.percent) : null;

          const label = formatDayLabel(localDate);
          const description = isFuture
            ? `${label}, hasn't happened yet`
            : day
              ? `${label}, ${day.percent} percent`
              : `${label}, nothing logged`;

          return (
            <Touchable
              key={localDate}
              accessibilityRole="button"
              accessibilityLabel={description}
              accessibilityState={{ disabled: isFuture }}
              accessibilityHint={isFuture ? undefined : 'Opens this day'}
              haptic={false}
              disabled={isFuture}
              onPress={() => onSelect(localDate)}
              style={styles.cell}
            >
              <View
                style={[
                  styles.day,
                  tint ? { backgroundColor: tint.background } : styles.hollow,
                  isToday && styles.today,
                ]}
              >
                <Text
                  variant="caption"
                  color={
                    isFuture
                      ? palette.surfaceDim
                      : (tint?.text ?? palette.stoneMuted)
                  }
                >
                  {Number(localDate.slice(8, 10))}
                </Text>
              </View>
            </Touchable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    // Seven per row, and the aspect ratio keeps every cell square at any width.
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    padding: spacing.xs / 2,
  },
  day: {
    flex: 1,
    alignSelf: 'stretch',
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hollow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.surfaceDim,
  },
  today: {
    borderWidth: 1.5,
    borderColor: palette.sageSoft,
  },
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @synitheia/mobile typecheck`
Expected: PASS. If `Touchable` does not accept `disabled`, read `apps/mobile/src/components/primitives.tsx:109` and use whatever the existing prop is — do not add a new one.

- [ ] **Step 3: Lint**

Run: `pnpm --filter @synitheia/mobile lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/MonthGrid.tsx
git commit -m "feat(mobile): MonthGrid calendar component"
```

---

## Task 8: The read-only day screen (mobile)

Read the "Deviation from the spec" section above before starting: the streak and XP chips are deliberately **not** on this screen, because `/today?localDate=` returns current values for both.

**Files:**
- Create: `apps/mobile/app/day/[date].tsx`
- Modify: `apps/mobile/src/components/HabitCard.tsx`, `apps/mobile/app/_layout.tsx`

**Interfaces:**
- Consumes: `GET /today?localDate=<LocalDate>` → `TodayResponse`; `ProgressRing`, `Timeline`, `HabitCard`, primitives
- Produces: route `/day/:date`; `HabitCard` gains `readOnly?: boolean`

- [ ] **Step 1: Make HabitCard read-only-capable**

In `apps/mobile/src/components/HabitCard.tsx`, extend the props:

```ts
interface HabitCardProps {
  habit: TodayHabit;
  /** Opens the habit's detail screen. */
  onPress: (habit: TodayHabit) => void;
  /** Logs one occurrence. The parent owns the optimistic update. */
  onLog: (habit: TodayHabit) => void;
  /**
   * A past day. The affordance becomes a status glyph rather than a control —
   * history is a record, and a tappable checkbox on a finished day would be an
   * invitation to rewrite it.
   */
  readOnly?: boolean;
}
```

Destructure `readOnly = false` in the signature. Then:

- On the outer `Touchable`, pass `accessibilityHint={readOnly ? undefined : 'Opens this habit'}`.
- Replace the inner affordance `Touchable`'s `onPress` with:

```tsx
            onPress={() => {
              if (!readOnly && !habit.todayComplete) onLog(habit);
            }}
```

- Change its `accessibilityRole` to `readOnly ? 'text' : 'checkbox'` and its label, when `readOnly`, to `` `${habit.name} ${habit.todayComplete ? 'was completed' : 'was not completed'}` ``.
- Wrap the `Plus` icon so it never renders in read-only mode — a `+` on a past day promises an action that does nothing:

```tsx
              {isCounter && !readOnly ? (
                <Animated.View style={plusStyle}>
                  <Plus size={20} color={accent.base} strokeWidth={2} />
                </Animated.View>
              ) : null}
```

- [ ] **Step 2: Write the day screen**

Create `apps/mobile/app/day/[date].tsx`:

```tsx
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react-native';
import {
  asMinor,
  formatDayLabel,
  formatMoney,
  isLocalDate,
  type LocalDate,
  type TodayResponse,
} from '@synitheia/shared';
import {
  Card,
  EmptyState,
  ErrorState,
  SectionHeader,
  Text,
  Touchable,
} from '../../src/components/primitives.js';
import { SkeletonScreen } from '../../src/components/Skeleton.js';
import { ProgressRing } from '../../src/components/ProgressRing.js';
import { HabitCard } from '../../src/components/HabitCard.js';
import { Timeline } from '../../src/components/Timeline.js';
import { api } from '../../src/api/client.js';
import { useAuth } from '../../src/store/auth.js';
import { MIN_TAP_TARGET, palette, spacing } from '../../src/theme/tokens.js';

/**
 * One past day, as a record.
 *
 * Nothing here mutates. The only tappable things are timeline rows, which deep-link
 * into the underlying expense or habit — that is where editing already lives, and
 * routing corrections through it keeps streaks and XP honest.
 *
 * Note what is deliberately absent: the streak and XP chips from Today. /today
 * returns those from the account's CURRENT state regardless of localDate, so
 * rendering them here would assert something false about this day. The spend /
 * water / calories row below is date-accurate and says more anyway.
 */
export default function Day() {
  const params = useLocalSearchParams<{ date: string }>();
  const user = useAuth((s) => s.user);

  const date = typeof params.date === 'string' ? params.date : '';
  const valid = isLocalDate(date);

  const query = useQuery({
    // A key of its own. Sharing Today's bare ['today'] key would let a past day
    // overwrite the live home screen in the cache.
    queryKey: ['day', date],
    queryFn: () => api.get<TodayResponse>(`/today?localDate=${date}`),
    enabled: valid,
  });

  const data = query.data;

  const totals = useMemo(() => {
    if (!data) return null;
    return [
      formatMoney(asMinor(data.expenses.totalMinor), user?.currency ?? 'INR'),
      `${data.water.totalMl} ml`,
      `${Math.round(data.nutrition.totals.calories)} kcal`,
    ].join('  ·  ');
  }, [data, user?.currency]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Touchable
          accessibilityRole="button"
          accessibilityLabel="Back"
          haptic={false}
          onPress={() => router.back()}
          style={styles.back}
        >
          <ChevronLeft size={24} color={palette.stone} strokeWidth={1.8} />
        </Touchable>
        <Text variant="overline" color={palette.stone}>
          {valid ? formatDayLabel(date as LocalDate) : 'Unknown day'}
        </Text>
      </View>

      {!valid ? (
        <ErrorState message="That isn't a real date." onRetry={() => router.back()} />
      ) : query.isPending ? (
        <SkeletonScreen rows={4} />
      ) : query.isError ? (
        <ErrorState
          message="Couldn't load this day."
          onRetry={() => void query.refetch()}
        />
      ) : !data ? null : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.ring}>
            <ProgressRing percent={data.dailyFlow.percent} />
          </View>

          {totals ? (
            <Card style={styles.totals}>
              <Text variant="bodyMedium" color={palette.stoneMuted}>
                {totals}
              </Text>
            </Card>
          ) : null}

          {data.habits.length > 0 ? (
            <>
              <SectionHeader title="Habits" />
              {data.habits.map((habit) => (
                <HabitCard
                  key={habit.id}
                  habit={habit}
                  readOnly
                  onPress={() => router.push(`/habit/${habit.id}`)}
                  onLog={() => undefined}
                />
              ))}
            </>
          ) : null}

          <SectionHeader title="Timeline" />
          {data.timeline.length > 0 ? (
            <Timeline events={data.timeline} timezone={user?.timezone ?? 'UTC'} />
          ) : (
            <EmptyState
              title="Nothing logged"
              body="No habits, expenses, or meals were recorded on this day."
            />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: palette.bone,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.base,
  },
  back: {
    minWidth: MIN_TAP_TARGET,
    minHeight: MIN_TAP_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -spacing.md,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  ring: {
    alignItems: 'center',
    marginVertical: spacing.xl,
  },
  totals: {
    alignItems: 'center',
    marginBottom: spacing.base,
  },
});
```

If `EmptyState`, `SectionHeader`, `Card`, or `ErrorState` take different prop names, read `apps/mobile/src/components/primitives.tsx` and match the existing signatures rather than changing the primitives.

- [ ] **Step 3: Register the route**

In `apps/mobile/app/_layout.tsx`, add inside the `<Stack>`, beside the other secondary screens:

```tsx
                <Stack.Screen name="day/[date]" />
```

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm --filter @synitheia/mobile typecheck && pnpm --filter @synitheia/mobile lint`
Expected: PASS.

- [ ] **Step 5: Verify on a device**

With the API running and a dev client installed:

```bash
pnpm mobile
# then, in another shell:
npx uri-scheme open "synitheia://day/2026-07-18" --ios
```

Expected: the day screen opens with the date in the header. Confirm by hand:
- no habit checkbox responds to a tap
- a timeline row navigates to the underlying expense or habit
- `synitheia://day/not-a-date` shows "That isn't a real date." rather than crashing

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/app/day apps/mobile/app/_layout.tsx apps/mobile/src/components/HabitCard.tsx
git commit -m "feat(mobile): read-only day screen"
```

---

## Task 9: The History screen and its entry point (mobile)

**Files:**
- Create: `apps/mobile/app/history.tsx`
- Modify: `apps/mobile/app/_layout.tsx`, `apps/mobile/app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `GET /summary/month?month=<MonthKey>` → `MonthSummaryResponse`; `MonthGrid`; `addMonths`, `monthKeyOf`, `formatMonthLabel`, `todayLocalDate`
- Produces: route `/history`; a calendar button in the Today header

- [ ] **Step 1: Write the History screen**

Create `apps/mobile/app/history.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import {
  addMonths,
  formatMonthLabel,
  monthKeyOf,
  todayLocalDate,
  type LocalDate,
  type MonthKey,
  type MonthSummaryResponse,
} from '@synitheia/shared';
import {
  Card,
  EmptyState,
  ErrorState,
  SectionHeader,
  Text,
  Touchable,
} from '../src/components/primitives.js';
import { SkeletonScreen } from '../src/components/Skeleton.js';
import { MonthGrid } from '../src/components/MonthGrid.js';
import { api } from '../src/api/client.js';
import { useAuth } from '../src/store/auth.js';
import { MIN_TAP_TARGET, flowTint, palette, radius, spacing } from '../src/theme/tokens.js';

function monthQuery(month: MonthKey) {
  return {
    queryKey: ['month', month] as const,
    queryFn: () => api.get<MonthSummaryResponse>(`/summary/month?month=${month}`),
  };
}

export default function History() {
  const user = useAuth((s) => s.user);
  const timezone = user?.timezone ?? 'UTC';
  const today = todayLocalDate(timezone);

  const [month, setMonth] = useState<MonthKey>(() => monthKeyOf(today));
  const queryClient = useQueryClient();

  const query = useQuery(monthQuery(month));
  const data = query.data;

  /**
   * The previous month is almost always the next tap. Prefetching it means the back
   * arrow paints instantly instead of flashing a skeleton for a month the user has
   * already lived through.
   */
  useEffect(() => {
    void queryClient.prefetchQuery(monthQuery(addMonths(month, -1)));
  }, [month, queryClient]);

  const atEarliest =
    data != null && month <= monthKeyOf(data.earliestLocalDate as LocalDate);
  const atLatest = month >= monthKeyOf(today);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Touchable
          accessibilityRole="button"
          accessibilityLabel="Back"
          haptic={false}
          onPress={() => router.back()}
          style={styles.iconButton}
        >
          <ChevronLeft size={24} color={palette.stone} strokeWidth={1.8} />
        </Touchable>
        <Text variant="heading">History</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.monthBar}>
          <Touchable
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            accessibilityState={{ disabled: atEarliest }}
            disabled={atEarliest}
            haptic={false}
            onPress={() => setMonth(addMonths(month, -1))}
            style={styles.iconButton}
          >
            <ChevronLeft
              size={20}
              color={atEarliest ? palette.surfaceDim : palette.stoneMuted}
              strokeWidth={1.8}
            />
          </Touchable>

          <Text variant="section">{formatMonthLabel(month)}</Text>

          <Touchable
            accessibilityRole="button"
            accessibilityLabel="Next month"
            accessibilityState={{ disabled: atLatest }}
            disabled={atLatest}
            haptic={false}
            onPress={() => setMonth(addMonths(month, 1))}
            style={styles.iconButton}
          >
            <ChevronRight
              size={20}
              color={atLatest ? palette.surfaceDim : palette.stoneMuted}
              strokeWidth={1.8}
            />
          </Touchable>
        </View>

        {query.isPending ? (
          <SkeletonScreen rows={5} showLeading={false} />
        ) : query.isError ? (
          <ErrorState
            message="Couldn't load this month."
            onRetry={() => void query.refetch()}
          />
        ) : !data ? null : (
          <>
            <MonthGrid
              month={month}
              days={data.days}
              today={today}
              onSelect={(localDate) => router.push(`/day/${localDate}`)}
            />

            <View style={styles.legend}>
              <Text variant="caption" color={palette.stoneFaint}>
                less
              </Text>
              {[10, 45, 70, 100].map((percent) => (
                <View
                  key={percent}
                  style={[
                    styles.swatch,
                    { backgroundColor: flowTint(percent).background },
                  ]}
                />
              ))}
              <Text variant="caption" color={palette.stoneFaint}>
                more
              </Text>
            </View>

            {data.days.length === 0 ? (
              <EmptyState
                title={`Nothing logged in ${formatMonthLabel(month)}`}
                body="Days you track will show up here."
              />
            ) : (
              <>
                <SectionHeader title={`${formatMonthLabel(month)} at a glance`} />
                <View style={styles.stats}>
                  <Stat value={`${data.stats.avgPercent}%`} label="avg flow" />
                  <Stat value={String(data.stats.daysLogged)} label="days logged" />
                  <Stat value={String(data.stats.bestFlowRun)} label="best run" />
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <Card style={styles.stat}>
      <Text variant="heading">{value}</Text>
      <Text variant="caption" color={palette.stoneFaint}>
        {label}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: palette.bone,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.base,
  },
  iconButton: {
    minWidth: MIN_TAP_TARGET,
    minHeight: MIN_TAP_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  swatch: {
    width: 14,
    height: 14,
    borderRadius: radius.sm / 2,
  },
  stats: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
  },
});
```

- [ ] **Step 2: Register the route**

In `apps/mobile/app/_layout.tsx`, beside the other secondary screens:

```tsx
                <Stack.Screen name="history" />
```

- [ ] **Step 3: Add the entry point to Today**

In `apps/mobile/app/(tabs)/index.tsx`:

- Add `CalendarDays` to the `lucide-react-native` import.
- In the header `View` (around line 215), between the avatar `Touchable` and the bell `Touchable`, wrap the two right-hand buttons in a row and add the calendar button:

```tsx
          <View style={styles.headerActions}>
            <Touchable
              accessibilityRole="button"
              accessibilityLabel="History"
              accessibilityHint="Browse past days"
              haptic={false}
              onPress={() => router.push('/history')}
              style={styles.iconButton}
            >
              <CalendarDays size={22} color={palette.stone} strokeWidth={1.6} />
            </Touchable>

            <Touchable
              accessibilityRole="button"
              accessibilityLabel="Reminders and notifications"
              haptic={false}
              onPress={() => router.push('/reminders')}
              style={styles.iconButton}
            >
              <Bell size={22} color={palette.stone} strokeWidth={1.6} />
            </Touchable>
          </View>
```

- Add to the `StyleSheet.create` block:

```ts
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
```

Check `styles.header` — if it uses `justifyContent: 'space-between'` the new row slots in without further change.

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm --filter @synitheia/mobile typecheck && pnpm --filter @synitheia/mobile lint`
Expected: PASS.

- [ ] **Step 5: Verify the whole flow on a device**

With the API running:

```bash
pnpm mobile
```

Walk through it and confirm each of these by hand:
- The calendar icon appears on Today and opens History.
- The current month renders with today marked by a dashed ring.
- Days with data are tinted; days without are hollow outlines; future days are greyed and do not respond to a tap.
- `‹` pages back and greys out at the month you created the account; `›` greys out on the current month.
- Tapping a day with data opens that day and the ring matches the tint you tapped.
- Tapping a hollow day opens a day screen that says "Nothing logged".
- Log a habit on Today, return to History: today's cell reflects the new percentage (this is the Task 4 invalidation working end to end).

- [ ] **Step 6: Run the full gate**

Run: `pnpm check`
Expected: typecheck, lint, and every test PASS across all packages.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/app
git commit -m "feat(mobile): History screen with month heat-map"
```

---

## Task 10: Reconcile the spec

**Files:**
- Modify: `docs/superpowers/specs/2026-08-01-history-calendar-design.md`

- [ ] **Step 1: Correct the day-screen description**

In the `app/day/[date].tsx` section, replace the streak/XP chips bullet with the spend · water · calories row, and add a short note explaining why: `/today?localDate=` returns `xp` and `streakDays` as current account state, not as-of-date, so rendering them on a past day would assert something false.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-08-01-history-calendar-design.md
git commit -m "docs: correct the day-screen chips in the History spec"
```

---

## Self-review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| History screen, Monday-anchored month grid | 1, 7, 9 |
| Cells tinted by Daily Flow % | 3, 6, 7 |
| Hollow cell for "nothing logged", never 0% | 3 (absent from `days`), 7 (hollow render) |
| Today marked, future days unpressable | 7 |
| Legend + "{Month} at a glance" (avg flow, days logged, best run) | 3, 9 |
| `‹` stops at account creation | 3, 5, 9 |
| Read-only day screen with full day | 8 |
| Timeline rows deep-link to the record | 8 |
| Reuse `ProgressRing` / `HabitCard` / `Timeline`; `HabitCard` gains `readOnly` | 8 |
| `GET /summary/month` shape, absent days, stats arithmetic | 3, 5 |
| Same `computeDailyFlow` + `trackedDomains` as Today | 3, 5 |
| Rejected alternatives documented | 5 (route doc comment) |
| Invalidate `DailySummary` on habit/water/nutrition writes | 4 |
| `LocalDate` everywhere; `formatOverline` moved to shared | 2 |
| `['day', date]` and `['month', key]` query keys; prefetch previous month | 8, 9 |
| Loading / error / empty states | 8, 9 |
| `flowTint` with contrast flip | 6 |
| Tap targets ≥ `MIN_TAP_TARGET`, accessibility labels | 7 |
| Tests: month-grid, route, invalidation, stats | 1, 3, 4, 5 |
| No snapshot tests | — (none written) |

Two spec items are handled as deliberate deviations, both documented above and reconciled in Task 10: the **streak/XP chips** are dropped from the day screen (the API returns current, not historical, values), and **horizontal swipe between days** is left out — it is a gesture-handler addition with no test surface, and the back-arrow-to-grid path covers the need. Add it later if it is missed.

**Placeholders:** none. Every code step carries the code; every test step carries the assertions and the exact command with its expected result.

**Type consistency:** `MonthKey`, `LocalDate`, `MonthDay`, `MonthStats`, `MonthSummaryResponse`, `FlowSummaryInput` are defined in Tasks 1 and 3 and used with those exact names in Tasks 5, 7, 8, and 9. `flowPercentForSummary`, `monthStats`, `monthGridCells`, `addMonths`, `monthKeyOf`, `formatMonthLabel`, `formatDayLabel`, `flowTint`, and `invalidateDailySummary` each appear with one spelling and one signature throughout.
