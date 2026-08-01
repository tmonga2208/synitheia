# History Calendar — Design Spec

Date: 2026-08-01
Status: approved, ready for implementation plan

---

## Problem

Synítheia records a rich day — habits, spending, water, food, steps, calendar, weather —
and then throws the view of it away at midnight. The only way back to Tuesday is the
seven-bar weekly chart on Today, which shows a percentage and nothing else. A user who
wants to know *what they actually did* on a given day has no way to ask.

The data is already there. `GET /today?localDate=YYYY-MM-DD` and `GET /timeline?localDate=`
both accept an arbitrary past date and return the full day. The Today screen simply never
passes one.

## Solution

A **History** screen: a month grid tinted by each day's Daily Flow, and a read-only day
screen behind it.

Two new routes, one new endpoint, and one bug fix that the feature would otherwise
inherit.

---

## Decisions

| Question | Decision | Why |
|---|---|---|
| Placement | Dedicated History screen, not a date picker on Today | Today keeps meaning today. A month grid is scannable for patterns in a way a picker never is. |
| Day detail | Full pushed screen `day/[date]`, not an inline panel | `/today?localDate=` already returns the whole day; an inline panel would show a fraction of what's available. |
| Heat-map encodes | Daily Flow % — the same number as the ring | The calendar and the home screen must never disagree. |
| Past days | Read-only | Streaks and XP stay trustworthy if they can't be farmed retroactively, and the screen carries no mutation code to get wrong. |
| Entry point | Calendar icon in the Today header, beside the bell | The impulse to look back happens while looking at today. |

### Explicitly out of scope

- Backfilling or editing past days. Corrections go through the existing trackers.
- Switchable lenses (Habits / Spend / Water views of the same grid). One number, matching
  the ring. Revisit only if the single view proves insufficient.
- A year view, and export.

---

## Screens

### `app/history.tsx`

Root Stack, not a tab — expo-router 6 filters hidden `NativeTabs.Trigger`s out of the
native container entirely, so secondary screens live in the Stack (see the comment in
`app/(tabs)/_layout.tsx`).

- Header: `‹ History`, month title, ‹ › steppers
- Grid: Monday-anchored to match `startOfLocalWeek`. Each cell tinted by that day's Flow %.
- **Hollow cell = nothing logged.** A hairline `surfaceDim` border and no fill. Never a
  sage 0% — "no data" must not read as "you failed."
- Today: dashed `sageSoft` ring. Future days: `surfaceDim` text, unpressable.
- Legend (less → more), then "**{Month} at a glance**": avg flow, days logged, best run.
- `‹` stops at the month containing the user's account creation date. No paging into
  empty history.

### `app/day/[date].tsx`

- Header: `‹ FRIDAY, JULY 18` in `type.overline`
- Body: ring, every habit with its count and complete/missed state, a spend · water · calories row,
  then the full timeline. **Chips are deliberately absent:** `/today` returns `streakDays` and `xp`
  from the account's current state regardless of `localDate`, so rendering them would assert
  falsehoods about a past day. Making them historical would require as-of-date recomputation.
- Nothing mutates data. Habit rows are tappable to navigate to that habit's detail screen (read-only
  navigation, not editing). Timeline entries are not interactive; corrections are made through the
  relevant tracker (the habit detail screen, the expense itself, and so on).
- Horizontal swipe navigation was considered but deferred; the back-arrow-to-grid path covers the
  navigation need and sidesteps gesture-handler complexity with no test surface.
- Reuses `ProgressRing`, `HabitCard`, `Timeline`, and the primitives unchanged, except:
  `HabitCard` gains a `readOnly?: boolean` prop. In read-only mode, the Plus icon is hidden, the
  affordance stays visible but non-interactive, and tapping does nothing.

---

## API

### `GET /summary/month?month=YYYY-MM`

```ts
{
  month: '2026-07',
  earliestLocalDate: '2026-03-14',   // account creation in the user's zone; caps ‹
  days: [
    { localDate: '2026-07-18', percent: 82, eventCount: 7 },
    // ...
  ],
  stats: { avgPercent: 74, daysLogged: 21, bestFlowRun: 9 }
}
```

**Days with nothing logged are absent from the array.** The client draws them hollow.
That distinction must survive the wire: `percent: 0` and "you weren't using the app" are
different statements, and this codebase already refuses to collapse them elsewhere (see
the `steps: null` reasoning in `context/aggregator.ts`).

`month` is validated as `/^\d{4}-\d{2}$/`. A future month returns an empty `days` array
rather than an error.

**Implementation:** one call to `getSummariesBetween(userId, firstOfMonth, lastOfMonth)`
— an existing indexed range query over `DailySummary`. Each doc maps through the *same*
`computeDailyFlow` from `@synitheia/shared` that `/today` uses, with the same
`trackedDomains` gating, so the grid and the ring cannot drift.

`stats.daysLogged` is `days.length`. `stats.avgPercent` averages only the days present —
absent days do not drag the mean toward zero.

`stats.bestFlowRun` is the longest run of consecutive days present in `days` with
`percent >= 60`. It is **not** the habit streak shown in the 🔥 chip on Today, which
counts consecutive completions of a single habit. Two different numbers called "streak"
in one app is a bug waiting to be filed, so this one is labelled "best run" in the UI.

**Rejected alternatives:**

- *Loop `getDailySummary` over 28–31 days*, as the weekly chart does. Fine for 7 days;
  roughly 200 queries for a cold month.
- *A fresh Mongo aggregation over the raw collections.* Always accurate, but the flow
  math would then exist in two languages and `computeDailyFlow` would stop being the
  single source of truth.

---

## The staleness fix

`DailySummary` is a cache, and today exactly one write path invalidates it: expense
settle-up, in `modules/expenses/service.ts`. `logHabit`, water entries, and food entries
all leave a stale document behind.

This is already a live bug. Log a habit after Today has been opened once and the
**weekly chart** bar for today keeps the old percentage while the ring directly above it
moves. The heat-map reads the same cache and would show it month-wide.

**Fix:** delete the day's `DailySummary` on every write that changes flow — habit log,
water entry, nutrition entry — mirroring what settle-up already does. Three call sites.
It repairs the weekly chart at the same time.

---

## Client structure

| Unit | Responsibility | Depends on |
|---|---|---|
| `shared/time/month-grid.ts` | `monthGridCells(month)` → Monday-anchored 7×N layout with leading/trailing blanks. Pure, no React. | `local-date.ts` |
| `shared/time/format.ts` | `formatDayLabel(localDate)` — moved out of `app/(tabs)/index.tsx` | — |
| `shared/domain/summary.ts` | `monthSummaryResponseSchema` — the wire contract both sides compile against | existing |
| `src/components/MonthGrid.tsx` | Renders cells, handles press. Props: `days`, `month`, `today`, `onSelect`. Fetches nothing. | tokens, `month-grid` |
| `src/theme/tokens.ts` | `flowTint(percent)` — sage across 5 opacity steps; text flips to white only on the solid top step (≥85%) where button convention pairs white text with sage; other steps use stone text for contrast | — |
| `app/history.tsx` | Fetching, month paging, stats, empty/error/loading states | `MonthGrid` |
| `app/day/[date].tsx` | One day, read-only | `ProgressRing`, `HabitCard`, `Timeline` |

**Timezone.** Every date is a `LocalDate` anchored to the user's zone, never the device's.
`app/(tabs)/index.tsx` has a `formatOverline` helper that anchors at UTC midnight
specifically to stop a zone silently shifting the label by a day. Three screens need it
now, so it moves to `shared/time/format.ts` rather than being copy-pasted twice.

**Query keys.** Today uses a bare `['today']`. The day screen uses `['day', date]` — a
separate cache entry, so opening July 18 can never overwrite the live Today payload.
Months cache under `['month', '2026-07']`, and `history.tsx` prefetches the previous month
on mount so `‹` paints instantly.

**States.** Loading uses the existing `Skeleton` patterns; failure uses the `ErrorState`
primitive; a month with no data shows "Nothing logged in July" rather than a grid of
hollow cells with no explanation.

**Accessibility.** A 7-column grid on the narrowest supported width yields cells above
`MIN_TAP_TARGET`. Each cell carries an `accessibilityLabel` of the form
"Friday July 18, 82 percent" — or "Friday July 18, nothing logged".

---

## Testing

Vitest, matching the existing `*.test.ts` layout.

- `shared/time/month-grid.test.ts` — leading blanks, 5- vs 6-row months, leap February,
  Monday anchoring
- `api/modules/summary/routes.test.ts` — a day with no summary is absent rather than
  `percent: 0`; `percent` equals `computeDailyFlow` for the same inputs; untracked domains
  are excluded from the percentage; `earliestLocalDate` caps at account creation; a future
  month returns an empty array
- `api/modules/habits/service.test.ts` and equivalents for water and nutrition — the write
  deletes that day's `DailySummary`
- `stats` arithmetic: `avgPercent` ignores absent days; `bestFlowRun` counts only
  consecutive present days at or above 60%, and a gap day breaks the run

No snapshot tests on the grid — they would lock in pixel decisions we will want to move.
