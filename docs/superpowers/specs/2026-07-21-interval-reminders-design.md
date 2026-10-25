# Interval reminders — design

**Date:** 2026-07-21
**Status:** Approved

## Problem

Today a reminder fires at a fixed **time of day** (`time` = HH:mm) on selected
`weekdays` (or every day). Users want reminders that fire **every N minutes** —
"every 15 min", "every 30 min", etc. — for throughout-the-day nudges (water,
posture, stand up).

## Platform constraint (the crux)

Delivery is on-device via `expo-notifications`. Two relevant primitives:

- **`TIME_INTERVAL` repeating trigger** — fires every N minutes using **one**
  notification slot, but **24/7 with no time window**.
- **`DAILY` trigger** — fires at an exact HH:mm every day (what reminders use
  today), one notification slot each. iOS caps the app at **64 pending
  notifications total**.

No single primitive gives "every 15 min from 09:00–21:00", so the reminder's
window choice selects the delivery mechanism:

| User picks       | Delivery                                   | Slot cost                     |
| ---------------- | ------------------------------------------ | ----------------------------- |
| **All day**      | one repeating `TIME_INTERVAL` trigger      | 1 slot — every N min, 24/7    |
| **Active hours** | `DAILY` trigger per slot inside the window | `windowMinutes ÷ interval`    |

To stay under iOS's 64-slot budget, active-hours interval reminders are capped at
**≤ 24 slots each** (`MAX_INTERVAL_SLOTS`), enforced by a shared rule on both
client and server. Because both endpoints are scheduled, a 15m interval supports
up to 5h45m and 30m supports up to 11h30m; 1h+ fits any same-day window. The
compose sheet surfaces a friendly nudge when a combo exceeds it.

Interval reminders fire **every day** — no per-weekday picker. Weekday selection
stays for daily reminders only; this keeps slot counts bounded (no ×weekday
multiplication).

## Data model (additive — no migration)

`packages/shared/src/domain/reminder.ts`, added to the reminder:

- `repeat: 'daily' | 'interval'` — default `'daily'`, so existing reminders are
  untouched.
- `intervalMinutes: number | null` — 5–1440; required when `repeat === 'interval'`.
- `windowStart` / `windowEnd: TimeOfDay | null` — both null = all day; both set =
  active window. Only meaningful for interval reminders.
- `time` becomes **nullable** — required only when `repeat === 'daily'`.

Cross-field validation via `superRefine` in shared (single source of truth):

- `daily` → `time` required; `intervalMinutes`, window must be null.
- `interval` → `intervalMinutes` required; window is either both-null or both-set;
  if both-set, `slotCount(window, interval) ≤ MAX_INTERVAL_SLOTS`.

Mongo model (`apps/api/src/db/models.ts`) gains the new fields with safe defaults;
`time` relaxed to `required: false, default: null` (existing docs already carry a
value, so backward compatible).

## Pure helpers (in shared, unit-tested)

- `slotTimes(windowStart, windowEnd, intervalMinutes): string[]` — the HH:mm slots
  from start (inclusive) stepping by interval, up to and including end.
- `slotCount(...)` / the `MAX_INTERVAL_SLOTS` cap used by both validation and UI.
- `describeReminder(reminder): string` stays in the mobile file (presentation), but
  the slot math lives in shared so it's tested once.

## API

`create` / `patch` routes in `apps/api/src/modules/reminders/routes.ts` pass the
new fields through. The server only stores definitions — no scheduling logic.

## Mobile (`apps/mobile/app/reminders.tsx`)

- `syncReminder` branches on `repeat`:
  - `interval` + all day → one `TIME_INTERVAL` repeating trigger.
  - `interval` + active hours → one `DAILY` trigger per `slotTimes(...)` entry.
  - `daily` → today's DAILY/WEEKLY code, unchanged.
- `ComposeSheet` gains a **Daily / Interval** mode toggle. Interval mode shows:
  interval preset chips (15m · 30m · 1h · 2h · 4h) + a custom minute stepper, an
  **All day / Active hours** toggle, and start/end steppers when active-hours is
  chosen. Weekday picker shows only for Daily. A slot-cap warning appears when the
  window+interval exceeds `MAX_INTERVAL_SLOTS`.
- `describe()` renders interval reminders, e.g. "Every 30m · 09:00–21:00" or
  "Every 30m · All day".

## Testing

- Shared: unit tests for `slotTimes`, `slotCount`/cap, and the reminder schema's
  cross-field validation (daily vs interval, window pairing, cap rejection).
- Manual: create an interval reminder both ways in the app and confirm the
  scheduled notifications via `getAllScheduledNotificationsAsync`.

## Out of scope (YAGNI)

- Per-weekday interval reminders.
- Server-side push delivery.
- Snooze / quiet-hours beyond the active-hours window.
