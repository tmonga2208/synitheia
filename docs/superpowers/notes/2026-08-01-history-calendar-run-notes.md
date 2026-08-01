# History Calendar — implementation run notes

Companion to `../specs/2026-08-01-history-calendar-design.md` and
`../plans/2026-08-01-history-calendar.md`.

The feature shipped in 23 commits off `origin/main` (7615fb4) across ten planned tasks
plus one whole-branch fix wave. This file records what still needs a human, what was
knowingly left undone, and the decisions that a reader of the diff alone would not be
able to reconstruct.

---

## 1. Not yet verified on a device

**Nothing in this feature has ever been rendered.** Every mobile check was typecheck,
lint, and code reading — this repo has no React Native testing library, and that scoping
decision was deliberate. The following are outstanding:

- `GET /summary/month` against a live stack with a bearer token. Note a malformed
  `month` returns **422**, not 400 — the plan text said 400, which was wrong; every
  route in this app returns 422 for query-validation failures.
- Deep-link `synitheia://day/2026-07-18`. Confirm no habit checkbox responds to a tap,
  and that `synitheia://day/not-a-date` shows the invalid-date state rather than
  crashing or fetching garbage.
- Full walkthrough: calendar icon on Today opens History; today is marked; hollow vs
  tinted vs future cells are distinguishable; `‹` stops at the account-creation month
  and `›` at the current month; tapping a day opens it with a ring matching the tint
  you tapped. Then log a habit on Today and return to History — today's cell should
  reflect the new percentage, which is the cache invalidation working end to end.

Two visual judgments nobody could make without running it:

- Future-day text uses `palette.surfaceDim` (`#DBDAD7`) — the same near-white as the
  hollow-cell border. Is it legible against bone?
- The 0% (sand) and 15–39% tiers differ by only ~5% composited luminance. Are they
  distinguishable at cell size? **If they merge, fix the legend at the same time**: it
  currently shows 4 swatches for a 5-tier scale and never explains the hollow state at
  all, which is the distinction the entire design rests on.

## 2. Follow-ups

1. **There is no `/today` route test harness at all.** The final fix wave rewrote the
   ring's input construction specifically so the home screen and the calendar agree on
   a day's percentage. That code is currently held together by a hand trace and
   nothing else — a future edit can silently re-diverge them with no failing test.
   Highest-value gap on this list.
2. Nothing tests that the summary route actually *attaches*
   `monthSummaryResponseSchema`. The serializer tests prove the schema is enforceable,
   not that the route uses it.
3. `getDailySummary`'s read-then-upsert races under the unique `{userId, localDate}`
   index. Pre-existing, but the month endpoint plus the History screen's prefetch
   widen the window for an E11000 surfacing as a 500.
4. The day screen still renders **today's** habit list rather than the habits scheduled
   on that date, so a habit created last week appears on a July row marked "not
   completed". Explicitly excluded from this branch's scope; it is the same class of
   falsehood that got the streak/XP chips removed.
5. `detectors.test.ts > possible_meal detector > "raises confidence when the pattern
   recurs"` fails on `main` and has throughout. Diagnosed in passing: it asserts `>` on
   a confidence that is clamped/rounded to 0.62 on both the lone and the recurring
   pass. Needs `>=`, or a confidence step exceeding the rounding granularity. Unrelated
   to this feature.

## 3. Known-soft edges (adjudicated, deliberately shipped)

- **A day with only passive events — health steps, weather — or only expenses is drawn
  as an earned 0% rather than hollow.** This follows from the build set: a
  `PersonalEvent` scan necessarily includes passive sources. Reversing it would hide
  days that genuinely have timeline content. This is the one direction in which "no
  data is never 0" is still soft.
- **A scheduled-but-missed day is present at 0% if a rollup happens to be cached, and
  hollow if not.** Narrow in practice — Today caches the current week, and the
  invalidation triggers that drop a past rollup themselves write events that put the
  day back in the build set. Closing it would need a per-day habits scan the endpoint
  deliberately avoids.
- **The cold-month rebuild uses a bare `Promise.all` with no concurrency limiter.** With
  the History screen prefetching the previous month, two cold months can issue ~500
  concurrent indexed queries against a 100-connection pool. It queues rather than
  fails; `p-limit(4)` is cheap insurance if it ever shows up in practice.
- **`today/routes.ts` reads the habits collection twice per load** (`listHabits` plus
  `scheduledOn`, which itself calls `listHabits`). Parallel in the fan-out, so no added
  latency — pure query waste.
- **The top tint band is 4.31:1 against white text, which is short of the 4.5:1 AA
  requirement for 12px text.** It is the best of the available options (white on
  `palette.sage` was 3.34:1; stone on sage is 4.12:1). Recorded rather than claimed as
  compliant.

## 4. Decisions worth knowing

**Past days are read-only, and the escape hatch the spec promised does not exist.** The
original spec justified read-only days by saying timeline rows deep-link into the
underlying expense or habit. They never have — `Timeline` renders event rows as plain
views, its only `Touchable` being a section expand/collapse toggle. Rather than modify a
component the live Today screen depends on, the claim was corrected: corrections are
made by opening the relevant tracker yourself.

**Streak and XP are absent from the day screen on purpose.** `GET /today?localDate=`
returns `xp` as the account's lifetime total and `streakDays` from each habit's
*current* streak — neither is computed against `localDate`. Showing them on July 18
would assert something false about July 18. The same reasoning later removed the streak
segment from `HabitCard`'s metadata line in read-only mode.

**Horizontal swipe between days was cut**, not forgotten — a gesture-handler addition
with no test surface, where back-arrow-to-grid covers the need.

**One flow builder, not three.** Sharing `computeDailyFlow` was never sufficient: the
home ring, the weekly chart, and the month grid each constructed its *inputs*
differently, so a grid cell and the day screen it opened could differ by 60+ points, and
the weekly chart applied no `trackedDomains` gating at all. All three now route through
`flowPercentForSummary`. The surviving activation rules are `entryCount > 0` for water
and nutrition, and habits *scheduled on that date* for habits. This changed the live
home screen's ring slightly for users with archived or non-daily habits — that is the
correction, not a regression.

**Cache invalidation is now the write path's job.** `DailySummary` is a cache, and
before this branch exactly one write path invalidated it (expense settle-up). Habit
logs, water, food, health steps sync, and habit create/archive all left stale documents.
This was already visible in the shipped app as a Weekly Analysis bar that disagreed with
the ring above it. Invalidation runs *before* the `emit()` call at every site, so an
emit failure cannot leave a committed write with a stale summary.

**The month endpoint builds what it needs.** Reading the cache alone was not safe:
`getSummariesBetween` never builds, and aggressive invalidation meant a Health user's
previous week would render as hollow "nothing logged" for a week they were at 100%. The
route now scans `PersonalEvent` **and** `HabitLog` for days that actually have data
(the second matters because an incomplete habit log emits no event), builds only what is
missing, and filters everything through `hasAnyActivity` so a cached all-zero day is
absent rather than tinted 0%.

## 5. Process notes

Every one of the ten task-scoped reviews came back clean. The whole-branch review then
found two Critical defects, and **both lived strictly between tasks** — one at the seam
between "invalidate the cache" and "read the cache", the other between "score a day" and
"render that day's screen". No task-scoped reviewer could have seen either, because no
single task owned the path.

Five defects originated in the plan and spec rather than in any implementation: a
missing invalidation path for health steps sync, a text-contrast pairing that failed
WCAG, two tests that did not test what their names claimed, and the timeline-deep-link
promise above. Two spec corrections had to be corrected again, having replaced a false
claim with a differently-false one.

Worth carrying into future work of this shape: brief each task to verify the *previous*
task's output rather than assume it, and add an explicit pass over the seams between
adjacent tasks before calling a branch done.
