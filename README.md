# Synítheia

A personal daily intelligence system. Not a habit tracker with an expense tab bolted on —
one product that understands your day.

The user should feel: *"the app understands my day without me constantly updating it."*

```
apps/
  api/       Node 22 · Fastify · TypeScript · Mongoose
  mobile/    React Native · Expo (custom dev client) · Expo Router
  web/       The public page · plain HTML and CSS, no build step
packages/
  shared/    zod schemas, domain types, money + timezone primitives — the contract both sides compile against
  config/    tsconfig / eslint bases
```

Full architecture, the passive-data feasibility matrix, and the phased plan: **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

---

## Running it

```bash
pnpm install
pnpm db:up                          # Mongo 8 as a single-node replica set, via Docker
cp apps/api/.env.example apps/api/.env   # then set JWT_SECRET (32+ chars)
pnpm api                            # http://localhost:4000
pnpm mobile                         # Expo dev client
```

The public page needs none of that:

```bash
pnpm --filter @synitheia/web preview   # http://127.0.0.1:4173, with production's response headers
```

An AI key is optional. Without one the app is fully functional; the Synthesia AI layer
simply reports itself unavailable. Every AI path is gated on **both** a key and the
user's explicit consent.

Set **one** of `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` (pick with `AI_PROVIDER` if both
are present). The provider is a deployment choice — no domain code imports an SDK or
knows which model answered.

Two things learned the hard way, now encoded:
- **Gemini 2.5+ thinks by default, and thinking tokens are drawn from `maxOutputTokens`
  before any answer is produced.** Left on, it returns `finishReason: MAX_TOKENS` with an
  empty response — which reads as "the model returned nothing". It is disabled.
- **Money is formatted in code, never by the model.** Amounts are minor units, and a
  model handed `96000` will faithfully write *"you spend 96000 on Fridays"*. Every metric
  carries a `displayValue` (`₹960.00`) and the model may only quote that.

```bash
pnpm check                          # typecheck + lint + test, everything
```

---

## The five ideas the code is organised around

### 1. A local day is not a UTC day

Every timestamped record stores a UTC instant, an IANA timezone, **and** a precomputed
`localDate` (`YYYY-MM-DD`). Every "today" / "this week" query filters on `localDate`, never
on a UTC range.

Without this, a user in Asia/Kolkata logging water at 11pm has it filed under *tomorrow*,
and their streak silently breaks overnight. `packages/shared/src/time/local-date.ts` does
all calendar arithmetic in pure UTC — never via the host's local time — and its test suite
runs under four server timezones (UTC, IST, New York, UTC+14) to prove the server's own
location cannot influence a user's day.

### 2. Money is an integer

`0.1 + 0.2 !== 0.3`. Amounts are integer minor units (paise, cents) everywhere — the wire,
the database, every sum. Floats appear exactly once: when a human types `"12.50"`.
A Mongoose validator rejects a non-integer amount as a last line of defence.

### 3. The Personal Context Engine

Every meaningful thing that happens — typed, imported, sensed, or inferred — becomes one
normalized `PersonalEvent`. The Today timeline, the daily aggregator, and the AI context
builder then read one uniform stream instead of joining nine collections.

It is a **projection**, not a source of truth: an `Expense` remains the authority on an
expense. And it is idempotent by construction — every event carries a `dedupeKey` under a
unique index, because HealthKit will re-deliver Sunday's steps on every background wake for
days, and each delivery must collapse onto the same row. That guarantee lives in the
database, not in application code that can forget it.

### 4. Detect → Infer → Suggest → Confirm

Never *Detect → Silently Assume*.

Detectors are deterministic rules over events. They produce an `InferredContext` — a
*question*, with a confidence score and legible evidence — and **never** write a domain
record. Only the user's confirmation does that.

> *Looks like you had lunch around 1:04 PM* — Add it to today?
> Based on: a Food expense at 1:04 PM · confidence 0.62

No LLM is anywhere near this loop. A hallucinated meal in someone's calorie log, or a
hallucinated ₹400 in their expenses, is a real harm, and a model that is right 95% of the
time does it roughly once a fortnight. Confirmed suggestions are marked `source: 'inferred'`
forever — the app can always tell the user what they entered and what it guessed.

### 5. Synthesia AI interprets; it never calculates

Synthesia AI is our name for the insight layer, not a third-party product. Behind it:
**Gemini or Claude**, chosen at deploy time behind one genuinely swappable interface — no
domain code imports an SDK or knows which model answered.

The **AI Context Builder** enforces three things, in order:

1. **Consent** — checked *before* any context is assembled, so no code path exists where an
   un-consented field is built and then filtered out downstream.
2. **Minimization** — aggregates, never rows. The model sees *"food spending averaged ₹482
   across 4 Fridays"*. It never sees the merchant, the note, or the location. It cannot leak
   what it was never given.
3. **Determinism** — every number is computed in application code first. The model's only
   job is to notice which of them is worth telling the user about.

Output is forced through a schema, and any insight citing a metric we did not supply is
**dropped, not repaired** — an invented number in a confident sentence is indistinguishable
from a true one to the person reading it. "Why am I seeing this?" renders the stored metrics
the model was actually shown, not a second model call reconstructing a plausible rationale.

An empty result is a correct answer. Most days contain nothing worth remarking on.

---

## What we don't do, and why

The brief asked for automatic transaction capture. **The platforms will not allow it**, and
pretending otherwise would have produced a feature that either doesn't work or gets the app
pulled:

- **iOS exposes no SMS or notification access at all.** Not restricted — absent.
- **Play Store restricts `READ_SMS`** to default SMS handler apps. "Finance tracking" is not
  an approvable use case. (`app.json` lists it under `blockedPermissions`, so this is
  auditable rather than merely claimed.)
- **UPI has no public API.** The lawful route in India is the RBI Account Aggregator
  framework, which requires a registered FIU partner.

So the user hands us the data instead — share the payment screenshot, paste the transaction
SMS, upload a statement. This works on iOS, needs no restricted permission, and arrives with
explicit per-item consent. Via the share sheet it is two taps, which is *less* manual work
than most "automatic" trackers achieve in practice.

Screenshots and free-text SMS go to a vision model. **CSV does not** — it already has
structure, and making a solved problem probabilistic would be spending money and latency to
get worse answers.

Everything ingested is a **draft**. Nothing becomes an expense without confirmation.

The **Connected Context** screen lists every source — including the ones we *can't* use, with
the explanation intact. Collecting a source and letting the AI reason about it are two
separate toggles, because bundling them would be a dark pattern.

---

## Testing

Priority goes to the things that are silently wrong rather than loudly broken:

| Area | Where |
|---|---|
| Timezone & local-day arithmetic (incl. DST, leap years, UTC+14) | `packages/shared/src/time/local-date.test.ts` |
| Money — no float drift, INR lakh grouping, zero-decimal currencies | `packages/shared/src/money/money.test.ts` |
| Habit streaks — the grace day, revival, clock-skew, DST | `packages/shared/src/domain/streak.test.ts` |
| The daily-flow ring — reachable at 100%, never NaN | `packages/shared/src/domain/today.test.ts` |
| Event dedupe & idempotency, under real concurrency | `apps/api/src/context/engine.test.ts` |
| Detector confidence, and that detectors never write | `apps/api/src/context/detectors.test.ts` |

The engine and detector suites run against a **real MongoDB**, not mocks — the properties
under test are enforced by unique indexes, and a mock would happily accept a duplicate and
report success, testing nothing but itself.
