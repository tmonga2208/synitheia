# Synítheia — Technical Assessment & Proposed Architecture

Status: architecture agreed, implementation in progress. Written after inspecting the repository, `AGENTS.md`, `design.md`, and all screenshots in `assets/`.

---

## 0. Decisions (confirmed)

| Question          | Decision                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Synthesia AI**  | Our own brand name for the insight layer, not a third-party product. Provider: **Claude (Anthropic API)** — chosen for strict structured output / tool-use, which the schema-validated insight pipeline depends on, and for vision, which the expense-screenshot parser depends on. Sits behind a swappable `InsightProvider` interface. |
| **MVP scope**     | **All four trackers before shipping** — Phases 1–8 (foundation, auth, context engine, Today, expenses, habits, nutrition, water/reminders). Passive collection + AI follow.                                                                                                                                                              |
| **Auth**          | **Email/password + Apple + Google.** Own JWT with refresh-token rotation; Apple Sign-In included because the App Store mandates it whenever another social provider is offered. No guest mode — account required.                                                                                                                        |
| **Expense input** | **Multi-channel ingestion, no restricted permissions.** Manual quick-add · pattern-based smart suggestions · CSV import · PDF statement parse · **payment-screenshot parse (vision)** · **paste-the-SMS-text parse**.                                                                                                                    |

### Why the ingestion approach beats SMS parsing

The brief wanted transaction data. The platforms won't give it to us (see §4). But the *user* can — and that turns out to be strictly better:

- **It works on iOS.** SMS/notification listening never could.
- **No restricted permissions**, so no Play Store rejection risk.
- **It's honest.** The user explicitly hands over each payment, which is exactly the consent posture `AGENTS.md` demands.
- **It's a share-sheet away.** iOS Share Extension + Android `ACTION_SEND` intent mean the flow is: get the UPI notification → share screenshot to Synítheia → confirm the pre-filled expense. Two taps, no typing. That is *less* manual work than most "automatic" trackers achieve in practice.

Ingestion is a distinct subsystem (`ExpenseIngestion`) that turns any input channel into a **draft** expense with a confidence score, which then flows through the same `Detect → Infer → Suggest → Confirm` path as every other inference. Nothing is ever silently written.

---

## 1. Repository Assessment

The repository currently contains **no code at all**.

```javascript
tbd/
├── AGENTS.md          # product + engineering brief
├── design.md          # design system: "Synítheia", warm minimalism
└── assets/
    ├── iPhone 17 - 1..3.png   # 3-step onboarding
    ├── iPhone 17 - 4.png      # Home / dashboard — empty state
    ├── iPhone 17 - 5.png      # Home / dashboard — populated state
    ├── iPhone 17 - 6.png      # New Habit form
    ├── iPhone 17 - 7.png      # Choose Icon sheet
    ├── Group 9/11/12/14/18.png # small icon fragments (brain, books, apple, sparkles)
    ├── Tab Bar.png            # generic floating tab bar reference (not final visual)
    └── lucide/                # 2 icons only (alarm-clock, arrow-right)
```

Findings:

- **No existing stack.** No `package.json`, no React Native project, no navigation, no state management, no backend, no infrastructure. Nothing to preserve, nothing to migrate, no technical debt.
- **No Expo vs bare decision has been made** — it must be made now, and it is load-bearing (see §4: health/location/background all depend on it).
- **The lucide/ folder implies Lucide as the icon set.** Only 2 icons are present; the rest will come from `lucide-react-native`.
- **No "Synthesia AI" integration, SDK, or documentation exists anywhere in the repo.** This is a blocking unknown — see Questions.
- **Design assets cover the habit domain only.** There are no screens for expenses, food, water, timeline, insights, or privacy/data-sources. Those screens must be designed from the system in `design.md` rather than copied from a reference.

---

## 2. Screenshot / Design Assessment

### Screens present

| Asset             | Screen              | What it establishes                                                                                                                                                                                                                                                               |
| ----------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iPhone 17 – 1/2/3 | Onboarding, 3 steps | Pill progress indicator (active pill widens), "Step N of 3" label, large square hero image w/ \~32px radius, headline + 2–3 line body, full-width sage CTA with `→`, "Skip →" text link                                                                                           |
| iPhone 17 – 4     | Home, empty         | Avatar + notification bell header, uppercase wide-tracked date, large greeting, subtitle, huge progress ring (0%), two outlined pill chips, "Daily Habits" section, empty-state card w/ circular icon chip + copy + outlined CTA                                                  |
| iPhone 17 – 5     | Home, populated     | Same skeleton, ring at 100% filled sage; chips now show streak + XP; habit cards (icon chip, title, metadata line, right-side circular affordance — `+` for count habits, filled circle for done); "Weekly Analysis" bar chart with dotted goal line, active day highlighted sage |
| iPhone 17 – 6     | New Habit           | Back arrow + color/icon swatch; grouped "cards as fieldsets" — Name (icon chip + input + category pills incl. `+ New`), Frequency (segmented Daily/Weekly + stepper for goal), Gentle Remainder \[sic] (flip-clock-style time picker + toggle)                                    |
| iPhone 17 – 7     | Choose Icon         | Bottom sheet w/ grab handle, current-selection preview, search field, category pills, icons grouped by category in a tinted-tile grid                                                                                                                                             |

### Patterns to adopt

1. **Everything is a card.** Rounded (32px large / 16px small), bone-white or sand fill, hairline border *and* a very soft shadow. No harsh dividers.
2. **Per-habit accent color.** Habit cards in screenshot 5 are tinted individually (indigo, sage, dusty-rose) — border, icon-chip background, metadata text, and the `+` affordance all pick up that habit's color. This is the single most distinctive thing in the design; the color system must support a palette of habit accents, not just one global sage.
3. **The ring is the hero.** One big number, oversized weight, `%` in a lighter muted tone. It is the emotional summary of the day.
4. **Chips carry secondary stats** (streak, XP) rather than another card. Keeps density low.
5. **Progressive disclosure**, exactly as `AGENTS.md` asks: ring → chips → today's habits → weekly chart. Detail lives one tap deeper.
6. **Generous vertical rhythm.** Roughly 24–32px between sections, 20–24px card padding.
7. **Typography:** Manrope. Headline \~34/600 tight, section header \~20/600, card title \~18/600, metadata \~12/500, and the uppercase wide-tracked date label \~12/600 with \~1.5px tracking.

### Derived visual direction

Warm-minimal, paper-like, single sage anchor with soft per-habit accents. Depth via broad low-opacity shadows, never borders alone. Motion should be gentle: scale-down on press, spring on completion, ring animates on mount. No gradients except the imagery. **The design language extends to the other domains** — an expense is a card, a water glass is a ring, the Today timeline is a vertical rail of small cards. The app must never look like a finance dashboard.

### Navigation implication

The Tab Bar asset is a generic reference, not final art. Given the product vision ("Today" is the core), the tab bar should be a floating, blurred pill with 4 destinations:

**Today · Trackers · Insights · Profile**

Not one tab per tracker — that would produce exactly the "seven separate trackers" feeling `AGENTS.md` forbids.

---

## 3. Proposed Architecture

### Monorepo

```javascript
synitheia/
├── apps/
│   ├── mobile/           # React Native (Expo, custom dev client)
│   ├── api/              # Node + Fastify + TypeScript
│   └── web/              # The public page: static files, no build (§11)
├── packages/
│   ├── shared/           # zod schemas, DTOs, shared domain types, event taxonomy
│   └── config/           # tsconfig, eslint, prettier bases
└── pnpm-workspace.yaml
```

The mobile client and the API must never drift on the shape of a `PersonalEvent` or an `Expense`. A shared package with zod schemas as the single source of truth (types inferred from schemas, used for request validation on the server and response parsing on the client) is the cheapest way to guarantee that.

### Mobile

| Concern        | Choice                                                  | Why                                                                                                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework      | **Expo + custom dev client** (prebuild / CNG)           | We need native modules (HealthKit, Health Connect, background tasks). Expo Go can't load them, but a custom dev client can — we get config plugins, EAS Build, and OTA updates without going bare. Bare RN buys us nothing here and costs a lot of build maintenance. |
| Navigation     | **Expo Router** (file-based, on React Navigation)       | Typed routes, deep links for free (needed for notification taps → habit detail).                                                                                                                                                                                      |
| Server state   | **TanStack Query**                                      | Cache, retry, background refetch, optimistic mutations. Its persister + a mutation queue gives us most of offline-first without hand-rolling sync.                                                                                                                    |
| Client state   | **Zustand**                                             | Small: session, theme, onboarding, filters. No Redux.                                                                                                                                                                                                                 |
| Local DB       | **SQLite (expo-sqlite)** — added at Phase 9, not before | Only needed once passive sources produce local event volume and we need offline reads of the timeline. Do not build it in Phase 1 "just in case".                                                                                                                     |
| Styling        | **StyleSheet + a typed theme object**                   | The design has \~5 colors, one font, one radius scale. A styling library (NativeWind/Tamagui) is more machinery than this needs.                                                                                                                                      |
| Animation      | **Reanimated 3 + Gesture Handler**                      | Ring, card press, sheet.                                                                                                                                                                                                                                              |
| Charts         | **react-native-svg** hand-rolled                        | The weekly bar chart and the ring are two components. A chart library is not worth the bundle.                                                                                                                                                                        |
| Forms          | **react-hook-form + zod resolver** (shared schemas)     |                                                                                                                                                                                                                                                                       |
| Notifications  | **expo-notifications**                                  | Local scheduled reminders. Push (`expo-server-sdk`) only when server-generated insights need to reach the user.                                                                                                                                                       |
| Secure storage | **expo-secure-store**                                   | Keychain / Keystore. Refresh token only — never the DB URI, never provider keys.                                                                                                                                                                                      |
| Errors         | **react-error-boundary** per route + Sentry             |                                                                                                                                                                                                                                                                       |

### Backend

**Node 22 + Fastify + TypeScript + Mongoose.**

Considered:

- *Express* — no first-class TS, no schema-driven validation, effectively legacy. No.
- *NestJS* — excellent domain structure and DI, but the ceremony (modules, providers, decorators, its own DTO/validation stack) fights the shared-zod approach and slows a small team. Its main payoff (large team, many contributors) doesn't apply.
- **Fastify** — fastest, first-class TS, schema-per-route validation, plugin encapsulation gives us module boundaries without a DI framework. Pairs naturally with zod via `fastify-type-provider-zod`. **Recommended.**

Layering, strictly enforced:

```javascript
routes/      HTTP only — auth guard, zod validation, status codes. No logic.
services/    domain logic. Pure where possible. This is where all math lives.
repositories/ Mongoose access. The only layer that knows about Mongo.
models/      Mongoose schemas.
```

Cross-cutting: `pino` logging w/ request ids, a central error mapper (`AppError` → HTTP), `@fastify/rate-limit`, `@fastify/helmet`, and **env validation with zod at boot — the process must refuse to start on a missing secret.**

### The Personal Context Engine

This is the spine of the product and it is deliberately **not** a distributed system.

```javascript
 ┌────────────── sources ──────────────┐
 manual entry   health   calendar   location   imports
        │          │        │          │          │
        └──────────┴────┬───┴──────────┴──────────┘
                        ▼
              Domain Services  (Expense, Habit, Food, Water)
                        │  emit(...)
                        ▼
              ┌──────────────────────┐
              │ Personal Context     │  normalize → dedupe → persist
              │ Engine               │
              └──────────┬───────────┘
                         ▼
                   PersonalEvent[]          ← the normalized timeline
                         │
              ┌──────────┴───────────┐
              ▼                      ▼
      Inference Engine        Daily Context Aggregator
      (InferredContext,        (deterministic metrics,
       confidence, suggest)     DailySummary)
              │                      │
              └──────────┬───────────┘
                         ▼
                  AI Context Builder   (select · aggregate · redact)
                         ▼
                   Synthesia AI  (LLM)
                         ▼
                     AIInsight[]
```

Key decisions:

- **Domain collections stay strongly modeled.** An `Expense` is an `Expense`. `PersonalEvent` is a *derived, append-only projection* for the timeline and for AI. Writing an expense writes both, in one transaction. `PersonalEvent` is never the source of truth for a domain.
- **In-process event bus for the MVP** (a typed emitter inside the API), not Kafka/Rabbit/Redis-streams. There is one service. Distributed messaging here would be architecture theatre. The bus interface is deliberately narrow so it can be swapped for a real broker later without touching domain code.
- **Idempotency / dedupe is a first-class concern.** Every event carries a `dedupeKey` (e.g. `health:steps:2026-07-12` or `calendar:<providerId>:<startTs>`) with a unique index. Re-syncing the same day must never duplicate the timeline. This is where most bugs in this class of app live.
- **All calculation is deterministic and server-side.** Totals, streaks, completion rates, deltas, trends — code, never the LLM.
- **Timezones.** Every event stores UTC `timestamp` + IANA `timezone` + a precomputed `localDate` (`YYYY-MM-DD`) string. All "today"/"this week" queries filter on `localDate`, never on a UTC range. `date-fns-tz`, in shared, used identically on client and server.

### Confidence & inference

`InferredContext` is created by rule-based detectors (recurring-amount + time-window + place), never by an LLM, with:
`type · confidence · supportingEventIds · status(pending|confirmed|rejected) · correctionHistory`.

Only `pending` items surface as a suggestion card on Today. Confirming one writes the real domain record and links back. Rejections are fed into detector thresholds. **Nothing auto-writes in the MVP** — `Detect → Infer → Suggest → Confirm`, per the brief.

---

## 4. Passive Data Collection Feasibility Matrix

Verified against current platform capability, not assumed.

| Source                      | Android                                                                                                                                                                                                | iOS                                                                                                                                      | Permission                              | Background                                                                | Reliability                                                 | Privacy       | MVP?                                                                                                                         | Complexity                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **Steps**                   | Health Connect (`react-native-health-connect`)                                                                                                                                                         | HealthKit (`react-native-health`)                                                                                                        | Health read grant, user-facing          | iOS: read by the background task, only while the device is unlocked. Android: read by the background task only if the user has allowed Health Connect's background access, which not every phone offers; otherwise foreground only. Neither is verified on a device | High                                                        | Medium        | **Yes**                                                                                                                      | Medium                    |
| **Sleep**                   | Health Connect sleep sessions                                                                                                                                                                          | HealthKit `sleepAnalysis`                                                                                                                | Same as above                           | Same                                                                      | **Best-effort** — only exists if a wearable/phone writes it | Medium        | Yes (read-only, degrade gracefully)                                                                                          | Low (on top of health)    |
| **Workouts**                | Health Connect exercise sessions                                                                                                                                                                       | HealthKit workouts                                                                                                                       | Same                                    | Same                                                                      | Medium–High                                                 | Medium        | Yes                                                                                                                          | Low (on top of health)    |
| **Calories/nutrition read** | Health Connect nutrition                                                                                                                                                                               | HealthKit dietary                                                                                                                        | Same                                    | Same                                                                      | Low (few apps write it)                                     | Medium        | No — we are the writer, not the reader                                                                                       | Low                       |
| **Location / places**       | `expo-location` + geofencing                                                                                                                                                                           | Same                                                                                                                                     | ACCESS\_BACKGROUND\_LOCATION / "Always" | ✓ but OS-throttled                                                        | Medium                                                      | **High**      | **Deferred to Phase 9, opt-in, off by default**                                                                              | High                      |
| **Calendar**                | `expo-calendar`                                                                                                                                                                                        | `expo-calendar`                                                                                                                          | Calendar read                           | Foreground, plus the background task on both platforms                    | High                                                        | Medium        | Yes                                                                                                                          | Low                       |
| **Weather**                 | HTTP API from coarse location                                                                                                                                                                          | Same                                                                                                                                     | Coarse location (or manual city)        | n/a                                                                       | High                                                        | Low           | Yes (context only)                                                                                                           | Low                       |
| **Notification listening**  | `NotificationListenerService` — **custom native module, no maintained RN lib**; Play Store restricts the permission to a narrow set of approved use cases                                              | **Impossible** — iOS exposes no API                                                                                                      | Special access                          | ✓ (Android)                                                               | Medium                                                      | **Very high** | **No**                                                                                                                       | High + policy risk        |
| **SMS transaction parsing** | `READ_SMS` is a Play Store *restricted permission*: allowed for default SMS handlers and a short list of declared exceptions, each subject to review. "SMS-based money management" is one of them (corrected October 2026; this cell used to say finance tracking is not approved)                                  | **Impossible**                                                                                                                           | READ\_SMS                               | ✓                                                                         | Medium                                                      | **Very high** | **No — by choice: it means holding every message the user receives**                                                                                    | High + severe policy risk |
| **UPI / bank transactions** | **No public NPCI or UPI-app API exists.** The only lawful route in India is the RBI **Account Aggregator** framework (Setu / Finvu / OneMoney), which requires being/partnering with a registered FIU. | Same                                                                                                                                     | AA consent flow                         | n/a                                                                       | High *if* AA                                                | **Very high** | **No for MVP.** Ship **CSV / bank-statement import + a manual quick-add** instead. Revisit AA when there's a company entity. | Very high                 |
| **Device / app usage**      | `UsageStatsManager` + `PACKAGE_USAGE_STATS` special access; custom native module                                                                                                                       | Screen Time / `DeviceActivity` — **Swift-only, requires Family Controls entitlement, and the data is not permitted to leave the device** | Special access                          | ✓ (Android)                                                               | Medium                                                      | High          | **No**                                                                                                                       | High                      |
| **Background execution**    | WorkManager via `expo-background-task`                                                                                                                                                                 | `BGTaskScheduler` — **opportunistic, iOS decides when; may not run for hours**                                                           | —                                       | Best-effort. Implemented as one task syncing Health + Calendar (30 min minimum requested); not after an iOS force-quit, never in the Simulator | **iOS is not guaranteed**                                   | —             | Yes, as *opportunistic sync*, never as a correctness guarantee                                                               | Medium                    |

**Consequences that must be stated plainly:**

- **Automatic expense detection is not achievable on iOS at all, and is a Play-Store-policy minefield on Android.** The brief's flagship "₹250 at 1PM near a restaurant → lunch" example depends on transaction data we cannot lawfully obtain in the MVP. We will build the inference *engine* (it's real and useful) but feed it health, calendar, location, time, and the user's own historical patterns — plus imported statements — rather than pretending we can read UPI.
- **iOS background work is opportunistic.** The app will sync on foreground, and treat background execution as a bonus. It will never claim "always on".
- Everything marked **No** above is not being built. No fake collectors.

---

## 5. MongoDB Data Model

All collections are `userId`-scoped and every query is filtered by it at the repository layer.

| Collection               | Purpose                              | Key fields                                                                                                                                                                     | Indexes                                                                                                    | Notes                                                                                                                                                         |
| ------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **User**                 | Identity, timezone, locale, currency | `email`, `name`, `avatarUrl`, `timezone` (IANA), `currency`, `xp`, `authProvider`, `createdAt`                                                                                 | `{email:1}` unique                                                                                         | `timezone` is required — everything downstream depends on it                                                                                                  |
| **UserPreference**       | Targets & settings                   | `waterTargetMl`, `calorieTarget`, `monthlyBudget`, `reminderDefaults`, `aiEnabled`, `aiDataScopes[]`                                                                           | `{userId:1}` unique                                                                                        | Split from User so AI/privacy toggles can be audited                                                                                                          |
| **ExpenseCategory**      | Categories                           | `name`, `icon`, `color`, `isSystem`                                                                                                                                            | `{userId:1,name:1}`                                                                                        | Seeded system set + user categories                                                                                                                           |
| **Expense**              | A spend                              | `amount` (**integer minor units**), `currency`, `categoryId`, `note`, `merchant`, `occurredAt`, `localDate`, `timezone`, `source` (manual\|imported\|inferred), `dedupeKey?`   | `{userId:1,localDate:-1}`, `{userId:1,categoryId:1,occurredAt:-1}`, sparse unique `{userId:1,dedupeKey:1}` | **Never float money.** Category name+color denormalized onto the doc for list rendering; corrected by a background backfill on category rename.               |
| **Habit**                | Definition                           | `name`, `icon`, `color`, `frequency` (daily\|weekly), `targetCount`, `unit`, `reminderTime`, `archivedAt`                                                                      | `{userId:1,archivedAt:1}`                                                                                  | Soft-archive, never delete — logs must survive                                                                                                                |
| **HabitLog**             | One completion event                 | `habitId`, `localDate`, `count`, `completedAt`, `source`                                                                                                                       | **unique {userId:1,habitId:1,localDate:1}**                                                                | The unique index *is* the idempotency guarantee. Streaks are computed from these, not stored — except a cached `currentStreak` on Habit, recomputed on write. |
| **FoodEntry**            | One food item                        | `name`, `mealType`, `servings`, `calories`, `protein/carbs/fat`, `loggedAt`, `localDate`, `source`, `foodRef?`                                                                 | `{userId:1,localDate:1,mealType:1}`                                                                        | Macros **denormalized at log time** — if the food DB later changes a value, history must not silently mutate                                                  |
| **DailyNutrition**       | Rollup                               | `localDate`, `totalCalories`, macros, `entryCount`                                                                                                                             | unique `{userId:1,localDate:1}`                                                                            | Materialized on FoodEntry write. Pure cache — must be rebuildable from FoodEntry.                                                                             |
| **WaterEntry**           | A drink                              | `amountMl`, `loggedAt`, `localDate`                                                                                                                                            | `{userId:1,localDate:1}`                                                                                   |                                                                                                                                                               |
| **Reminder**             | Scheduled nudge                      | `type`, `refId`, `time`, `days[]`, `enabled`, `lastFiredAt`                                                                                                                    | `{userId:1,enabled:1}`                                                                                     | Local notifications on-device; this is the sync'd definition                                                                                                  |
| **PersonalEvent**        | **Normalized timeline**              | `type`, `source`, `timestamp`, `localDate`, `timezone`, `confidence`, `metadata`, `refId`, `dedupeKey`                                                                         | `{userId:1,localDate:-1,timestamp:-1}`, **unique {userId:1,dedupeKey:1}**                                  | Append-only. TTL: **none** — this is the user's history. Archive to cold storage past 24mo if volume demands.                                                 |
| **InferredContext**      | A suggestion                         | `type`, `confidence`, `supportingEventIds[]`, `status`, `proposedPayload`, `correctionHistory[]`, `expiresAt`                                                                  | `{userId:1,status:1,createdAt:-1}`, TTL on `expiresAt` for `pending`                                       | Pending suggestions expire after 48h so stale cards don't pile up                                                                                             |
| **DailySummary**         | Deterministic day rollup             | `localDate`, `metrics{expenses,habits,nutrition,water,activity}`, `eventCount`, `generatedAt`                                                                                  | unique `{userId:1,localDate:1}`                                                                            | Computed in code. **This — not raw docs — is what the AI Context Builder reads.**                                                                             |
| **DataSourceConnection** | Privacy ledger                       | `source`, `status`, `grantedScopes[]`, `lastSyncedAt`, `aiAllowed`, `connectedAt`                                                                                              | unique `{userId:1,source:1}`                                                                               | Powers the Connected Context screen and gates every collector at runtime                                                                                      |
| **AIInsight**            | Generated insight                    | `type`, `title`, `description`, `severity`, `confidence`, `supportingMetrics`, `supportingEventIds[]`, `periodStart/End`, `generatedAt`, `expiresAt`, `status`, `userFeedback` | `{userId:1,status:1,generatedAt:-1}`                                                                       | `supportingMetrics` is what backs "Why am I seeing this?"                                                                                                     |

**Timezone rule (non-negotiable):** every timestamped doc stores `timestamp` (UTC), `timezone` (IANA), and `localDate` (`YYYY-MM-DD`, computed at write time in the user's tz). Day/week/month queries filter on `localDate`. A user flying to another timezone changes future writes only; history stays anchored to where it happened.

---

## 6. Redis Assessment

**Redis is NOT required for the MVP. It will not be added.**

Everything it would do, the MVP doesn't need yet:

- *Caching* — `DailySummary` and `AIInsight` are already materialized in Mongo with `expiresAt`. That is the cache.
- *Queues* — insight generation is per-user and on-demand (with a cached result), not a fan-out batch.
- *Rate limiting* — `@fastify/rate-limit` in-memory is fine for a single instance.
- *Sessions* — JWT + refresh token rotation, stateless.

**Introduce Redis + BullMQ when any of these becomes true:**

1. Nightly summary/insight generation runs for enough users that it can't finish inside a request or a single cron tick.
2. The API scales past one instance (in-memory rate limiting and the in-process event bus both stop being correct at that point).
3. LLM calls need queueing/retry/backoff and cost control across users.
4. Passive-source syncs need to be processed asynchronously off the request path.

Realistically that is around the Phase 10–11 boundary, at real user volume. Not before.

---

## 7. Synthesia AI Integration Boundary

The LLM sits behind **one interface**, on the server, and the mobile client never talks to a model provider.

```ts
interface InsightProvider {
  generate(ctx: AIContext): Promise<GeneratedInsight[]>;
}
```

- `AIContext` is **structured, aggregated, and redacted** — the JSON shape in `AGENTS.md`. Never raw documents, never free-text notes unless the user opted in, never merchant names or locations unless the relevant `DataSourceConnection.aiAllowed` is true.
- All arithmetic (totals, deltas, %, completion rates, trend direction) is computed **before** the call. The model's only job is to *interpret* the numbers and pick what's worth saying — it is explicitly instructed not to compute.
- Output is forced through a strict schema (tool-use / structured output) and validated with zod. Anything that doesn't validate, or cites metrics not present in the context, is **dropped, not shown**. This is the guard against fabricated insights.
- Every insight persists the exact `supportingMetrics` and `supportingEventIds` it was given → "Why am I seeing this?" renders from stored evidence, not from another model call.
- Provider key lives in server env only. The provider is swappable behind the interface.
- **Consent gate:** if `UserPreference.aiEnabled` is false, no context is ever built and no call is ever made.

*(Which model/provider "Synthesia AI" actually is remains an open question — see below. The boundary above is provider-agnostic by design, so the answer doesn't block Phases 1–10.)*

---

## 8. Phased Implementation Plan

| Phase                           | Goal                                                                                                                                                                                  | Output                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **1. Foundation**               | Monorepo, Expo dev client, Fastify API, Mongo, shared zod package, theme + design system primitives (Text, Card, Button, Chip, Ring, Sheet), env validation, CI (lint/typecheck/test) | App boots to a themed screen; API healthchecks; `pnpm check` green |
| **2. Auth & user setup**        | Signup/login, refresh rotation, secure token storage, onboarding (the 3 screens), timezone + currency + targets capture                                                               | Authenticated session; User + UserPreference created               |
| **3. Personal Context Engine**  | `PersonalEvent`, dedupe, in-process bus, normalizers, `emit()` from domain services. **Heavily unit-tested.**                                                                         | Any domain write produces exactly one normalized event             |
| **4. Today Timeline**           | The Home screen from the screenshots: ring, chips, section cards, timeline rail                                                                                                       | The core experience, driven by real events                         |
| **5. Expenses**                 | CRUD, categories, minor-unit money, daily/weekly/monthly totals, list + detail                                                                                                        | Expense tracker complete                                           |
| **6. Habits**                   | CRUD (New Habit + Choose Icon screens), logging, **streak engine**, weekly analysis chart                                                                                             | Habit tracker complete                                             |
| **7. Nutrition**                | Food entry, macros, DailyNutrition rollup, food search *(pending: which food DB)*                                                                                                     | Calorie tracker complete                                           |
| **8. Water & Reminders**        | Water quick-add + ring, reminder definitions, local notifications, deep links                                                                                                         | Water + reminders complete                                         |
| **9. Passive integrations**     | Health (steps/sleep/workouts), Calendar, Weather, opportunistic background sync, `DataSourceConnection` gating, statement import. **Location only if you want it.**                   | Real passive events on the timeline                                |
| **10. Aggregation & inference** | `DailySummary` computation, rule-based detectors, `InferredContext`, suggestion cards, confirm/reject + correction history                                                            | "Looks like you had lunch — add it?" works end to end              |
| **11. Synthesia AI**            | AI Context Builder, provider adapter, schema-validated insights, `AIInsight` storage, Insights screen, "Why am I seeing this?", feedback                                              | Real, evidence-backed insights                                     |
| **12. Privacy**                 | Connected Context screen, per-source disable, data export, deletion, retention jobs                                                                                                   | Every source visible, revocable, deletable                         |
| **13. Polish**                  | Perf, a11y, empty/error/loading states everywhere, e2e, error boundaries, Sentry                                                                                                      | Ship-ready                                                         |

Dependencies: 3 gates 4/10/11 · 5–8 all depend on 3 · 9 gates 10 · 10 gates 11 · 12 must land before any public release.

---

## 9. Build status

Phases 1–8 are built, typechecked, linted, tested, and verified against a live server and a
real MongoDB. Phases 9–13 are scoped but not started.

| Phase                       | Status        | Notes                                                                                                                                                                                                           |
| --------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Foundation               | ✅             | Monorepo, shared zod contract, design system, env validation at boot                                                                                                                                            |
| 2. Auth & user setup        | ✅             | argon2id, JWT + refresh rotation **with reuse detection**, Apple + Google verified server-side, onboarding                                                                                                      |
| 3. Personal Context Engine  | ✅             | `PersonalEvent`, dedupe by unique index, idempotent under concurrency — **16 integration tests against real Mongo**                                                                                             |
| 4. Today Timeline           | ✅             | One request, composed server-side. Ring, chips, habits, suggestions, weekly chart, event rail                                                                                                                   |
| 5. Expenses                 | ✅             | CRUD, categories w/ rename backfill, integer money, **+ multi-channel ingestion** (screenshot / paste / PDF / CSV)                                                                                              |
| 6. Habits                   | ✅             | CRUD, streak engine (grace day, revival, clock-skew, DST), weekly analysis                                                                                                                                      |
| 7. Nutrition                | ✅             | Food entries w/ macro snapshotting, `DailyNutrition` rebuilt-not-incremented                                                                                                                                    |
| 8. Water & Reminders        | ✅             | `clientKey` idempotency (the double-tap), reminder definitions + on-device notifications                                                                                                                        |
| 9. Passive integrations     | ✅ *(partial)* | Health (iOS HealthKit; Android Health Connect — built and emulator-tested, **not yet verified on a phone**), Calendar, Weather and Location collectors ✅, all consent-gated through `emit()`. Health + Calendar background sync (`expo-background-task`, best-effort) is built and unit-tested; **wake-up on a real device is not yet verified**. Weather and Location stay foreground-only; Location remains opt-in and off by default. |
| 10. Aggregation & inference | ✅ *(partial)* | `DailySummary` aggregator ✅ · detectors ✅: `possible_meal`, `low_water`, `unusual_spending`, `possible_habit_completion` (workout → habit), `low_activity`, `missed_habit` (habit slipping) · detectors run on `/today` AND when a sync lands · confirm/reject/correct loop ✅, including habit confirmation. |
| 11. Synthesia AI            | ✅             | Context builder w/ consent + minimization, schema-forced output, **ungrounded insights dropped**, stored evidence, feedback                                                                                     |
| 12. Privacy controls        | ✅             | Connected Context screen, per-source + separate AI toggles, per-source deletion, export, hard account deletion                                                                                                  |
| 13. Polish & testing        | ⬜             | 114 tests today. Remaining: E2E, Sentry, perf pass, a11y audit                                                                                                                                                  |

### Deliberately not built

- **SMS / notification scraping.** Impossible on iOS. On Android `READ_SMS` is restricted but
  can be approved for budget apps after review; we chose not to ask for it. It is listed
  under `blockedPermissions` in `app.json`, so the choice is auditable, not just claimed.
- **UPI integration.** No public API exists. The lawful route (RBI Account Aggregator) needs a
  registered FIU partner and is a post-MVP company decision, not an engineering task.
- **Screen-time / app-usage tracking.** Android-only in practice; iOS `DeviceActivity` data is
  not permitted to leave the device.
- **Redis.** Not needed at this scale — see §6 for the exact triggers that would change that.

### Known gaps

- Background sync is opportunistic, and **has not yet been verified on a device**. Whether
  the OS wakes the task on its own can only be checked by hand; it cannot run in CI or the
  iOS Simulator. Until that check is done, treat it as built and unit-tested, not working.
  On an Android 14 emulator the task does run when its job is forced by hand, which shows
  the wiring and not the wake-up. On iPhone, health reads return nothing while the phone
  is locked.
- Android health comes from Health Connect and is built and emulator-tested, **not yet
  verified on a phone**. Health Connect holds only what the phone itself (Android 14+) or
  another app writes into it. Unless the user has granted its separate background-access
  permission — which the Android 14 emulator does not offer — it answers an app that is
  not on screen differently: on Android 14, aggregates are refused and record reads
  quietly come back empty. So without that permission the reader reads only while the app
  is on screen and the background task sends nothing for health; with it the reader reads
  in the background, a path that has never run. On the emulator a sideloaded build connected,
  with every type allowed and with only some; read steps, a workout, sleep, weight and
  height; took a sex and date of birth typed on the Body screen and let them be corrected
  and removed; and answered Health Connect's policy link with the app running, stopped,
  reclaimed in the background, and from the permission sheet itself (which closes the
  sheet, because the policy is a screen inside the app). Not exercised: real sensor data,
  a wearable, Android 9–13 where Health Connect is a separate app, and anything on a
  physical phone. Health Connect has no record for sex or date of birth, so those are
  only ever typed in. The aggregator reports `null` — not `0` — when health data is
  absent, so nothing downstream fabricates a rest day the user didn't take.
- The AI insight generator has not been exercised against a live Anthropic key (none was
  configured); its consent gate, "not enough history" refusal, and unavailable path are all
  verified.
- No E2E test drives the mobile UI. The API is verified end-to-end via HTTP.

---

## 10. AI provider layer (added after the initial build)

Synthesia AI runs on **Gemini 2.5 Flash** or **Claude**, chosen at deploy time. Nothing
above `apps/api/src/ai/client.ts` imports an SDK or knows which model answered — the
domain code speaks a neutral `AiContent` / `JsonSchema` vocabulary, and each provider
adapts it.

The README previously *claimed* this boundary existed. It did not: `ai/client.ts` imported
the Anthropic SDK directly and every call site spoke its tool-use dialect. Adding Gemini is
what forced the label to become true.

| Concern               | Anthropic                       | Gemini                                                             |
| --------------------- | ------------------------------- | ------------------------------------------------------------------ |
| Structure enforced by | forced tool-use (`tool_choice`) | `responseSchema` on the request                                    |
| Schema dialect        | JSON Schema                     | uppercased types, `nullable: true` (no `['string','null']` unions) |
| Validated by          | the same zod schema             | the same zod schema                                                |

Both are held to the identical rule: **output that fails zod is dropped, not repaired.**
Providers disagree about how strictly they honour a schema; they do not get to disagree
about what we are willing to show a user.

### Three failures that only appeared under a real key

1. **Thinking silently ate the output budget.** Gemini 2.5+ reasons before answering, and
   those tokens come out of `maxOutputTokens` *first*. The result is `finishReason:
   MAX_TOKENS` with an empty candidate — indistinguishable, downstream, from a model that
   had nothing to say. Thinking is now disabled (`thinkingBudget: 0`); none of these tasks
   is a reasoning problem, and the token budget now means what it says.
2. **gemini-2.0-flash had zero free-tier quota** on a working key. The default is now
   `gemini-2.5-flash`. A provider named without its key refuses to boot rather than
   silently no-opping.
3. **Raw paise leaked into user-facing prose.** The model was told values were in minor
   units and faithfully wrote *"you spend 96000 minor\_currency on Fridays"*. Every metric
   now carries a code-formatted `displayValue` (`₹960.00`), and the prompt permits quoting
   only that. Formatting is deterministic — handing it to an LLM is how a ₹960 lunch
   becomes a ₹96,000 one in the sentence the user actually reads.

---

## 11. The public page (added October 2026)

`apps/web` is the page people are sent to: what the app does, what it has and has not been
shown to do, and the two downloads. It is a folder of static files that Vercel serves as it
stands. There is no framework and no build step, because one page needs neither, and no
dependency, so the lockfile gains nothing.

Three decisions shape it:

- **The app's screens are rebuilt in HTML**, from the same colour values as
  `apps/mobile/src/theme`, rather than shown as screenshots. They follow the visitor's light
  or dark setting, weigh almost nothing, and each is exposed to a screen reader as one
  described picture, so sample data is never read out as fact.
- **The download buttons are plain links to `releases/latest/download/…`.** They follow every
  release with no redeploy and work with JavaScript off. A test reads the artifact names out
  of the build workflows, so renaming one there fails here instead of leaving a dead button.
- **The page's claims are held by tests.** `test/copy.test.mjs` requires each "not yet
  verified" statement and forbids the claims the project cannot back. When a statement stops
  being true, the sentence and the test change together.

The only request the page makes to another host is one call to GitHub's public API, for the
latest release's version, date and file sizes. The content-security policy in `vercel.json`
allows that and nothing else. `scripts/preview.mjs` serves the page locally with the same
headers, so a violation shows up before a deploy rather than after, and `scripts/shoot.mjs`
loads it in a throwaway headless Chrome at a chosen width and theme.

Deploys are by hand, with the Vercel CLI, from `apps/web`.
