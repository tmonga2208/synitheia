# Background Sync and New Detectors — Design Spec

Date: 2026-10-10
Status: draft, awaiting review

---

## Problem

Synítheia's premise is that it understands the day without being told. Today it only
understands the day while it is open:

- Health syncs when the app comes to the foreground (`useHealthSync`). Calendar syncs only
  at the moment the source is switched on in Connected Context.
- Detectors run only inside `GET /today` (`modules/today/routes.ts`). Data that arrives any
  other way is never inferred from until the user opens the app.
- Only two detectors exist, `possible_meal` and `low_water`. Steps, workouts and habit
  history are collected and then ignored by the inference layer.

The user opens the app to a day that is stale, and to an app that has noticed almost nothing.

## Solution

Three changes that only make sense together:

1. A **background task** on the phone that syncs Health and Calendar when the OS allows.
2. Detectors that **run when a sync lands**, not only when Today is opened.
3. **Four new detectors**, and a local notification for the ones the user can act on.

Success: on opening the app after a day in a pocket, today's steps, workouts and meetings
are already there, and any suggestion worth making is already waiting.

---

## Decisions

Agreed in the design conversation:

| Decision | Choice |
|---|---|
| Sources synced in the background | Health (iOS) and Calendar (both platforms). Weather and Location stay foreground-only. |
| New detectors | Unusual spending, Workout → habit, Low activity, Habit slipping |
| Notifications | Actionable suggestions only; observations wait in Today |
| Matching a workout to a habit | By habit name; a rejection stops suggestions for that habit |
| Where detection runs | On the server, at the end of each sync route and on `/today` |

Not in this version: background location, background weather, HealthKit background
delivery (observer queries), a server-side scheduler, remote push, confirm-from-notification
action buttons, Android Health Connect.

---

## Platform feasibility

Required by AGENTS.md before any passive source is implemented.

| | Health (background read) | Calendar (background read) | Background execution |
|---|---|---|---|
| Android | Not available. There is no Health Connect reader in this app. | Yes, `expo-calendar` | WorkManager via `expo-background-task` |
| iOS | Yes, HealthKit via `@kingstinct/react-native-healthkit` | Yes, EventKit via `expo-calendar` | BGTaskScheduler via `expo-background-task` |
| Native API | HealthKit queries (already in `healthkit.ts`) | EventKit / CalendarContract | BGTaskScheduler / WorkManager |
| Permission | Existing HealthKit read grant. No new prompt. | Existing calendar grant. No new prompt. | None user-facing. iOS needs the `processing` background mode and a permitted task identifier in Info.plist, both added by the Expo config plugin. |
| Background restrictions | The health store is encrypted while the device is locked; a read then returns nothing. | None beyond the task being scheduled at all. | Minimum interval 15 minutes; the OS chooses the real cadence from battery, network and usage. iOS does not run it after a force-quit, in Low Power Mode it is deferred, and it never runs in the Simulator. |
| Store policy | HealthKit data may not be used for advertising and needs a privacy policy; no change from today. | None | None |
| Privacy | High. Same fields as the foreground sync, same consent row, same `/health/sync` route. | Medium. Same as foreground. | n/a |
| Reliability | Best-effort | Best-effort | Best-effort |

Consequences the design must respect:

- A background sync that reads nothing is normal, not an error. The existing rule in
  `useHealthSync` (an empty read is a no-op, never a post of nulls) carries over unchanged.
- On Android the background task syncs Calendar only.
- Nothing in the UI may imply continuous or guaranteed collection.

---

## Part 1 — Background task (mobile)

### Dependencies

`expo-background-task` and `expo-task-manager`, installed with `npx expo install` so the
versions match SDK 54. Both are first-party Expo modules. They are the only supported way
to get scheduled background execution in an Expo app; there is no pure-JS alternative.
Third-party native modules have failed to link under the New Architecture in this repo
before, so the CI builds on both platforms are the check that these link.

### Sync runners

The sync logic currently lives inside React hooks and cannot be called from a headless task.
Extract it:

```
apps/mobile/src/sync/
  runHealthSync.ts      read HealthKit, post /health/sync, return the response
  runCalendarSync.ts    read the calendar window, post /calendar/sync, return the response
  backgroundTask.ts     task definition, register / unregister
  sourcePrefs.ts        which sources are connected + the background switch (AsyncStorage)
  notifyPolicy.ts       pure: which suggestions may notify right now
  notifySuggestions.ts  posts the local notifications notifyPolicy allows
```

- `runHealthSync()` and `runCalendarSync()` are plain async functions with no React and no
  query client. Each returns `{ ok: boolean; suggestions: SyncSuggestion[] }` and never throws.
- `useHealthSync` and `useCalendarSync` become thin wrappers: overlap guard, call the
  runner, invalidate queries. Foreground behaviour does not change.
- Today also starts syncing Calendar on foreground, the same way Health does. It is the
  same runner and there is no reason for a connected calendar to be stale in the foreground.

### The task

- Name: `synitheia.context-sync`. Defined at module scope and imported from the root
  `_layout.tsx`, because a background launch does not render any screen.
- Requested minimum interval: 30 minutes.
- Steps, in order: read `sourcePrefs`; stop if the background switch is off or nothing is
  connected; stop if there is no refresh token; run the connected runners one after the
  other; pass the returned suggestions to `notifySuggestions`; return success.
- A failed runner does not fail the task. The task reports failure to the OS only when
  every attempted runner failed, so the OS's backoff reflects reality.

### Registration

`syncBackgroundRegistration()` is the single place that registers or unregisters the task.
It registers when all of these hold: signed in, background switch on, Health or Calendar
connected. Otherwise it unregisters. It is called after sign-in, after sign-out, after any
source toggle in Connected Context, after the background switch changes, and once on app
start.

### Consent

- The server stays the authority: `/health/sync` and `/calendar/sync` already reject a sync
  with no live consent row.
- `sourcePrefs` is a local mirror so the task does not even read OS data for a source the
  user has switched off. It is written from Connected Context whenever a toggle succeeds,
  and cleared on sign-out.

### Token storage

`setTokens` in `api/client.ts` stores tokens with the SecureStore default, which makes them
readable only while the device is unlocked. A background task on a locked phone would fail
auth every time. Tokens move to `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`.

- Trade-off: tokens are readable by this app while the phone is locked, after its first
  unlock since boot. They still never leave the device or sync to iCloud Keychain.
- Migration: on app start, if tokens exist, rewrite them once with the new option.
- Android is unaffected; the option is iOS-only.

### Connected Context

- One new row under the sources list: **Sync in the background**, a switch, on by default
  once Health or Calendar is connected.
- Copy: "Keeps Health and Calendar up to date when your phone allows it. This is
  best-effort: iOS and Android decide when it runs, and it stops if you force-quit the app."
  On Android the copy says Calendar only.
- The existing per-source "last synced" time already comes from `lastSyncedAt`, which both
  sync routes update, so background syncs show up there with no further work.

---

## Part 2 — Detect on sync (API)

### Routes

`POST /health/sync` and `POST /calendar/sync` run `runDetectors` for the user's today after
their events are emitted, and add to their response:

```ts
suggestions: Array<{ id: string; type: InferenceType; title: string; actionable: boolean }>
```

- Only suggestions **created by this call** are returned, so a client can notify without
  tracking what it has seen.
- `actionable` is `proposed.kind !== 'observation'`.
- A detector failure is logged and returns an empty list. It never fails the sync, matching
  how `/today` treats it.
- The schema lives in `packages/shared` and both mobile runners parse against it.

`runDetectors` changes its return type from a count to the list of created suggestions.
`/today` ignores the list.

### Structure

`context/detectors.ts` is 281 lines with two rules and is about to hold six. Split it:

```
apps/api/src/context/detectors/
  types.ts             DetectorContext, Detection
  run.ts               loads context, runs every detector, upserts, returns created
  possibleMeal.ts      moved, unchanged
  lowWater.ts          moved, unchanged
  unusualSpending.ts
  workoutHabit.ts
  lowActivity.ts
  habitSlipping.ts
```

Each detector is a pure function `(ctx) => Detection[]` over data the runner has already
loaded. Only `run.ts` touches the database. Existing tests move with their code.

### Context loaded by the runner

- Today's events and prior history, as now. The history window grows from 21 to 56 days so
  weekday baselines have up to eight samples.
- Active habits scheduled today and today's habit logs (via the habits service).
- Rejected `possible_habit_completion` suggestions for this user, to suppress per habit.
- Pending reminders for today, for the habit-slipping rule.
- `now`, passed in rather than read from the clock inside detectors, so every rule is
  testable without fake timers.

### Idempotency

The unique key stays `(userId, detector, localDate)`. Per-habit detectors put the habit id
in the detector name (`workout_habit:<habitId>`), which gives one suggestion per habit per
day without a schema change.

### Today's suggestion list

`/today` returns at most three pending suggestions by confidence. With six detectors an
observation could push out something the user can act on. The sort becomes: actionable
first, then confidence. The limit stays three.

---

## Part 3 — The four detectors

All deterministic. No LLM. None writes a domain record. Thresholds are starting values,
kept as named constants at the top of each file.

### Unusual spending

- Type `unusual_spending` (already in the shared enum), observation.
- Today's total of `expense.created` amounts, compared with the mean daily total on the
  same weekday across the history window.
- Fires when: at least 3 prior same-weekdays have spending, today is at least 1.5× that
  mean, and today exceeds the mean by at least 10,000 minor units (₹100). The absolute
  floor stops ₹60 against a ₹40 average from firing on ratio alone.
- Single currency only: expenses not in the user's home currency are excluded from both
  sides.
- Title: "You've spent more than usual for a Friday". Evidence: today's total, the weekday
  average, the number of weekdays it is based on. Amounts are formatted in code.
- Confidence: 0.6, plus 0.1 at 2× and 0.1 with 6 or more samples.

### Workout → habit

- Type `possible_habit_completion`, proposed `{ kind: 'habit', habitId, count }`.
- For each `workout.detected` event today, find habits that are active, scheduled today,
  not yet complete, and whose name matches the workout.
- Matching, case-insensitive on whole words in the habit name:
  - generic words match any workout: workout, exercise, gym, training, train, fitness, cardio
  - specific words match their own activity: run/running/jog, walk/walking, cycle/cycling/bike,
    swim/swimming, yoga, strength/weights/lifting, hike/hiking, pilates, dance
  - steps-measure habits are excluded; they already complete from step counts.
- `count`: for a duration habit, the workout's minutes (rounded, at least 1); otherwise 1.
- Suppressed for a habit if the user has ever rejected a `possible_habit_completion` for
  that habit.
- Title: "Mark Morning run done?" Evidence: "Running, 32 min, from Apple Health".
- Confidence: 0.8 for a specific-word match, 0.65 for a generic one.
- **Confirm**: `modules/inference/routes.ts` gains the missing `habit` branch. It calls the
  existing `logHabit` with the proposed count and source `inferred`, so streaks, XP and the
  `habit.completed` event behave exactly as a manual log. If the habit was completed or
  archived in the meantime, confirming resolves the suggestion without logging twice.

### Low activity

- New type `low_activity`, added to the shared enum. Observation.
- Uses the latest `steps.recorded` total for today against the mean daily total over the
  last 14 days that have step data.
- Fires when: local time is 19:00 or later, at least 7 days have data, and today is under
  60% of the mean.
- Does not fire when there is no step event today at all: no data is not low activity.
- Title: "A quieter day than usual". Evidence: today's steps, the average, days sampled.
- Confidence: 0.6, plus 0.1 under 40%.

### Habit slipping

- Type `missed_habit`, observation. One per habit per day.
- For each active habit scheduled today and not complete: take the local minute-of-day of
  its `habit.completed` events in the last 28 days; needs at least 5.
- Fires when: now is at least 90 minutes past the median, now is before 22:00, and no
  reminder for that habit is still due today.
- Title: "Reading is usually done by now". Evidence: "Usually completed around 8:40 AM,
  based on 9 of the last 28 days".
- Confidence: 0.6, plus 0.1 with 10 or more completions.

---

## Part 4 — Notifications

Local notifications only, posted by the background task from what the sync routes return.

`notifyPolicy` is a pure function: `(suggestions, state, now, timezone) => suggestions to
notify`. Rules:

- only `actionable` suggestions;
- never one whose id has already been notified;
- at most 2 per local day;
- none between 22:00 and 07:00 local.

`notifySuggestions` applies the policy, then:

- does nothing unless notification permission is already granted. It never prompts from
  the background;
- posts each notification with the suggestion's title, a fixed body ("Tap to confirm in
  Today"), and data `{ suggestionId }`;
- records the notified ids and the day's count in AsyncStorage.

Tapping opens the app on Today, where the suggestion card already is. A response listener
in the root layout handles the navigation.

In practice the only detector that notifies today is Workout → habit. `possible_meal` is
actionable too, but it is triggered by expenses the user enters in the app, so it is
created in the foreground and is not returned by a sync.

Suggestions created by a **foreground** sync never notify; the user is already looking at
Today.

---

## Error handling

| Situation | Behaviour |
|---|---|
| Phone locked, HealthKit returns nothing | Health sync is a no-op; Calendar still syncs |
| Offline, or the API is down | Runner returns `ok: false`; the task reports failure only if all runners failed |
| Refresh token expired | The task stops quietly. It does not sign the user out from the background; the next foreground request handles that as it does today. |
| Consent revoked on another device | Server rejects the sync; the runner returns `ok: false`; local prefs correct themselves on the next foreground load of Connected Context |
| Detector throws | Logged; the sync still succeeds with `suggestions: []` |
| Notification permission not granted | No notification; the suggestion is still in Today |

---

## Testing

| Area | How |
|---|---|
| Each new detector: fires, does not fire below its sample minimum, boundary values, evidence text | Real MongoDB, alongside the existing detector tests, with `now` injected |
| Workout → habit name matching | Pure unit tests over a table of habit names and activities |
| Rejection suppresses per habit | Real MongoDB |
| Confirming a `habit` suggestion logs once, and is safe if already complete | API route test |
| Sync routes return only suggestions created by that call | API route tests |
| `/today` ordering: actionable first | API route test |
| `notifyPolicy`: cap, quiet hours, dedupe, timezones | Pure unit tests |
| Sync runners: empty read is a no-op, failures return `ok: false`, never throw | Unit tests with mocked readers and API client |
| Registration rules | Unit test of the decision function |

**Not covered by automated tests:** whether the OS actually wakes the task. That cannot run
in CI or the iOS Simulator. It needs a physical device, using
`BackgroundTask.triggerTaskWorkerForTestingAsync()` in a dev build and Xcode's simulated
background launch. The implementation plan ends with that manual check, and the feature is
not to be described as working until it has been done.

---

## Files touched

Mobile: new `src/sync/*`; `src/health/useHealthSync.ts`, `src/calendar/useCalendarSync.ts`
(thin wrappers); `src/api/client.ts` (keychain option, migration); `app/_layout.tsx` (task
import, notification response listener, registration on start); `app/(tabs)/index.tsx`
(calendar on foreground); `app/privacy.tsx` (switch, prefs mirror); `src/store/auth.ts`
(registration on sign-in/out); `app.json` (background task plugin); `package.json`.

API: `src/context/detectors.ts` → `src/context/detectors/*`; `modules/health`,
`modules/calendar` (run detectors, return suggestions); `modules/inference/routes.ts`
(`habit` confirm branch); `modules/today/routes.ts` (ordering).

Shared: `domain/inference.ts` (`low_activity`, sync suggestion schema); `domain/health.ts`
and `domain/calendar.ts` (sync response schemas).

Docs: `ARCHITECTURE.md` feasibility matrix and phase table.
