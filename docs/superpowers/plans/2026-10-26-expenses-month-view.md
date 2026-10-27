# Expenses Month View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expenses opens on the month's total, a spending calendar and "Mostly to", with a lighter list of every payment below, easing in.

**Architecture:** The API's month totals gain `byDay` and `topPayees`, so the calendar and payees agree with the total past the list's 200 cap. Pure helpers in `apps/mobile/src/expenses/` do the comparison wording, calendar cells and amounts; small components draw them; the screen composes them and keys the animated part by month so the easing replays only on a month change. upi-lens learns two payee names.

**Tech Stack:** Expo SDK 54, React Native 0.81, Reanimated 4.1 (entering animations, `useReducedMotion`), TanStack Query 5, Vitest; Fastify 5 / Mongoose 8; upi-lens-api (Express, Vitest).

**Spec:** `docs/superpowers/specs/2026-10-26-expenses-month-view-design.md`

## Global Constraints

- No new native modules; Reanimated 4 and react-native-svg are already installed.
- Every tappable thing at least 44 pt; screen-reader labels for the total, each day and each payee.
- With Reduce Motion on, everything appears in its final state.
- Amounts: the total in whole rupees; payments with paise only when they have some; payees with the existing `formatMoneyCompact`.
- Nothing is pushed, deployed or released without the user's go-ahead (merging was approved).

## Review Focus

1. An empty month: "₹0", no comparison line, plain squares, the existing empty state. Tests in Task 2.
2. The current month: days still to come are dim and do nothing; the comparison counts the previous month up to the same day, clamped to its length. Tests in Task 2.
3. One huge day (rent) must not wash out the rest: a ₹100 day beside a ₹49,372 day still shows. Test in Task 2.
4. A payment with no payee is grouped under its category name, and a repaid split counts net everywhere. Tests in Task 1.
5. An API that has not been redeployed yet answers without `byDay`/`topPayees`: the screen shows plain squares and no "Mostly to" instead of failing. Test in Task 2.

---

### Task 1: month totals by day and by payee (API)

**Files:** Modify `apps/api/src/modules/expenses/service.ts` (`ExpenseTotals`, `totalsFor`); Create `apps/api/src/modules/expenses/totals.test.ts`.

**Interfaces — Produces:** `ExpenseTotals` gains `byDay: Record<string, number>` (net minor units per local date, only dates with expenses) and `topPayees: { name: string; totalMinor: number; count: number; categoryName: string }[]` (at most 6, by net amount descending; `name` is the merchant, or the category name when there is none).

- [ ] Test (Mongo memory server, expenses created with `createExpense`): two expenses on 2026-09-04 and one on 2026-09-19 give `byDay` with exactly those two dates and their sums; payees "Rent" ₹42,000, "Zepto" ₹200 + ₹607, and one with no merchant in Food come back as `[Rent 4200000 ×1, Zepto 80700 ×2, Food …]`; eight payees cap at 6; a ₹1,000 expense split with a repaid ₹750 share counts 25,000 in `byDay` and `topPayees`, matching `totalMinor`.
- [ ] Run, see it fail; add `localDate` and `merchant` to the projection and build both maps in the existing loop; run, see it pass; commit `feat(api): month totals by day and by payee`.

### Task 2: the month's pure helpers (mobile)

**Files:** Create `apps/mobile/src/expenses/monthView.ts`, `apps/mobile/src/expenses/monthView.test.ts`; Modify `apps/mobile/src/expenses/monthTotal.ts` (extend `WireExpenseTotals`, remove `monthSpentLine` and its test).

**Interfaces — Produces:**
- `normalizeTotals(raw: Partial<WireExpenseTotals> | undefined): WireExpenseTotals` — missing `byDay` → `{}`, `topPayees` → `[]`, numbers → 0.
- `comparisonLine(i: { thisMinor: number; previousMinor: number; previousLabel: string }): string | null` — r = this ÷ previous: < 0.5 `less than half of ${L}`; < 0.9 `less than ${L}`; ≤ 1.1 `about the same as ${L}`; < 2 `more than ${L}`; ≥ 2 `over twice ${L}`; previous 0 → null.
- `previousComparable(i: { previousByDay: Record<string, number>; previousMonth: MonthKey; ongoingDay: number | null }): { minor: number; label: string }` — finished month (`ongoingDay` null): whole month, label "September"; ongoing: days ≤ min(ongoingDay, days in previous month), label "this time in September".
- `type CalendarCell = { kind: 'blank' } | { kind: 'day'; date: LocalDate; day: number; totalMinor: number; strength: number; future: boolean }`; `calendarCells(month: MonthKey, byDay: Record<string, number>, today: LocalDate): CalendarCell[]` — Monday first, leading blanks; `strength = total ? log(1 + total) / log(1 + max) : 0`.
- `formatWhole(minor: number, currency: string): string` ("₹85,786"); `formatAmount(minor: number, currency: string): string` ("₹100", "₹397.96").

- [ ] Tests with the spec's values: every line of the comparison table (incl. exactly 0.5, 0.9, 1.1, 2) and previous 0 → null; `previousComparable` for September finished (whole of August) and October ongoing on the 31st against 30-day September (all of it, "this time in September"); `calendarCells('2026-09', …, '2026-10-26')` starts with one blank (1 Sept 2026 is a Tuesday) and has 30 days, none future; for `'2026-10'` with today `'2026-10-26'` days 27–31 are future; a 10,000 (₹100) day beside a 4,937,200 day has strength > 0.4; empty `byDay` → every strength 0; `normalizeTotals({ totalMinor: 5, count: 1 })` has `byDay {}` and `topPayees []`; `formatWhole(8578610, 'INR') === '₹85,786'`; `formatAmount(10000, 'INR') === '₹100'`, `formatAmount(39796, 'INR') === '₹397.96'`.
- [ ] Run, fail; implement; run, pass; commit `feat(mobile): the month's numbers for the Expenses screen`.

### Task 3: two payee names (upi-lens-api)

**Files:** Modify `~/Desktop/upi-lens-api/src/services/categorization.service.ts`; Test `~/Desktop/upi-lens-api/tests/merchant.test.ts`.

- [ ] Tests: `identifyMerchant('UPI/DR/627765730981/10311434/sbin/1031143482/Rent') === 'Rent'`; a digits-only payee with a filler note (`…/12345678/YESB/q1/NO REMARKS`, also `NO R`, `UPI`, `Pay`, `Paym`, `Payment`) gives `'Bank transfer'`; `identifyMerchant('DEBIT ACHDr YESB INDIAN CLEARIN') === 'Auto-debit'` and `'ACH D-INSURANCE SAMPLE'` too.
- [ ] Run, fail; implement in `identifyMerchant` (the SBI layout's last field is the note); run all upi-lens tests and `npm run build`; commit `Name account-number payees by their note, and auto-debits`. Pushing (which deploys) waits for the merge step.

### Task 4: the pieces (mobile components)

**Files:** Create `apps/mobile/src/components/CountUp.tsx`, `apps/mobile/src/expenses/MonthCalendar.tsx`, `apps/mobile/src/expenses/PayeeStrip.tsx`, `apps/mobile/src/expenses/PaymentRow.tsx`; Modify `apps/mobile/src/components/OwedBanner.tsx` (`compact?: boolean` on `BillsRow` and `OwedBanner`: no border or wash, smaller padding).

**Interfaces — Consumes:** Task 2. **Produces:**
- `CountUp({ value: string; to: number; format: (n: number) => string; variant; animate: boolean })` — counts 0 → `to` over 1,100 ms, ease-out cubic, by `requestAnimationFrame`; shows `format(to)` at once when `animate` is false or Reduce Motion is on.
- `MonthCalendar({ cells: CalendarCell[]; selected: LocalDate | null; onSelect(date: LocalDate): void; currency: string })` — 7 columns, weekday initials, squares tinted with the theme's sage at `0.14 + strength × 0.72` opacity; future days at reduced opacity and not pressable; label `"Saturday 19 September, ₹4,794, 4 payments"` (count may be omitted when unknown: `"…, ₹4,794 spent"`); entering `FadeIn` with 20 ms per day.
- `PayeeStrip({ payees: WireExpenseTotals['topPayees']; currency: string })` — avatars (first letter, tinted by category colour unless Other), first word of the name, `formatMoneyCompact`.
- `PaymentRow({ expense: WireExpense; onPress(): void })` — avatar, name (merchant ?? category), note underneath only if present, `formatAmount` right; no chevron.
- [ ] `pnpm --filter @synitheia/mobile typecheck` and `lint` clean; commit `feat(mobile): calendar, payees and lighter rows for Expenses`.

### Task 5: the screen

**Files:** Modify `apps/mobile/app/expenses/index.tsx`.

**Interfaces — Consumes:** Tasks 2 and 4; `GET /expenses/totals` for the month and the previous month.

- Remove the overline and "Expenses" heading. Order: top bar, month bar, `CountUp` total (`formatWhole`) with `comparisonLine` underneath, `MonthCalendar`, "Mostly to" label + `PayeeStrip` (hidden when empty), compact `OwedBanner` and `BillsRow`, "Every payment" groups (day header left "Sat 19", day total right with `formatAmount`), then "Showing the latest 200" when `totals.count > items.length`.
- Empty month: "₹0" without comparison, plain calendar, the existing empty state instead of payees and list.
- Easing: wrap the month-specific content in a view `key={month}` so it remounts only on a month change; payees and the first eight rows use Reanimated `FadeInDown` with 70 ms steps after the calendar; `CountUp` animates on mount only.
- Tapping a day: record each day group's y with `onLayout`, `scrollTo` it (animated) and highlight the group for 1.4 s.
- [ ] `pnpm check` green (note counts); commit `feat(mobile): Expenses eases you into the month`.

### Task 6: merge, then ask

- [ ] Merge `feature/expenses-month-view` into a branch from `origin/main` with a merge commit ("Merge branch 'feature/expenses-month-view'"); `pnpm build && pnpm check` on the result.
- [ ] Write the one-off rename script for existing expenses named "10311434" or "DEBIT ACHDr…" (dry run by default, backup first, through `updateExpense`), for the user to run with `!`.
- [ ] Ask before: pushing `main` and upi-lens `main`, deploying the API, releasing.
