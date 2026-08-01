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
| Heat-map encodes | Daily Flow % — the same number as the ring | The calendar and the home screen must never disagree. See "One flow builder" below for what that required. |
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
- Today: a solid 1.5px `sageSoft` border. Future days: `surfaceDim` text, unpressable.
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
  affordance stays interactive (scale animation runs on tap), the `onLog` callback is guarded so
  a tap has no effect on data, the accessibility role changes to 'text' with a past-tense label,
  and the **streak segment is dropped from the metadata line**. `currentStreak` comes from the
  habit's live state no matter which `localDate` was asked for — the same reason the chips are
  absent — so "14D Streak" under a July date is a claim about today. That day's own count is
  already in the metadata line for anything countable, and there is no honest historical streak
  to substitute, so the segment is simply omitted rather than replaced.

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

`month` is validated as `/^\d{4}-(0[1-9]|1[0-2])$/`. A future month returns an empty `days` array
rather than an error. `monthSummaryResponseSchema` is attached as the route's response
schema, so a payload that does not match the contract fails loudly instead of shipping a
`null` percent the client would render as the wrong tint.

**Implementation.** `DailySummary` is a *cache*, so "has a cached rollup" and "has data"
are different sets, and the endpoint may not conflate them in either direction.

1. `getSummariesBetween(userId, firstOfMonth, lastOfMonth)` — the existing indexed range
   query — returns whatever rollups happen to be cached.
2. Two indexed `distinct('localDate', …)` queries, over `PersonalEvent` and `HabitLog`,
   give the days the user actually recorded something on. `PersonalEvent` covers water,
   food, expenses and every passive source, which all emit; `HabitLog` covers the case it
   cannot, since an **incomplete** habit log emits no event. Both are constrained to the
   month, so the union is bounded by the month's length.
3. Days in that set with no cached rollup are built via `getDailySummary`. At most 31,
   in practice zero for a user who has been opening the app.

Step 3 is not optional. Nothing else rebuilds a month: `buildDailySummary` is reached only
from the Today route's weekly loop, which covers the requested date's week — while
invalidation is deliberately aggressive (a 7-day health sync drops a whole previous week;
editing an old expense drops that day). Without it, a week the user was at 100% renders
hollow and is excluded from `daysLogged` and `avgPercent`.

Conversely, a cached rollup is not proof a day happened. The Today route builds a rollup
for **every day of the requested week on every load**, so merely opening the app — or
browsing one past day, which builds its whole week — writes all-zero documents. Every day
is therefore filtered through `hasAnyActivity` from `@synitheia/shared` before it reaches
`days`: habits scheduled or completed, water entries, food entries, expenses, or passive
events. A habit that was **scheduled and missed** counts — that is a zero the user earned
— but a day with none of the above is absent, not a sand-tinted "0 percent".

Each surviving doc is scored through `flowPercentForSummary`, with the user's
`trackedDomains` gating. `DailySummary`'s sub-documents are `Schema.Types.Mixed`, so the
lean document types as `any`; `flowInputOf`/`activityOf` in `context/aggregator.ts` read
the fields out explicitly, giving the structural contract exactly one place to be
maintained instead of type-checking against nothing.

`stats.daysLogged` is `days.length`. `stats.avgPercent` averages only the days present —
absent days do not drag the mean toward zero.

`stats.bestFlowRun` is the longest run of consecutive days present in `days` with
`percent >= 60`. It is **not** the habit streak shown in the 🔥 chip on Today, which
counts consecutive completions of a single habit. Two different numbers called "streak"
in one app is a bug waiting to be filed, so this one is labelled "best run" in the UI.

**Rejected alternatives:**

- *Loop `getDailySummary` over all 28–31 days unconditionally*, as the weekly chart does
  for its 7. Fine for a week; roughly 200 queries for a cold month. Building only the days
  the two `distinct`s say have data gets the same answer for two extra indexed queries.
- *A fresh Mongo aggregation over the raw collections.* Always accurate, but the flow
  math would then exist in two languages and `computeDailyFlow` would stop being the
  single source of truth.

---

## One flow builder

"The calendar and the ring never disagree" is a claim about *both halves* of the
computation, and only the weighting half was ever shared. `computeDailyFlow` decides how
the active components are averaged; something else decides which components are active,
and that is the half that moves the number. Three copies of it existed — the Today ring,
the weekly chart, and the History grid — and they disagreed, so a grid cell and the day
screen it opened could differ by 60 points for the same date.

**`flowComponentsForSummary(summary, trackedDomains)` in
`packages/shared/src/domain/month-summary.ts` is now the only place the activation rules
are written.** All three call it:

| | how it feeds the builder |
|---|---|
| Today ring (`modules/today/routes.ts`) | builds a `FlowSummaryInput` from the live day, then `computeDailyFlow` for the component breakdown the ring renders |
| Weekly chart (same file) | `flowPercentForSummary(flowInputOf(summary), tracked)` |
| Month grid (`modules/summary/routes.ts`) | `flowPercentForSummary(flowInputOf(summary), tracked)` |

Where the three disagreed, the rules that survived are:

- **Water and nutrition activate on `entryCount > 0`.** The ring previously had water
  unconditionally active — `waterTargetMl` always has a default, so "has a target" was
  always true — which dragged the live ring down for an untouched tracker while the same
  day's grid cell ignored it. `entryCount > 0` is the rule already argued for beside the
  nutrition component: an untouched tracker is not a failure.
- **Habits activate on `scheduled > 0`**, where `scheduled` is `scheduledOn(localDate)` —
  the habits that existed on *that* day, not the user's current list. This is what makes
  the ring for a past date equal that date's grid cell. It shifts the live ring for users
  with archived habits, which is the correction, not a regression.
- The weekly chart applied **no `trackedDomains` gating at all**; going through the shared
  builder gives it the same gating as the other two, so a habits-only user's bars are no
  longer capped by water and food they never signed up for.

Writes that move `scheduledOn()` without touching a log — `createHabit` and
`archiveHabit` — invalidate today's rollup, for the same reason the logging writes do.
Neither needs to reach further back: `scheduledOn()` excludes a habit from every day
before it was created, and keeps it on every day whose midnight precedes `archivedAt`, so
past rollups stay correct in both cases.

---

## The staleness fix

`DailySummary` is a cache, and today exactly one write path invalidates it: expense
settle-up, in `modules/expenses/service.ts`. `logHabit`, water entries, and food entries
all leave a stale document behind.

This is already a live bug. Log a habit after Today has been opened once and the
**weekly chart** bar for today keeps the old percentage while the ring directly above it
moves. The heat-map reads the same cache and would show it month-wide.

**Fix:** delete the day's `DailySummary` on every write that changes flow, mirroring what
settle-up already does — habit log, water create and delete, nutrition rebuild, expense
create/update/delete (both days when one moves), health sync, and `createHabit` /
`archiveHabit`, which change `scheduledOn()` and therefore the percentage without writing
a log at all. It repairs the weekly chart at the same time.

Aggressive invalidation is only half the story: deleting a rollup nothing rebuilds turns a
logged day hollow, which is why `GET /summary/month` builds the days it finds missing. See
the endpoint's Implementation notes above.

---

## Client structure

| Unit | Responsibility | Depends on |
|---|---|---|
| `shared/time/month-grid.ts` | `monthGridCells(month)` → Monday-anchored 7×N layout with leading/trailing blanks. Pure, no React. | `local-date.ts` |
| `shared/time/format.ts` | `formatDayLabel(localDate)` — moved out of `app/(tabs)/index.tsx` | — |
| `shared/domain/month-summary.ts` | `monthSummaryResponseSchema` — the wire contract both sides compile against — plus `flowComponentsForSummary`, `flowPercentForSummary`, `hasAnyActivity`, and `monthStats` | `domain/today.ts` |
| `src/components/MonthGrid.tsx` | Renders cells, handles press. Props: `days`, `month`, `today`, `onSelect`. Fetches nothing. | tokens, `month-grid` |
| `src/theme/tokens.ts` | `flowTint(percent)` — 5 steps: solid `sageDeep` at ≥85% with white text, then sage at 0.74 / 0.46 / 0.24 alpha with stone text, then `sand` with `stoneMuted` at 0–14% | — |
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

The date numerals are `type.caption`, i.e. **12px**, which WCAG 1.4.3 counts as normal
text at 4.5:1 rather than large text at 3:1. That is why the top band is `sageDeep` and
not `sage`: white on sage measures 3.34:1 and fails, white on sageDeep measures 4.31:1.
4.31 is still short of 4.5 — it is the best contrast any fill in this ramp reaches, and
`tokens.test.ts` pins it so a change back to `sage` is a failing test rather than a silent
regression.

---

## Testing

Vitest, matching the existing `*.test.ts` layout.

- `shared/time/month-grid.test.ts` — leading blanks, 5- vs 6-row months, leap February,
  Monday anchoring
- `api/modules/summary/routes.test.ts` — a day with no summary is absent rather than
  `percent: 0`; `percent` equals `computeDailyFlow` for the same inputs; untracked domains
  are excluded from the percentage; `earliestLocalDate` caps at account creation; a future
  month returns an empty array. Plus a `without a cached rollup` block that seeds **nothing**
  into `DailySummaryModel` and drives real services (`logHabit`, `createEntry`) instead —
  the hand-seeded tests are precisely what made the cache-miss gap invisible. And the other
  direction: a cached all-zero rollup must not appear in `days`.
- `shared/domain/month-summary.test.ts` — `hasAnyActivity` treats a scheduled-but-missed
  habit as activity and an untouched day as absent; `flowComponentsForSummary` is the one
  place activation is decided
- `api/context/aggregator.invalidation.test.ts` — every flow-changing write deletes that
  day's `DailySummary`, including `createHabit` and `archiveHabit`, which move
  `scheduledOn()` without writing a log
- `stats` arithmetic: `avgPercent` ignores absent days; `bestFlowRun` counts only
  consecutive present days at or above 60%, and a gap day breaks the run

No snapshot tests on the grid — they would lock in pixel decisions we will want to move.
