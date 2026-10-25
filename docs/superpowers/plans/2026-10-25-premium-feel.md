# Premium Feel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every gap the 2026-10-25 audit found against "The Psychology of Premium Apps" (Tim Gabe): reminders that can be trusted and say something specific, clear handling when things go wrong, one consistent product, and a way back in for a forgotten password.

**Architecture:** Reminders move from per-screen repeating triggers to one planner (pure) plus one scheduler that cancels and re-schedules dated notifications two weeks ahead from the server's reminders and today's progress. Failures get one vocabulary: the API client classifies them, one `describeError` words them, a global toast reports failed actions, and React Query's online manager learns about connectivity from failed requests. Password reset is a code sent by email through Resend, dormant until configured.

**Tech Stack:** Expo SDK 54 / React Native 0.81 / expo-router 6 / TanStack Query 5 / zustand / Reanimated 4 / Vitest; Fastify 5 / Mongoose 8 / Zod on the API.

**Spec:** the audit in the 2026-10-25 session (items 1–8 and the smaller list), approved with "fix all". The user chose "premium" as how the app feels, not a paid tier.

## Global Constraints

- No new native modules (see memory: third-party native modules fail to link here). Expo first-party JS APIs already installed are fine.
- Every user-facing string says what happened, whether it can be taken back, and what to do next. No "Something went wrong" without a cause, no raw system text.
- "Habits", never "rituals", in user-facing copy.
- Volumes: `formatVolume` everywhere: under 1,000 ml as "750 ml", from 1,000 as litres with at most two decimals, trailing zeros dropped ("1 L", "1.25 L", "2.5 L").
- Nothing is pushed, merged, deployed or released without the user's go-ahead.

## Review Focus

1. Device clock and account timezone differ (travel): a reminder must still fire at the device's local time; "today" progress applies only when the device's date equals the account's `localDate`. Test in Task 2.
2. More than 60 planned notifications: keep the soonest 60 (iOS keeps only 64). Test in Task 2.
3. Notification permission refused, or blocked so the OS no longer asks: scheduling is skipped and the Reminders screen says so with a working way forward. Test in Task 5.
4. A request that never answers: the client gives up after 20 s (60 s for uploads) and reports it as a connection problem, not a hang. Test in Task 6.
5. Undo pressed after the screen was left: the water delete must not be committed, and leaving the screen without pressing it must still commit. Test in Task 9.

---

## Batch A: Reminders

### Task 1: `formatVolume` in shared

**Files:** Modify `packages/shared/src/domain/water.ts`; Test `packages/shared/src/domain/water.test.ts` (create if absent).

**Produces:** `formatVolume(ml: number): string`.

- [ ] Test: `formatVolume(0) === '0 ml'`, `(750) === '750 ml'`, `(999) === '999 ml'`, `(1000) === '1 L'`, `(1250) === '1.25 L'`, `(2500) === '2.5 L'`, `(1333) === '1.33 L'`.
- [ ] Run, see it fail; implement; run, see it pass; commit `feat(shared): one way to write a volume`.

### Task 2: the reminder planner (pure)

**Files:** Create `apps/mobile/src/reminders/plan.ts`, `apps/mobile/src/reminders/plan.test.ts`.

**Produces:**
```ts
export type ReminderRoute = '/' | '/water' | '/nutrition' | '/expenses/new';
export interface ReminderNotificationData extends Record<string, unknown> {
  source: 'synitheia-reminder';
  kind: ReminderKind;           // 'habit' | 'water' | 'food' | 'expense' | 'custom'
  reminderId: string | null;    // null for a habit's own reminder time
  habitId: string | null;
  route: ReminderRoute;
}
export interface PlannedNotification {
  identifier: string;           // `${reminderId ?? 'habit-' + habitId}@${YYYY-MM-DD}T${HH:mm}`
  date: Date;                   // device-local fire time
  title: string;
  body: string;                 // '' for custom
  data: ReminderNotificationData;
}
export interface PlanInput {
  now: Date;
  reminders: WireReminder[];
  today: TodayResponse | null;  // habits (with reminderTime), water, nutrition, expenses, localDate
  currency: string;
  horizonDays?: number;         // default 14
  maxNotifications?: number;    // default 60
}
export function planNotifications(input: PlanInput): PlannedNotification[]; // sorted by date
```

Rules:
- Days: from the device's today for `horizonDays` days; a day's occurrence is skipped if its time has passed. `weekdays` are 0 = Monday; empty means every day. Disabled reminders plan nothing.
- Sources: every enabled reminder, plus every habit in `today.habits` with a `reminderTime` (kind `habit`, `habitId` set, title = habit name). A `habit` reminder with `refId` is about that habit; without it, about all habits.
- State for a day: the device day equal to `today.localDate` uses `today`; any other day uses the empty state (nothing logged). Each logged change re-plans, so this stays true for everything logged on this phone.
- Skips (today only): water when `totalMl >= targetMl`; a single habit when `todayComplete`; the all-habits reminder when every habit is complete.
- Copy (title is the reminder's label, or the habit's name):
  - water: `Nothing logged yet today. ${formatVolume(target)} to go.` / `${formatVolume(total)} of ${formatVolume(target)} so far. ${formatVolume(target - total)} to go.`
  - one habit, measure `check`: `Not done yet today. Tap to tick it off.`; other measures: `${formatHabitProgress(habit, count)} so far. Tap to log more.`
  - all habits: `${done} of ${total} habits done today.` plus ` Still to do: ${first two names joined by ' and '}.`; with nothing done: `${total} habits to do today.`
  - food: `Nothing logged yet today. Tap to add what you ate.` / `${kcal} of ${target} kcal logged today. Tap to add a meal.`
  - expense: `Nothing logged yet today. Tap to add what you spent.` / `${formatMoney(total)} logged today. Tap to add another.`
  - custom: body `''`.
- Routes: water `/water`, food `/nutrition`, expense `/expenses/new`, habit and custom `/` (Today, where habits are ticked).
- Cap: sort by date, keep the first `maxNotifications`.

- [ ] Tests (each a literal expectation): weekday mapping (a Monday-only reminder plans Mondays only over 14 days); past times today skipped; disabled plans nothing; water copy for 0, 1250/2500, and skipped at 2500/2500; future-day water uses the empty copy; single-habit skip when complete; habit's own `reminderTime` produces a plan with `habitId` and the habit's name; archived habits (absent from `today`) plan nothing; all-habits copy; food, expense and custom copy; identifiers deterministic and unique; cap at 60 keeps the soonest; `today.localDate` different from the device date applies no progress (Review Focus 1).
- [ ] Run, fail; implement; run, pass; commit `feat(mobile): one planner for every reminder`.

### Task 3: the scheduler

**Files:** Create `apps/mobile/src/reminders/schedule.ts`, `apps/mobile/src/reminders/schedule.test.ts`.

**Consumes:** Task 2. **Produces:**
```ts
export async function applyPlan(plan: PlannedNotification[]): Promise<void>;
export async function refreshReminders(options?: { background?: boolean }): Promise<'scheduled' | 'no-permission' | 'signed-out' | 'failed'>;
export function requestReminderRefresh(): void;   // debounced 1500 ms, single-flight
export async function clearReminders(): Promise<void>;
```
- `applyPlan` cancels every scheduled notification whose data has `source: 'synitheia-reminder'`, or a legacy `reminderId`/`habitId` without `source` (repeating triggers from older builds), then schedules each planned one with a `DATE` trigger and its identifier. Suggestion notifications are left alone.
- `refreshReminders` fetches `/reminders` and `/today` (passing `background` through), needs permission granted (it never prompts), plans with the user's currency, applies. One run at a time; a request during a run queues one more.
- [ ] Tests with `expo-notifications` and the API mocked: legacy and current reminders are cancelled, a suggestion is kept; each plan entry is scheduled with a DATE trigger at its date; `no-permission` schedules nothing and cancels nothing; `clearReminders` cancels ours only; two overlapping refreshes run the plan twice, not concurrently.
- [ ] Commit `feat(mobile): reminders are re-planned, not set once`.

### Task 4: wiring, taps, and removal of the old scheduling

**Files:** Modify `apps/mobile/app/_layout.tsx`, `apps/mobile/src/store/auth.ts`, `apps/mobile/src/sync/backgroundTask.ts`, `apps/mobile/app/reminders.tsx` (remove `syncReminder`/`cancelFor`), `apps/mobile/app/habit/new.tsx` (remove `scheduleReminder`); Create `apps/mobile/src/reminders/route.ts` + test.

**Produces:** `routeForNotification(data: unknown): ReminderRoute | null` (suggestions return `'/'`; ours return `data.route`; anything else `null`).
- Refresh on: sign-in/hydrate to `authed`, app becoming active while authed, any successful mutation (QueryClient `MutationCache.onSuccess` → `requestReminderRefresh()`), and after the background sync task.
- `signOut` (also used by account deletion and session expiry) calls `clearReminders()` before clearing tokens.
- A tap routes with `router.push(route)` once the user is authed and set up, including the tap that cold-started the app (`Notifications.getLastNotificationResponseAsync()` once on mount).
- [ ] Tests for `routeForNotification` (water, habit, custom, suggestion, junk). Commit `feat(mobile): a reminder opens what it is about, and stops when you sign out`.

### Task 5: permission, said out loud

**Files:** Create `apps/mobile/src/reminders/permission.ts` + test; Modify `apps/mobile/app/reminders.tsx`, `apps/mobile/app/habit/new.tsx`.

**Produces:** `type NotificationAccess = 'granted' | 'ask' | 'blocked'`; `readNotificationAccess(): Promise<NotificationAccess>`; `askForNotifications(): Promise<NotificationAccess>` (prompts only when `ask`); `accessCopy(access): { title, body, action: 'ask' | 'settings' } | null`.
- Reminders screen: a card above the list when access is not `granted`: title `Reminders can't reach you`, body `Notifications are off for Synítheia, so none of these will appear.`, button `Turn on notifications` (ask) or `Open Settings` (`Linking.openSettings()`), re-read when the app becomes active. Saving a reminder while blocked shows the same card. A footnote: `Planned two weeks ahead, and refreshed whenever you open Synítheia.`
- New habit with a reminder: asks if `ask`; if `blocked`, says `The habit is saved, but notifications are off, so its reminder won't appear. Turn them on in Settings.` with an Open Settings action.
- [ ] Tests: mapping of `{granted, canAskAgain}` to access; `askForNotifications` does not prompt when blocked; `accessCopy` actions. Commit `feat(mobile): say when reminders cannot reach you`.

## Batch B: When things go wrong

### Task 6: the client knows offline from server-down

**Files:** Modify `apps/mobile/src/api/client.ts`, `apps/mobile/src/api/client.test.ts`; Create `apps/mobile/src/api/errorCopy.ts` + test.

**Produces:** `class NetworkError extends Error { reason: 'offline' | 'timeout' }`; `ApiError` gains `kind: 'server' | 'rate' | 'validation' | 'auth' | 'app'`; `describeError(error: unknown, fallback?: string): { title: string; message: string }`.
- `fetch` rejection → `NetworkError('offline')`; no answer in 20 s (60 s when the body is FormData) → `NetworkError('timeout')` via AbortController.
- Status ≥ 500 or a non-JSON error body → `kind: 'server'`; 429 → `rate`; 422 → `validation`; 401/403 → `auth`; others with the server's message → `app`.
- Copy: offline `You're offline` / `Check your connection, then try again.`; timeout `No answer from Synítheia` / `The connection is slow or down. Try again in a moment.`; server `Synítheia isn't answering` / `Our server is having trouble. Your data is safe; try again in a minute.`; rate `Slow down a little` / `Too many tries in a row. Wait a minute, then try again.`; validation `That wasn't accepted` / the server's message when it is not the generic one, else `Check what you entered and try again.`; app: title `Couldn't do that`, message = server message; unknown: title `Couldn't do that`, message = fallback ?? `Try again.`
- [ ] Tests for each mapping and both timeouts (fake timers). Commit `feat(mobile): errors say whether it is you, the network or us`.

### Task 7: connectivity and the offline banner

**Files:** Create `apps/mobile/src/api/connectivity.ts` + test, `apps/mobile/src/components/OfflineBanner.tsx`; Modify `apps/mobile/src/api/client.ts`, `apps/mobile/app/_layout.tsx`.

**Produces:** `noteNetworkFailure(): void`, `noteNetworkSuccess(): void`, `startConnectivity(probe: () => Promise<boolean>): () => void` (wires `onlineManager.setEventListener`, probes `/health` every 5 s while offline and when the app becomes active), `useIsOnline(): boolean`.
- Queries pause while offline and refetch when back (React Query defaults); mutations use `networkMode: 'always'` so a tap fails fast with a clear toast instead of waiting silently.
- Banner under the status bar while offline: `You're offline. Showing what was last loaded.`
- [ ] Tests: a network failure flips offline; a successful probe flips online; a success while offline flips online without waiting. Commit `feat(mobile): notice when the connection drops and comes back`.

### Task 8: one toast for every failed action; error screens with a cause

**Files:** Create `apps/mobile/src/feedback/toast.ts` (zustand store) + test, `apps/mobile/src/components/ToastHost.tsx`; Modify `apps/mobile/app/_layout.tsx` (MutationCache `onError`), `apps/mobile/src/components/primitives.tsx` (`ErrorState` takes `error?: unknown`), every `<ErrorState` call site, every mutation that reports its own error (`meta: { reportsOwnError: true }`).

**Produces:** `showToast(input: { message: string; tone?: 'neutral' | 'error'; action?: { label: string; onPress: () => void }; onExpire?: () => void; durationMs?: number }): string`; `dismissToast(id)`; `useToast()`.
- One toast at a time; a new one replaces the old, and the replaced one's `onExpire` runs (so a pending undo commits). Default 4 s, 6 s with an action. Announced to screen readers.
- Global: a mutation error without `meta.reportsOwnError` shows `describeError(error)` as an error toast `${title}. ${message}`.
- [ ] Tests: replace runs the previous `onExpire`; expiry runs it once; action dismisses without running it. Commit `feat(mobile): a failed tap always says so`.

### Task 9: take it back

**Files:** Modify `apps/mobile/app/water.tsx`, `apps/mobile/app/(tabs)/index.tsx`, `apps/mobile/src/components/HabitCard.tsx`, `apps/api/src/modules/habits/service.ts`, `apps/api/src/context/engine.ts`; Tests: `apps/mobile/src/feedback/undo.test.ts` for `apps/mobile/src/feedback/undo.ts`, `apps/api/src/modules/habits/untick.test.ts`.

**Produces:** `deferWithUndo(input: { message: string; apply: () => void; revert: () => void; commit: () => Promise<unknown> }): void` (apply now, show toast with Undo, commit on expiry, revert on Undo); API `retractByDedupeKey(userId, key): Promise<number>`.
- Water: the bin removes the entry at once with `Removed ${formatVolume(ml)}` + Undo; the DELETE is sent when the toast expires.
- Habits: tapping a ticked check steps it back by one step (`increment: -step`); after a tick, the toast `${name} done` offers Undo.
- API: when a log moves from complete to incomplete, the day's `habit.completed` event (`dedupeKey('manual','habit',`${habitId}:${localDate}`)`) is retracted. XP stays (awards are keyed, so ticking again does not pay twice).
- [ ] Tests: deferWithUndo commit/revert paths incl. Review Focus 5; API: tick then untick leaves no completed event for that day and keeps other days'. Commits `feat(mobile): undo for water and habits`, `fix(api): unticking a habit takes it off the timeline`.

### Task 10: signed out, explained; photo retry

**Files:** Modify `apps/mobile/src/store/auth.ts`, `apps/mobile/app/_layout.tsx`, `apps/mobile/app/(auth)/sign-in.tsx`, `apps/mobile/app/food/photo.tsx`; Test `apps/mobile/src/store/auth.test.ts` if the store is testable, else the pure `landingFor(status, reason)`.
- Session expiry sets `signedOutReason: 'expired'`; the gate sends that user to sign-in (not the welcome screen), which shows `You were signed out. Sign in again to pick up where you left off.`; an explicit sign-out clears the reason.
- Meal photo: `Try again` re-reads the last photo; the error offers `Choose another photo` too.
- [ ] Commit `feat(mobile): say why you were signed out`, `fix(mobile): meal photo Try again tries again`.

## Batch C: One product

### Task 11: copy and units

**Files:** `apps/mobile/app/(tabs)/index.tsx`, `habits.tsx`, `setup.tsx`, `(auth)/sign-in.tsx`, `(auth)/sign-up.tsx`, `expenses/index.tsx`, `water.tsx`, `(tabs)/trackers.tsx`, `day/[date].tsx`, `src/components/Timeline.tsx`, `apps/api/src/ai/context-builder.ts` (`display` for `ml` uses `formatVolume`).
- "rituals" → "habits"; empty habits: `No habits yet` / `Add one small thing you want to do each day, then tick it off here.`
- Expenses empty: `Add an expense by hand, or pick a payment screenshot and let Synítheia read it for you.`
- Every water amount through `formatVolume`.
- [ ] Update affected tests; commit `fix(mobile): one name for habits and one way to write water`.

### Task 12: back arrows that always work

**Files:** every screen using `router.back()` for its back arrow → `goBackOrHome(router)`.
- [ ] Commit `fix(mobile): back arrows work on screens opened from a notification`.

## Batch D: Forgot password

### Task 13: API

**Files:** Create `apps/api/src/mail/resend.ts` + test, `apps/api/src/modules/auth/password-reset.ts` + test; Modify `apps/api/src/config/env.ts` (optional `RESEND_API_KEY`, `MAIL_FROM`), `apps/api/src/db/models.ts` (`PasswordReset`: userId, codeHash, expiresAt TTL, attempts), `apps/api/src/modules/privacy/routes.ts` (USER_DATA, not exported), `apps/api/src/modules/auth/routes.ts`.

**Produces:** `GET /v1/auth/options → { passwordReset: boolean }`; `POST /v1/auth/password-reset/request { email } → 202` (same answer whether or not the account exists; 5 per 15 min); `POST /v1/auth/password-reset/confirm { email, code, password } → session` (6-digit code, 15 min, 5 attempts, single use; revokes every other session).
- Mail: password accounts get the code; Google/Apple-only accounts get `This account signs in with Google/Apple, so there is no password to reset.`
- [ ] Tests: unknown email answers 202 and sends nothing; code works once; wrong code five times locks it; expired code refused; old sessions revoked; not configured → options false and request 503. Commit `feat(api): reset a forgotten password with an emailed code`.

### Task 14: app

**Files:** Create `apps/mobile/app/(auth)/reset-password.tsx`; Modify `apps/mobile/app/(auth)/sign-in.tsx`.
- `Forgot password?` under the password field when `/auth/options` says so. Step 1 email; step 2 code + new password (same rules as sign-up); success signs in.
- [ ] Commit `feat(mobile): forgot password`.

## Finish

- [ ] `pnpm build && pnpm check` green; note counts.
- [ ] Ask before: pushing the branch (CI builds the apps), merging, deploying the API, releasing.
