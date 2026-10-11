# Android Health via Health Connect — Design Spec

Date: 2026-10-10
Status: draft, awaiting review

---

## Problem

Health data is iPhone-only. On Android, turning on "Health & Activity" answers "Health
Connect isn't available on this device", so step habits never fill themselves, no workout
ever suggests a habit, the low-activity rule has nothing to read, and the Body screen is
typed by hand.

Everything except the reader already assumes Android: the server takes a platform-neutral
`SyncHealthInput`, `healthSourceName()` already answers "Health Connect" on Android, and
Connected Context already lists "Health Connect on Android". The comment in
`apps/mobile/src/health/healthkit.ts` says what is missing: "adding Android means writing a
second reader that returns this same shape. Nothing on the server changes."

## Solution

A second reader for Android's Health Connect, behind one platform-neutral health module.
It produces the same daily snapshot the iPhone reader does. No server change.

Success: on an Android phone with Health Connect, connecting Health fills steps, workouts,
sleep, active calories, resting heart rate, weight and height, and every feature built on
them on iPhone works unchanged.

---

## Decisions

Agreed in the design conversation:

| Decision | Choice |
|---|---|
| Data requested on Android | The same seven types iPhone reads: steps, workouts, sleep, active calories, resting heart rate, weight, height |
| Background reads | Requested. Best-effort, and foreground sync still works if refused |
| Library | `react-native-health-connect` v4 (4.1.3) |
| Verification | An emulator on the development Mac first, then a real phone |

Not in this version: writing to Health Connect, reading history older than Health
Connect's default window, a Play Store health declaration, revoking Health Connect
permissions from inside the app, and any change to the iPhone reader's behaviour.

---

## Platform feasibility

Required by AGENTS.md before a passive source is implemented.

| | Health Connect on Android |
|---|---|
| Availability | Built into Android 14 and later. On Android 9 to 13 it is a separate app from the Play Store. Not available below Android 9. iOS is unchanged (HealthKit). |
| Native API | Health Connect Jetpack client 1.1.0, through the `react-native-health-connect` TurboModule. The library states support for the New Architecture; this repo has had native modules compile and then fail to link, so a built APK is inspected rather than trusted. |
| Permissions | One read permission per data type, granted on Health Connect's own screen, revocable there at any time. Unlike iOS, Android reports which were granted. |
| Background | Needs the extra `READ_HEALTH_DATA_IN_BACKGROUND` permission. Whether the phone offers it depends on its Health Connect version. Without it a background read is refused. |
| Where data comes from | Whatever apps write into Health Connect (Samsung Health, Fitbit, Google Fit, watch apps). On Android 14+ with SDK extension 20+, Health Connect also counts steps from the phone's own sensor once any app holds the steps permission. Otherwise an Android phone with no such app has no data. |
| History | By default only the 30 days before the first grant are readable. This app reads 7 days, so only height and weight are affected. |
| Store policy | Play distribution requires a health-apps declaration with a justification per data type and a privacy policy. This app is sideloaded. Google's docs do not say whether a phone restricts a sideloaded app, so the emulator and phone tests decide that. |
| Privacy | High. Same consent row, same `/health/sync` route, same fields as iOS minus sex and date of birth, which Health Connect does not hold. |
| Reliability | Best-effort |

---

## Structure on the phone

```
apps/mobile/src/health/
  healthStore.ts              the only module the rest of the app imports
  dayBounds.ts                local-day windows, shared by both readers (moved from healthkit.ts)
  healthkit.ts                the iPhone reader (existing; loses the platform checks)
  healthConnect.ts            the Android reader: thin calls into the library
  healthConnectNormalize.ts   pure: Health Connect records → HealthSnapshot
  exerciseTypes.ts            pure: Health Connect exercise codes → activity names
apps/mobile/plugins/
  withHealthConnectRationale.js   config plugin: the manifest entries and trampoline activity
```

- `healthStore.ts` exports what `healthkit.ts` exports today: `isSupported`,
  `healthSourceName`, `isAvailable`, `requestPermissions`, `readHealth`. It picks the reader
  by `Platform.OS`. Every current importer of `healthkit.js` switches to it.
- `healthConnect.ts` loads the library with a dynamic import inside a try/catch. The
  library is never evaluated on iPhone, and on Android a module that failed to link becomes
  "unavailable" instead of a crash at startup.
- The pure files carry the tests. `healthConnect.ts` is the only file that cannot run under
  Node, so it holds no logic worth testing: it calls the library and hands the results over.

---

## What Android reads

The last 7 local days, re-read in full on every sync, exactly as on iPhone. The server
upserts by day, so re-sending a day is free and always correct.

| Field | Source | Rule |
|---|---|---|
| Steps | Aggregate `Steps.COUNT_TOTAL` | Health Connect's aggregate de-duplicates across apps; summing raw records would double-count a phone and a watch |
| Active calories | Aggregate `ActiveCaloriesBurned.ACTIVE_CALORIES_TOTAL` | kcal, rounded |
| Exercise minutes | Aggregate `ExerciseSession.EXERCISE_DURATION_TOTAL` | seconds → minutes, rounded |
| Workouts | `ExerciseSession` records starting in the day | `kind` from the exercise-type map, `minutes` from start and end, `energyKcal` from an active-calories aggregate over the session, or null |
| Sleep | `SleepSession` records that END in the day | See below |
| Resting heart rate | Aggregate `RestingHeartRate.BPM_AVG` | rounded |
| Height, weight | Most recent `Height` / `Weight` record | metres → cm; kg to one decimal |
| Sex, date of birth | — | Not in Health Connect. Left out, so a value typed on the Body screen is never blanked |

A type that was refused, or that throws, is `null` for that day: absent, not zero. This is
the iPhone reader's rule and the server depends on it.

**Sleep.** A night belongs to the day the user woke up on, so a session counts toward the
local day its end falls in. Within a session, only asleep stages count (sleeping, light,
deep, REM) when the source recorded stages; with no stages the whole session counts. Asleep
intervals from all sessions are merged before summing, so a watch and a phone that both
recorded the night are not added together. `sleepStart` and `sleepEnd` are the first and
last asleep instants.

**Exercise names.** Health Connect identifies exercise types by number. They are mapped to
the same names iPhone sends, because the server's workout-to-habit matching works on those
names: `BIKING` and `BIKING_STATIONARY` → `cycling`, `RUNNING` and `RUNNING_TREADMILL` →
`running`, `STRENGTH_TRAINING` and `WEIGHTLIFTING` → `traditionalStrengthTraining`,
`SWIMMING_POOL` and `SWIMMING_OPEN_WATER` → `swimming`, `DANCING` → `dance`, and `walking`,
`yoga`, `hiking`, `pilates`, `elliptical`, `rowing`, `highIntensityIntervalTraining`
directly. Anything else is `workout`, which only a habit with a generic name ("Workout",
"Gym") matches.

**Height and weight.** Without the history permission, a height entered long ago is
invisible. It stays hand-entered on the Body screen. Asking for history access is a
separate permission and is left out.

---

## Connecting

The Health switch on Connected Context, on Android:

1. Check Health Connect: available, needs installing or updating, or not supported.
   - Not supported: the existing "isn't available on this device" message.
   - Needs installing or updating (Android 9 to 13): a message saying so, with a button
     that opens Health Connect's Play Store page.
2. Show Health Connect's permission screen with the seven read types and background access.
3. Read back what was granted.
   - No read type granted: not connected, and no consent row is written.
   - At least one: connected. Refused types stay empty, and nothing nags about them.
4. Sync immediately, as iPhone does.

Turning the switch off withdraws consent on the server and stops reading. The Health
Connect grant itself stays until the user removes it in Health Connect, the same as iOS.
"Ours wins": the server refuses a sync without the consent row whatever the OS says.

**Health Connect's "privacy policy" link.** Health Connect shows a link on its permission
screen that must open something in the app. It opens Connected Context, which is where the
app explains each source. Android delivers that tap as an intent with no URL, which React
Native cannot see, so a 15-line native trampoline activity receives it and re-launches the
app at `synitheia://privacy`.

---

## Background

The existing background task already calls the shared health sync. On Android it starts
reading Health Connect with no scheduling change.

- Background access granted: health syncs when the OS runs the task.
- Refused, or not offered by this phone's Health Connect: the read is refused, every field
  comes back null, and the existing "nothing to send" rule skips the sync. Not a failure,
  and the task does not back off because of it.

---

## Build changes

- Dependencies: `react-native-health-connect` (third-party, native) and
  `expo-build-properties` (Expo's own). No pure-JS alternative exists for reading Health
  Connect.
- Minimum Android version rises from API 24 (Android 7.0) to API 26 (Android 8.0). The
  Health Connect client requires it.
- `app.json` gains eight permissions: `android.permission.health.READ_STEPS`,
  `READ_EXERCISE`, `READ_SLEEP`, `READ_ACTIVE_CALORIES_BURNED`, `READ_RESTING_HEART_RATE`,
  `READ_WEIGHT`, `READ_HEIGHT`, and `READ_HEALTH_DATA_IN_BACKGROUND`. No write permission
  is declared, so the app cannot write to Health Connect even by mistake.
- A local config plugin, `withHealthConnectRationale`, replaces the library's own plugin.
  The library's plugin points Health Connect's policy link at the main activity, which
  would open the app on Today. Ours writes the trampoline activity and declares it for both
  the Android 13-and-earlier intent and the Android 14+ activity alias. Using one plugin
  rather than patching the other's output keeps it independent of plugin ordering.

---

## Error handling

| Situation | Behaviour |
|---|---|
| Library not linked into the build | The dynamic import throws; Health reads as unavailable. Caught by APK inspection before release |
| Health Connect missing or outdated | Connect offers the Play Store page; sync is skipped |
| One data type refused or throws | That field is null for the day; the rest sync |
| Everything refused, or a background read without background access | All fields null → sync skipped, nothing posted |
| Permission revoked in Health Connect later | Reads return null; the source stays "connected" in the app until the user turns it off, as on iOS |
| iPhone | The Android library is never loaded |

---

## Testing

| Area | How |
|---|---|
| Exercise-type map: every name it can emit, and the fallback | Unit tests |
| Sleep: stages, no stages, overlapping sources, a session ending on another day, an afternoon nap | Unit tests on the pure function |
| Record → snapshot: rounding, units, null stays null | Unit tests |
| Connect outcome from SDK status and granted permissions | Unit tests on the pure decision |
| `dayBounds` | Unit tests with an injected clock |
| `healthStore` picks the right reader per platform | Unit test with `Platform` mocked |
| Config plugin output: activity, both intent filters, alias, Kotlin source | Unit test running the plugin on a manifest fixture |
| Names the Android map emits are matched by the server | Rows added to the API's `workoutMatch` test |

Not unit-testable, and checked in this order:

1. **CI builds** for both platforms. iOS must still build with the new library present.
2. **APK inspection** of the CI-built Android APK: the library's classes are in the dex
   files, all eight permissions are in the manifest, and the trampoline activity and alias
   are declared.
3. **Emulator** on the development Mac, Android 14 image: install the CI APK, insert sample
   records with Google's Health Connect Toolbox, connect Health, and confirm the data
   reaches the app; tap the policy link and confirm it opens Connected Context. The CI APK
   talks to production, so this uses one throwaway account, deleted afterwards through the
   app's own delete-account flow.
4. **A real phone**, by the user, from a checklist: real steps, a real workout, background
   sync, and whether a sideloaded build is allowed to read at all.

Until step 4 is done, Android health is described as built and emulator-tested, not
verified on a device.

---

## Files touched

Mobile: new `src/health/healthStore.ts`, `dayBounds.ts`, `healthConnect.ts`,
`healthConnectNormalize.ts`, `exerciseTypes.ts` and their tests;
`src/health/healthkit.ts` (day bounds moved out, platform checks moved to the store);
`src/health/useHealthSync.ts`, `src/sync/runHealthSync.ts` and its test, `app/privacy.tsx`,
`app/body.tsx` (import the store; the update-required message on Connected Context);
new `plugins/withHealthConnectRationale.js` and its test; `app.json`; `package.json`;
`pnpm-lock.yaml`.

API: `src/context/detectors/workoutMatch.test.ts` (rows only; no production change).

Docs: `ARCHITECTURE.md` feasibility matrix and phase table.
