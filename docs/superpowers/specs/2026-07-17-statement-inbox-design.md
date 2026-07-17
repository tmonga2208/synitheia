# Statement Inbox — design

**Date:** 2026-07-17
**Status:** Approved for planning
**Area:** `apps/api` (expenses ingestion), `apps/mobile` (expenses), `packages/shared`

## Problem

Users want their bank / UPI transactions to appear in Expenses without typing each
one. The obvious ask — "connect my bank / UPI" for a live feed — is not reachable
for this app:

- **UPI** exposes no public per-user transaction API (NPCI / GPay / PhonePe / Paytm).
- **SMS/notification capture** is blocked: iOS exposes no SMS access; Play Store
  restricts `READ_SMS` to default SMS-handler apps and rejects "expense tracking"
  as a use case.
- **Account Aggregator** — the only RBI-compliant live route — requires the app to
  *be* a regulated FIU (RBI/SEBI/IRDAI/PFRDA) or contractually ride one via a TSP.
  Onboarding is ~5–10 months, ₹5–25 lakh/yr + per-fetch fees, plus quarterly
  self-tests and biennial audits. Not reachable for an unregulated indie app.
- **Statement-fetch vendors** (FinBox, Perfios) are enterprise-sales, lending-oriented,
  no self-serve sandbox; their non-AA "live" mode uses net-banking credentials through
  a third party — which contradicts this app's stated anti-scraper posture.

The **closest-to-live path that is actually buildable now** is the data banks already
push by email: real-time transaction-alert emails, plus monthly e-statements. If the
user auto-forwards that mail to us, it flows into the ingestion pipeline that already
exists.

## What already exists (reused, not rebuilt)

`apps/api/src/modules/expenses/ingestion.ts` already implements the full pipeline:

- Channels: `screenshot`, `text`, `pdf` (incl. password-protected), `csv`.
- `extract()` → AI structured extraction → `DraftTransaction[]` with confidence,
  evidence, debit/credit direction.
- `markDuplicates()` → flags drafts matching an existing expense (same amount within
  24h) — so an alert email and the monthly statement of the same transaction dedupe.
- `ExpenseIngestion` records with `status: 'needs_review'`, `drafts`, TTL cleanup.
- Confirm flow: `POST /expenses/ingestions/:id/confirm` is the only path from draft to
  a real `Expense`, requiring an explicit per-draft `categoryId` (Detect → Infer →
  Suggest → Confirm).

**This feature adds a new front door (`email`) to that pipeline. It writes no new AI
code and changes none of the confirm semantics.**

## Architecture & data flow

```
Bank → user's Gmail → [user's auto-forward rule] → inbox-<token>@in.<domain>
     → Cloudflare Email Routing → Email Worker (adds shared secret)
     → POST /webhooks/email  (unauthenticated route, shared-secret checked)
     → resolve user by <token> → idempotency check on Message-ID
     → normalize { from, subject, text || html→text, attachments[] }
     → ingestText(body)   |  ingestPdf(unlocked PDF attachment)
     → drafts + markDuplicates
     → ExpenseIngestion { channel: 'email', status: 'needs_review' | 'needs_password' }
     → mobile "Review inbox" → user confirms → Expense
```

**Why forwarding, not Gmail OAuth:** `gmail.readonly` is a Google *restricted scope*
requiring a paid security assessment + full app verification, and the Android OAuth
client is not yet set up. Forwarding needs none of that, reads only what the user
chooses to forward (not the whole inbox), and matches the existing per-item-consent
posture.

## Vendor (free-first)

Point the domain's **MX record** at an inbound provider that receives SMTP and calls
the webhook.

- **Default: Cloudflare Email Routing + Email Worker** — free, no per-email cost, no
  volume caps. Requires the domain's DNS zone on Cloudflare (keep registration at
  Vercel; point nameservers at Cloudflare — free). The Worker receives the raw email,
  attaches the shared secret, and POSTs JSON to `/webhooks/email`.
- **Fallback: SendGrid Inbound Parse** — free, only an MX record on Vercel DNS (no
  nameserver move), but POSTs `multipart/form-data`, which needs a route-scoped
  content-type parser (the global `@fastify/multipart` is configured `files: 1`).

The webhook handler is a thin adapter over a normalized
`{ to, from, subject, text, html, attachments[] }` shape, so the vendor is swappable
in a few lines. Design against Cloudflare.

The Cloudflare Email Worker is a small standalone script (a few dozen lines: receive
raw email, extract recipient + parts, POST JSON with the bearer secret). It lives in
the repo at `infra/email-worker/` with its own `wrangler.toml`, deployed separately
from the API — it is not part of the Fastify app.

## Backend components

### `packages/shared`
- `ingestionChannelSchema`: add `'email'`.
- `ingestionStatusSchema`: add `'needs_password'` (locked PDF received, not yet importable).

### `apps/api` — models (`db/models.ts`)
- **User:** add `inboundToken: { type: String, default: null, select: false }` with a
  partial-unique index on string values (mirroring the `appleSub`/`googleSub` pattern),
  and `inboundEnabledAt: { type: Date, default: null }`. Generated lazily on first
  setup, never at signup.
- **ExpenseIngestion:** add optional `messageId: { type: String, default: null }`
  (idempotency) and `source: { type: Schema.Types.Mixed, default: null }` holding
  `{ from, subject, receivedAt }` for display in the review inbox. Add a partial-unique
  index on `{ userId, messageId }` for string `messageId` to make retries idempotent.

### `apps/api` — endpoints
Authed (in `expenses/routes.ts`):
- `POST /expenses/inbox` → idempotently generate + return `{ address }`
  (`inbox-<token>@in.<domain>`), set `inboundEnabledAt` on first call.
- `GET /expenses/inbox` → `{ address, enabledAt, lastReceivedAt }` for the setup
  screen's "waiting → connected" state (`lastReceivedAt` = newest `email`-channel
  ingestion `createdAt`).
- `GET /expenses/ingestions` (existing) → widen `listPendingIngestions` to return
  status `needs_review` **and** `needs_password`, so locked-statement items surface in
  the review inbox rather than silently vanishing.

Unauthenticated webhook (new module, e.g. `modules/webhooks/`), mounted **outside** the
authed route group:
- `POST /webhooks/email`:
  1. Verify shared secret: the Worker sets `Authorization: Bearer <INBOUND_WEBHOOK_SECRET>`;
     the API compares constant-time. Missing/wrong → 401.
  2. Parse the recipient local-part → `<token>`; resolve user (must `.select('+inboundToken')`).
     Unknown token → **200 + drop** (no account-enumeration signal).
  3. Idempotency: if `{ userId, messageId }` already processed → 200 + skip.
  4. Normalize; for each part:
     - Body (text, else html→text) → `ingestText`.
     - `application/pdf` attachment, unlocked → `ingestPdf`.
     - `application/pdf` attachment, locked (pdf.js `PasswordException`) → create an
       `ExpenseIngestion { status: 'needs_password', drafts: [] }` with source metadata,
       storing **no bytes**.
  5. `ingestText`/`ingestPdf` throwing `ingestionFailed` on empty (e.g. a promo email
     that slipped the user's filter) → swallow, 200 + drop, create no empty record.
  6. Always return 200 on handled input so the provider does not retry-storm.

### `apps/api` — config (`config/env.ts`)
- Add `INBOUND_DOMAIN` (e.g. `in.synitheia.app`) and `INBOUND_WEBHOOK_SECRET` to the zod
  env schema.

### `apps/api` — app wiring (`app.ts`)
- Register the webhook route in its own group **without** `requireAuth`, exempt from the
  aggressive auth rate-limit (a separate, sane limit is fine).

## Mobile components

- **Extract** the draft-review UI currently embedded in `app/expenses/new.tsx` into a
  reusable `src/components/DraftReview.tsx` (props: `ingestionId`, callbacks). Both the
  upload flow and the review inbox render it — no duplicated confirm logic.
- **`app/expenses/inbox-setup.tsx`** (root-stack screen): shows the address + copy
  button, step-by-step Gmail auto-forward instructions (with a note for other
  providers), and a live "waiting for your first email… → Connected" state polling
  `GET /expenses/inbox`.
- **`app/expenses/review.tsx`** (root-stack screen): lists pending ingestions
  (`GET /expenses/ingestions`) with source (from/subject), channel, and draft count;
  tap → `<DraftReview>` → confirm/reject. `needs_password` items render a
  "password-locked — open in the app to import" affordance routing to the existing
  upload flow.
- **Entry points:** a "**N to review**" row on `app/expenses/index.tsx` → review screen;
  a "Connect bank emails" entry both there and in the Connected Context / privacy
  screen. Both new screens are root-stack pushes and get the standard `ArrowLeft →
  router.back()` back button (consistent with the native-tabs fix; see
  `native-tabs-hidden-triggers-unreachable`).

## Edge cases & error handling

- **Unknown / stale token** → 200 + drop.
- **Provider retry** → idempotent via `{ userId, messageId }`.
- **Promo email forwarded by accident** (no transaction) → 200 + drop, no empty record.
- **Locked monthly e-statement** → `needs_password` inbox item, no bytes stored; user
  finishes via in-app upload (already handles passwords).
- **Injection** (someone guesses/learns an address) → address is high-entropy and
  secret; worst case is spam *drafts*, which are never expenses until the user confirms,
  and the review inbox shows the sender so junk is obvious. No byte storage, no auto-write.
- **Attachment size** → cap parsed attachment size; oversized → skip with a logged note.

## Testing

Extend `apps/api/src/modules/expenses/ingestion.test.ts` (and a new webhook test) with
fixtures:
- Alert-email HTML body → one debit draft.
- Unlocked PDF attachment → drafts.
- Locked PDF attachment → `needs_password`, no bytes stored.
- Unknown token → 200, no record.
- Bad secret → 401.
- Promo email (no transaction) → 200, no record.
- Duplicate `Message-ID` retry → single record (idempotent).
- Alert email + later statement of same txn → second flagged duplicate (existing
  `markDuplicates`).

## Privacy & consent

- Setup is explicit user action (they create the forward rule) — consent by construction.
- Address is a secret (`select: false`, high-entropy).
- Drafts only; nothing becomes an expense without per-item confirm.
- Existing TTL removes unreviewed drafts.
- No inbox access, no OAuth, no stored statements/bytes. Documented in the Connected
  Context / privacy screen.

## Explicitly out of scope (YAGNI)

- Gmail OAuth / Gmail API.
- Account Aggregator (revisit only if a regulated-FIU partnership is secured).
- Storing raw statement bytes.
- SMS ingestion.
- v1 handles alert emails + unlocked PDF attachments; locked monthly statements fall
  back to the existing in-app upload flow.

## Dependencies / assumptions

- A domain the user controls (registration at Vercel is fine), with DNS movable to
  Cloudflare for Email Routing — or an MX record added on Vercel DNS if using the
  SendGrid fallback.
- Existing AI provider (Gemini/Anthropic) and Railway API — no new paid service.
