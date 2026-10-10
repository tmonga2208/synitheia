# Statement Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each user a secret forwarding email address so bank/UPI transaction alerts and e-statements they auto-forward flow into the existing expense-ingestion pipeline and appear as reviewable drafts.

**Architecture:** A new `email` channel on the existing ingestion pipeline. A Cloudflare Email Worker receives forwarded mail and POSTs JSON to an unauthenticated, shared-secret webhook on the Fastify API. The webhook resolves the user by a token in the recipient address, then reuses `ingestEmail`/`ingestPdf` to produce drafts. Mobile gets a reusable `<DraftReview>` (extracted from the existing upload screen), a setup screen, and a review inbox.

**Tech Stack:** Fastify + Mongoose + Zod (API), Vitest + mongodb-memory-server (tests), Expo Router + React Native + TanStack Query (mobile), Cloudflare Email Workers + postal-mime (inbound mail).

## Global Constraints

- Nothing becomes an `Expense` without explicit per-draft user confirmation (Detect → Infer → Suggest → Confirm). The webhook only ever writes `ExpenseIngestion` drafts.
- No statement bytes are persisted. A locked PDF becomes a `needs_password` record with `drafts: []` and no file storage.
- The inbound address token is high-entropy and stored `select: false`. Unknown-token mail is dropped with HTTP 200 (no account-enumeration signal).
- The webhook is idempotent on `messageId` (provider retries must not double-file).
- Reuse the existing `extract()` AI path, `markDuplicates()`, TTL, and confirm flow. Write no new AI code.
- Feature is gated on `INBOUND_DOMAIN` + `INBOUND_WEBHOOK_SECRET`; absent → inbox endpoints 400 and the webhook no-ops.
- API tests that touch Mongo use `MongoMemoryReplSet` per the pattern in `apps/api/src/context/engine.test.ts` (`beforeAll` connect + `syncIndexes`, `afterEach` `deleteMany`, `afterAll` disconnect+stop). The AI client is mocked with `vi.mock('../../ai/client.js', ...)`.
- Spec: `docs/superpowers/specs/2026-07-17-statement-inbox-design.md`.

---

## File structure

**Shared**
- Modify `packages/shared/src/domain/expense.ts` — add `'email'` channel, `'needs_password'` status.

**API**
- Modify `apps/api/src/config/env.ts` — `INBOUND_DOMAIN`, `INBOUND_WEBHOOK_SECRET`, `isInboundConfigured`.
- Modify `apps/api/src/db/models.ts` — User `inboundToken`/`inboundEnabledAt`; ExpenseIngestion `messageId`/`source` + index.
- Create `apps/api/src/modules/expenses/inbox.ts` — token/address helpers + `getOrCreateInbox`/`getInbox`.
- Create `apps/api/src/modules/expenses/inbox.test.ts` — pure helper tests + Mongo integration.
- Modify `apps/api/src/modules/expenses/ingestion.ts` — `ingestEmail`, `recordLockedStatement`, `meta` threading, widen `listPendingIngestions`.
- Create `apps/api/src/modules/webhooks/email.ts` — payload parsing + `handleInboundEmail`.
- Create `apps/api/src/modules/webhooks/email.test.ts` — pure parsing/routing tests + Mongo integration.
- Create `apps/api/src/modules/webhooks/routes.ts` — `registerWebhookRoutes`.
- Modify `apps/api/src/modules/expenses/routes.ts` — `POST /expenses/inbox`, `GET /expenses/inbox`.
- Modify `apps/api/src/app.ts` — register webhook routes.

**Inbound mail worker**
- Create `infra/email-worker/{package.json,wrangler.toml,src/worker.js,README.md}`.

**Mobile**
- Modify `apps/mobile/src/api/types.ts` — inbox response type (channel/status already string unions — verify).
- Create `apps/mobile/src/components/DraftReview.tsx` — extracted review component.
- Modify `apps/mobile/app/expenses/new.tsx` — use `<DraftReview>`.
- Create `apps/mobile/app/expenses/inbox-setup.tsx` — address + instructions + status.
- Create `apps/mobile/app/expenses/review.tsx` — pending-ingestion inbox.
- Modify `apps/mobile/app/expenses/index.tsx` — entry points.
- Modify `apps/mobile/app/_layout.tsx` — register the two new screens.

---

## Task 1: Shared enums

**Files:**
- Modify: `packages/shared/src/domain/expense.ts:208-217`

**Interfaces:**
- Produces: `ingestionChannelSchema` now accepts `'email'`; `ingestionStatusSchema` now accepts `'needs_password'`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/domain/expense.email.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ingestionChannelSchema, ingestionStatusSchema } from './expense.js';

describe('ingestion enums', () => {
  it('accepts the email channel', () => {
    expect(ingestionChannelSchema.parse('email')).toBe('email');
  });
  it('accepts the needs_password status', () => {
    expect(ingestionStatusSchema.parse('needs_password')).toBe('needs_password');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @synitheia/shared test -- expense.email`
Expected: FAIL — `'email'` / `'needs_password'` not in enum.

- [ ] **Step 3: Implement**

In `expense.ts`, change the two enums:

```ts
export const ingestionChannelSchema = z.enum(['screenshot', 'text', 'pdf', 'csv', 'email']);
```

```ts
export const ingestionStatusSchema = z.enum([
  'parsing',
  'needs_review', //  parsed; waiting for the user
  'needs_password', // a locked statement arrived; user must open it in-app to import
  'confirmed',
  'rejected',
  'failed',
]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @synitheia/shared test -- expense.email`
Expected: PASS.

- [ ] **Step 5: Build shared so downstream packages see the types**

Run: `pnpm --filter @synitheia/shared build`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/domain/expense.ts packages/shared/src/domain/expense.email.test.ts
git commit -m "feat(shared): add email ingestion channel and needs_password status"
```

---

## Task 2: API env config

**Files:**
- Modify: `apps/api/src/config/env.ts:61-67,147-157`

**Interfaces:**
- Produces: `Env['INBOUND_DOMAIN']: string | undefined`, `Env['INBOUND_WEBHOOK_SECRET']: string | undefined`; `isInboundConfigured(env): boolean`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/config/env.inbound.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadEnv, resetEnvCache, isInboundConfigured } from './env.js';

const base = {
  MONGO_URI: 'mongodb://localhost:27017/test',
  JWT_SECRET: 'x'.repeat(48),
};

describe('inbound env', () => {
  it('is unconfigured without domain + secret', () => {
    resetEnvCache();
    const env = loadEnv({ ...base } as NodeJS.ProcessEnv);
    expect(isInboundConfigured(env)).toBe(false);
  });
  it('is configured with both', () => {
    resetEnvCache();
    const env = loadEnv({
      ...base,
      INBOUND_DOMAIN: 'in.example.app',
      INBOUND_WEBHOOK_SECRET: 's'.repeat(32),
    } as NodeJS.ProcessEnv);
    expect(isInboundConfigured(env)).toBe(true);
    expect(env.INBOUND_DOMAIN).toBe('in.example.app');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @synitheia/api test -- env.inbound`
Expected: FAIL — `isInboundConfigured` is not exported.

- [ ] **Step 3: Implement**

In `env.ts`, add to the schema object (after `RATE_LIMIT_WINDOW`):

```ts
    /**
     * Statement Inbox — inbound email ingestion. Optional: absent, the inbox endpoints
     * return 400 and the webhook no-ops. INBOUND_DOMAIN is the domain whose MX points at
     * the inbound provider (e.g. "in.synitheia.app"); the secret authenticates the
     * provider's webhook calls.
     */
    INBOUND_DOMAIN: z.string().optional(),
    INBOUND_WEBHOOK_SECRET: z.string().min(16).optional(),
```

Add near `isImageKitConfigured`:

```ts
export function isInboundConfigured(env: Env): boolean {
  return Boolean(env.INBOUND_DOMAIN && env.INBOUND_WEBHOOK_SECRET);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @synitheia/api test -- env.inbound`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config/env.ts apps/api/src/config/env.inbound.test.ts
git commit -m "feat(api): add INBOUND_DOMAIN and INBOUND_WEBHOOK_SECRET env config"
```

---

## Task 3: Models — inbound token and ingestion source

**Files:**
- Modify: `apps/api/src/db/models.ts:23-62` (User), `:270-284` (ExpenseIngestion)

**Interfaces:**
- Produces: User docs carry `inboundToken: string | null` (`select: false`) and `inboundEnabledAt: Date | null`; ExpenseIngestion docs carry `messageId: string | null` and `source: unknown`. Partial-unique indexes on `inboundToken` (string) and `{ userId, messageId }` (string messageId).

- [ ] **Step 1: Implement the User fields**

In the `userSchema` object, after `onboardedAt`:

```ts
    /**
     * Statement Inbox address token. High-entropy, secret, and never selected by default
     * (a stray `.find()` must not hand it out). Null until the user enables the inbox.
     */
    inboundToken: { type: String, default: null, select: false },
    inboundEnabledAt: { type: Date, default: null },
```

After the `googleSub` partial index block, add:

```ts
userSchema.index(
  { inboundToken: 1 },
  { unique: true, partialFilterExpression: { inboundToken: { $type: 'string' } } },
);
```

- [ ] **Step 2: Implement the ExpenseIngestion fields**

In `expenseIngestionSchema`, after `error`:

```ts
    /** Provider Message-ID, for idempotency against retries. Null for non-email channels. */
    messageId: { type: String, default: null },
    /** Display metadata for email-sourced ingestions: { from, subject, receivedAt }. */
    source: { type: Schema.Types.Mixed, default: null },
```

After the existing `expenseIngestionSchema.index(...)` lines:

```ts
expenseIngestionSchema.index(
  { userId: 1, messageId: 1 },
  { unique: true, partialFilterExpression: { messageId: { $type: 'string' } } },
);
```

- [ ] **Step 3: Write an integration test proving the token index is unique**

Create `apps/api/src/db/models.inbound.test.ts`:

```ts
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { UserModel } from './models.js';

let mongo: MongoMemoryReplSet;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await UserModel.syncIndexes();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await UserModel.deleteMany({});
});

const baseUser = { name: 'A', timezone: 'Asia/Kolkata', currency: 'INR' };

describe('inboundToken index', () => {
  it('allows many users with no token (null)', async () => {
    await UserModel.create({ ...baseUser, email: 'a@x.com' });
    await UserModel.create({ ...baseUser, email: 'b@x.com' });
    expect(await UserModel.countDocuments()).toBe(2);
  });

  it('rejects two users sharing the same token', async () => {
    await UserModel.create({ ...baseUser, email: 'a@x.com', inboundToken: 'dup' });
    await expect(
      UserModel.create({ ...baseUser, email: 'b@x.com', inboundToken: 'dup' }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @synitheia/api test -- models.inbound`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/models.ts apps/api/src/db/models.inbound.test.ts
git commit -m "feat(api): add inbound token to User and messageId/source to ExpenseIngestion"
```

---

## Task 4: Inbox helpers and service

**Files:**
- Create: `apps/api/src/modules/expenses/inbox.ts`
- Create: `apps/api/src/modules/expenses/inbox.test.ts`

**Interfaces:**
- Consumes: `UserModel`, `ExpenseIngestionModel` (Task 3), `Env` (Task 2).
- Produces:
  - `generateInboundToken(): string` — 32 lowercase hex chars.
  - `inboundAddress(token: string, domain: string): string` — `inbox-<token>@<domain>`.
  - `tokenFromAddress(to: string, domain: string): string | null`.
  - `getOrCreateInbox(env: Env, userId: string): Promise<{ address: string; enabledAt: Date | null; lastReceivedAt: Date | null }>`.
  - `getInbox(env: Env, userId: string): Promise<{ address: string; enabledAt: Date | null; lastReceivedAt: Date | null } | null>`.

- [ ] **Step 1: Write the failing pure-helper test**

Create `apps/api/src/modules/expenses/inbox.test.ts`:

```ts
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { UserModel } from '../../db/models.js';
import {
  generateInboundToken,
  inboundAddress,
  tokenFromAddress,
  getOrCreateInbox,
} from './inbox.js';
import type { Env } from '../../config/env.js';

const env = { INBOUND_DOMAIN: 'in.example.app' } as Env;

describe('inbox helpers (pure)', () => {
  it('generates a 32-char hex token', () => {
    expect(generateInboundToken()).toMatch(/^[a-f0-9]{32}$/);
  });
  it('formats the address', () => {
    expect(inboundAddress('abc123', 'in.example.app')).toBe('inbox-abc123@in.example.app');
  });
  it('round-trips the token, case-insensitively', () => {
    const t = generateInboundToken();
    expect(tokenFromAddress(`INBOX-${t}@IN.EXAMPLE.APP`, 'in.example.app')).toBe(t);
  });
  it('rejects wrong domain, wrong prefix, junk local part', () => {
    expect(tokenFromAddress('inbox-abc@other.app', 'in.example.app')).toBeNull();
    expect(tokenFromAddress('hello-abc@in.example.app', 'in.example.app')).toBeNull();
    expect(tokenFromAddress('inbox-@in.example.app', 'in.example.app')).toBeNull();
  });
});

let mongo: MongoMemoryReplSet;
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await UserModel.syncIndexes();
}, 120_000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
afterEach(async () => {
  await UserModel.deleteMany({});
});

describe('getOrCreateInbox', () => {
  it('creates once and returns the same address on repeat', async () => {
    const u = await UserModel.create({
      name: 'A', email: 'a@x.com', timezone: 'Asia/Kolkata', currency: 'INR',
    });
    const first = await getOrCreateInbox(env, u._id.toString());
    const second = await getOrCreateInbox(env, u._id.toString());
    expect(first.address).toMatch(/^inbox-[a-f0-9]{32}@in\.example\.app$/);
    expect(second.address).toBe(first.address);
    expect(first.enabledAt).not.toBeNull();
    expect(first.lastReceivedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @synitheia/api test -- expenses/inbox`
Expected: FAIL — `./inbox.js` does not exist.

- [ ] **Step 3: Implement `inbox.ts`**

```ts
import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import { UserModel, ExpenseIngestionModel } from '../../db/models.js';
import { AppError } from '../../core/errors.js';
import type { Env } from '../../config/env.js';

/** Case-insensitive (hex), so an address surviving a provider's lower-casing still resolves. */
export function generateInboundToken(): string {
  return randomBytes(16).toString('hex');
}

export function inboundAddress(token: string, domain: string): string {
  return `inbox-${token}@${domain}`;
}

/** Parse the token out of "inbox-<token>@<domain>". Null if the shape or domain is wrong. */
export function tokenFromAddress(to: string, domain: string): string | null {
  const at = to.trim().toLowerCase();
  const suffix = `@${domain.toLowerCase()}`;
  if (!at.endsWith(suffix)) return null;
  const local = at.slice(0, -suffix.length);
  if (!local.startsWith('inbox-')) return null;
  const token = local.slice('inbox-'.length);
  return /^[a-f0-9]{32}$/.test(token) ? token : null;
}

async function lastReceivedAt(userId: Types.ObjectId): Promise<Date | null> {
  const last = await ExpenseIngestionModel.findOne({ userId, channel: 'email' })
    .sort({ createdAt: -1 })
    .select('createdAt')
    .lean();
  return last?.createdAt ?? null;
}

export async function getOrCreateInbox(env: Env, userId: string) {
  if (!env.INBOUND_DOMAIN) {
    throw AppError.badRequest('The statement inbox is not enabled on this server.');
  }
  const _id = new Types.ObjectId(userId);
  const user = await UserModel.findById(_id).select('+inboundToken inboundEnabledAt').lean();
  if (!user) throw AppError.notFound('User');

  let token = user.inboundToken;
  let enabledAt = user.inboundEnabledAt;
  if (!token) {
    token = generateInboundToken();
    enabledAt = new Date();
    await UserModel.updateOne(
      { _id },
      { $set: { inboundToken: token, inboundEnabledAt: enabledAt } },
    );
  }

  return {
    address: inboundAddress(token, env.INBOUND_DOMAIN),
    enabledAt,
    lastReceivedAt: await lastReceivedAt(_id),
  };
}

export async function getInbox(env: Env, userId: string) {
  if (!env.INBOUND_DOMAIN) {
    throw AppError.badRequest('The statement inbox is not enabled on this server.');
  }
  const _id = new Types.ObjectId(userId);
  const user = await UserModel.findById(_id).select('+inboundToken inboundEnabledAt').lean();
  if (!user) throw AppError.notFound('User');
  if (!user.inboundToken) return null;

  return {
    address: inboundAddress(user.inboundToken, env.INBOUND_DOMAIN),
    enabledAt: user.inboundEnabledAt,
    lastReceivedAt: await lastReceivedAt(_id),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @synitheia/api test -- expenses/inbox`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/expenses/inbox.ts apps/api/src/modules/expenses/inbox.test.ts
git commit -m "feat(api): inbound address helpers and getOrCreateInbox service"
```

---

## Task 5: `ingestEmail`, `recordLockedStatement`, meta threading

**Files:**
- Modify: `apps/api/src/modules/expenses/ingestion.ts` (`persist`, `runIngestion`, `ingestPdf`, `listPendingIngestions`; add two exports)
- Create: `apps/api/src/modules/expenses/ingestion.email.test.ts`

**Interfaces:**
- Consumes: `extract`, `markDuplicates`, `ingestPdf` (existing); `ExpenseIngestionModel`.
- Produces:
  - `ingestEmail(env: Env, user: AuthedUser, mail: { messageId: string | null; from: string | null; subject: string | null; text: string }): Promise<ExpenseIngestionDoc | null>` — null when a duplicate `messageId` is seen.
  - `recordLockedStatement(user: AuthedUser, source: { from: string | null; subject: string | null; receivedAt: Date }, messageId: string | null): Promise<ExpenseIngestionDoc>`.
  - `ingestPdf(env, user, buffer, password?, meta?: IngestMeta)` — optional `meta` sets channel/messageId/source.
  - `listPendingIngestions` returns `needs_review` **and** `needs_password`.
  - Type `IngestMeta = { channel?: IngestionChannel; messageId?: string | null; source?: unknown }`.

- [ ] **Step 1: Write the failing test (Mongo + mocked AI)**

Create `apps/api/src/modules/expenses/ingestion.email.test.ts`:

```ts
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The extractor is mocked: these tests prove routing/dedup/persistence, not the model.
vi.mock('../../ai/client.js', () => ({ callStructured: vi.fn() }));
import { callStructured } from '../../ai/client.js';
import { ingestEmail, recordLockedStatement, listPendingIngestions } from './ingestion.js';
import { ExpenseIngestionModel } from '../../db/models.js';
import type { Env } from '../../config/env.js';
import type { AuthedUser } from '../../core/auth-guard.js';

const env = {} as Env;
const user: AuthedUser = { id: '000000000000000000000001', timezone: 'Asia/Kolkata', currency: 'INR' };
const mocked = vi.mocked(callStructured);

let mongo: MongoMemoryReplSet;
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await ExpenseIngestionModel.syncIndexes();
}, 120_000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
afterEach(async () => {
  await ExpenseIngestionModel.deleteMany({});
  vi.clearAllMocks();
});

describe('ingestEmail', () => {
  it('persists a needs_review email ingestion with source and messageId', async () => {
    mocked.mockResolvedValue({
      transactions: [
        { amount: 450, currencyCode: 'INR', merchant: 'Blue Tokai', occurredAt: null,
          suggestedCategory: null, confidence: 0.9, evidence: 'Rs 450 debited', direction: 'debit' },
      ],
    });

    const rec = await ingestEmail(env, user, {
      messageId: '<m1@bank>', from: 'alerts@bank.example', subject: 'Debit alert', text: 'Rs 450 debited at Blue Tokai',
    });

    expect(rec).not.toBeNull();
    expect(rec!.channel).toBe('email');
    expect(rec!.status).toBe('needs_review');
    expect(rec!.drafts).toHaveLength(1);
    expect(rec!.messageId).toBe('<m1@bank>');
    expect((rec!.source as { subject: string }).subject).toBe('Debit alert');
  });

  it('is idempotent on messageId (retry returns null, one record)', async () => {
    mocked.mockResolvedValue({
      transactions: [
        { amount: 10, currencyCode: 'INR', merchant: null, occurredAt: null,
          suggestedCategory: null, confidence: 0.9, evidence: null, direction: 'debit' },
      ],
    });
    await ingestEmail(env, user, { messageId: '<dup@bank>', from: null, subject: null, text: 'Rs 10 debited' });
    const second = await ingestEmail(env, user, { messageId: '<dup@bank>', from: null, subject: null, text: 'Rs 10 debited' });
    expect(second).toBeNull();
    expect(await ExpenseIngestionModel.countDocuments({ channel: 'email' })).toBe(1);
  });

  it('throws ingestion_failed when the email holds no transaction', async () => {
    mocked.mockResolvedValue({ transactions: [] });
    await expect(
      ingestEmail(env, user, { messageId: '<promo@x>', from: null, subject: 'Sale!', text: 'Buy now' }),
    ).rejects.toMatchObject({ code: 'ingestion_failed' });
    expect(await ExpenseIngestionModel.countDocuments()).toBe(0);
  });
});

describe('recordLockedStatement + listPendingIngestions', () => {
  it('creates a needs_password record that shows up in the pending list', async () => {
    await recordLockedStatement(user, { from: 'e@bank', subject: 'Statement', receivedAt: new Date() }, '<s1@bank>');
    const pending = await listPendingIngestions(user.id);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.status).toBe('needs_password');
    expect(pending[0]!.drafts).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @synitheia/api test -- ingestion.email`
Expected: FAIL — `ingestEmail`/`recordLockedStatement` not exported.

- [ ] **Step 3: Implement in `ingestion.ts`**

Add the meta type near the top (after imports):

```ts
export interface IngestMeta {
  channel?: IngestionChannel;
  messageId?: string | null;
  source?: unknown;
}
```

Change `persist` to accept meta:

```ts
async function persist(
  user: AuthedUser,
  channel: IngestionChannel,
  drafts: DraftTransaction[],
  meta?: IngestMeta,
) {
  return ExpenseIngestionModel.create({
    userId: new Types.ObjectId(user.id),
    channel,
    status: 'needs_review',
    drafts,
    error: null,
    messageId: meta?.messageId ?? null,
    source: meta?.source ?? null,
    expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
  });
}
```

Thread meta through `runIngestion`:

```ts
async function runIngestion(
  env: Env,
  user: AuthedUser,
  channel: IngestionChannel,
  content: AiContent[],
  meta?: IngestMeta,
) {
  const drafts = await extract(env, content, user.currency);

  if (drafts.length === 0) {
    throw AppError.ingestionFailed(
      'No transaction was found. If this is a payment confirmation, try a clearer screenshot.',
    );
  }

  return persist(user, meta?.channel ?? channel, await markDuplicates(user.id, drafts), meta);
}
```

Give `ingestPdf` an optional `meta` and forward it (change only the signature and the final `runIngestion` call):

```ts
export async function ingestPdf(
  env: Env,
  user: AuthedUser,
  buffer: Buffer,
  password?: string,
  meta?: IngestMeta,
) {
```

...and its final return:

```ts
  return runIngestion(env, user, meta?.channel ?? 'pdf', [
    {
      type: 'text',
      text: `Extract every transaction from this bank/card statement:\n\n${text.slice(0, 60_000)}`,
    },
  ], meta);
```

Add the two new exports (place after `ingestCsv`):

```ts
/**
 * A forwarded bank/UPI email. Deduped on Message-ID so a provider retry cannot double-file.
 * The HTML→text reduction happens in the webhook; this receives already-flattened text.
 */
export async function ingestEmail(
  env: Env,
  user: AuthedUser,
  mail: { messageId: string | null; from: string | null; subject: string | null; text: string },
) {
  if (mail.messageId) {
    const existing = await ExpenseIngestionModel.findOne({
      userId: new Types.ObjectId(user.id),
      messageId: mail.messageId,
    })
      .select('_id')
      .lean();
    if (existing) return null;
  }

  const source = { from: mail.from, subject: mail.subject, receivedAt: new Date() };

  return runIngestion(
    env,
    user,
    'email',
    [
      {
        type: 'text',
        text: `Extract every payment transaction from this bank/UPI email:\n\n${mail.text.slice(0, 60_000)}`,
      },
    ],
    { channel: 'email', messageId: mail.messageId, source },
  );
}

/**
 * A password-protected statement arrived by email. We hold NO bytes — the user finishes
 * the import in-app, where the existing upload flow can ask for the password. This record
 * exists only so the forward does not vanish silently.
 */
export async function recordLockedStatement(
  user: AuthedUser,
  source: { from: string | null; subject: string | null; receivedAt: Date },
  messageId: string | null,
) {
  return ExpenseIngestionModel.create({
    userId: new Types.ObjectId(user.id),
    channel: 'email',
    status: 'needs_password',
    drafts: [],
    error: 'This statement is password-protected. Open it in the app to import it.',
    messageId,
    source,
    expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
  });
}
```

Widen `listPendingIngestions`:

```ts
export async function listPendingIngestions(userId: string) {
  return ExpenseIngestionModel.find({
    userId: new Types.ObjectId(userId),
    status: { $in: ['needs_review', 'needs_password'] },
  })
    .sort({ createdAt: -1 })
    .lean();
}
```

Ensure `IngestionChannel` is imported in `ingestion.ts` (it already imports from `@synitheia/shared`; add `type IngestionChannel` to that import if not present — it is already imported).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @synitheia/api test -- ingestion.email`
Expected: PASS (all cases).

- [ ] **Step 5: Run the full ingestion suite to catch regressions**

Run: `pnpm --filter @synitheia/api test -- ingestion`
Expected: PASS (existing `ingestion.test.ts` still green).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/expenses/ingestion.ts apps/api/src/modules/expenses/ingestion.email.test.ts
git commit -m "feat(api): ingestEmail, recordLockedStatement, and needs_password in pending list"
```

---

## Task 6: Webhook normalization and handler

**Files:**
- Create: `apps/api/src/modules/webhooks/email.ts`
- Create: `apps/api/src/modules/webhooks/email.test.ts`

**Interfaces:**
- Consumes: `tokenFromAddress` (Task 4), `ingestEmail`/`recordLockedStatement`/`ingestPdf` (Task 5), `UserModel`, `AppError`, `Env`.
- Produces:
  - `InboundEmailPayload` — `{ to?, from?, subject?, text?, html?, messageId?, attachments?: { filename?, contentType?, contentBase64? }[] }`.
  - `NormalizedEmail` — `{ to: string; from: string | null; subject: string | null; text: string; messageId: string | null; pdfAttachments: { filename: string; buffer: Buffer }[] }`.
  - `parseInboundPayload(body: InboundEmailPayload): NormalizedEmail` (pure).
  - `handleInboundEmail(env: Env, body: InboundEmailPayload): Promise<void>`.

- [ ] **Step 1: Write the failing pure-parse test**

Create `apps/api/src/modules/webhooks/email.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseInboundPayload } from './email.js';

describe('parseInboundPayload', () => {
  it('prefers text, falls back to stripped HTML', () => {
    expect(parseInboundPayload({ to: 'x', text: '  Rs 10 debited ' }).text).toBe('Rs 10 debited');
    const fromHtml = parseInboundPayload({
      to: 'x',
      html: '<style>a{}</style><p>Rs&nbsp;20 <b>debited</b></p>',
    });
    expect(fromHtml.text).toBe('Rs 20 debited');
  });

  it('keeps only PDF attachments with content, decoded to buffers', () => {
    const b64 = Buffer.from('%PDF-1.4 fake').toString('base64');
    const out = parseInboundPayload({
      to: 'x',
      attachments: [
        { filename: 'statement.pdf', contentType: 'application/pdf', contentBase64: b64 },
        { filename: 'logo.png', contentType: 'image/png', contentBase64: b64 },
        { filename: 'empty.pdf', contentType: 'application/pdf' },
      ],
    });
    expect(out.pdfAttachments).toHaveLength(1);
    expect(out.pdfAttachments[0]!.filename).toBe('statement.pdf');
    expect(out.pdfAttachments[0]!.buffer.toString()).toBe('%PDF-1.4 fake');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @synitheia/api test -- webhooks/email`
Expected: FAIL — `./email.js` does not exist.

- [ ] **Step 3: Implement `email.ts`**

```ts
import { UserModel } from '../../db/models.js';
import { AppError } from '../../core/errors.js';
import { tokenFromAddress } from '../expenses/inbox.js';
import { ingestEmail, ingestPdf, recordLockedStatement } from '../expenses/ingestion.js';
import type { Env } from '../../config/env.js';
import type { AuthedUser } from '../../core/auth-guard.js';

export interface InboundEmailPayload {
  to?: string;
  from?: string;
  subject?: string;
  text?: string;
  html?: string;
  messageId?: string;
  attachments?: { filename?: string; contentType?: string; contentBase64?: string }[];
}

export interface NormalizedEmail {
  to: string;
  from: string | null;
  subject: string | null;
  text: string;
  messageId: string | null;
  pdfAttachments: { filename: string; buffer: Buffer }[];
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseInboundPayload(body: InboundEmailPayload): NormalizedEmail {
  const text =
    body.text && body.text.trim() ? body.text.trim() : body.html ? htmlToText(body.html) : '';

  const pdfAttachments = (body.attachments ?? [])
    .filter(
      (a) =>
        (a.contentType ?? '').toLowerCase().includes('pdf') ||
        (a.filename ?? '').toLowerCase().endsWith('.pdf'),
    )
    .filter((a): a is { filename?: string; contentType?: string; contentBase64: string } =>
      Boolean(a.contentBase64),
    )
    .map((a) => ({
      filename: a.filename ?? 'statement.pdf',
      buffer: Buffer.from(a.contentBase64, 'base64'),
    }));

  return {
    to: body.to ?? '',
    from: body.from ?? null,
    subject: body.subject ?? null,
    text,
    messageId: body.messageId ?? null,
    pdfAttachments,
  };
}

/** Fire-and-forget from the route: every error mode here resolves quietly (no data leak). */
export async function handleInboundEmail(env: Env, body: InboundEmailPayload): Promise<void> {
  if (!env.INBOUND_DOMAIN) return;

  const mail = parseInboundPayload(body);

  const token = tokenFromAddress(mail.to, env.INBOUND_DOMAIN);
  if (!token) return; // recipient is not one of our inbox addresses

  const userDoc = await UserModel.findOne({ inboundToken: token })
    .select('+inboundToken timezone currency')
    .lean();
  if (!userDoc) return; // unknown token → drop, no enumeration signal

  const user: AuthedUser = {
    id: userDoc._id.toString(),
    timezone: userDoc.timezone,
    currency: userDoc.currency,
  };
  const source = { from: mail.from, subject: mail.subject, receivedAt: new Date() };

  // Body (the real-time alert case).
  if (mail.text) {
    try {
      await ingestEmail(env, user, {
        messageId: mail.messageId,
        from: mail.from,
        subject: mail.subject,
        text: mail.text,
      });
    } catch (err) {
      // A forwarded promo email with no transaction is normal, not an error.
      if (!(err instanceof AppError && err.code === 'ingestion_failed')) throw err;
    }
  }

  // PDF attachments (monthly e-statements).
  for (const pdf of mail.pdfAttachments) {
    try {
      await ingestPdf(env, user, pdf.buffer, undefined, {
        channel: 'email',
        messageId: mail.messageId,
        source,
      });
    } catch (err) {
      if (err instanceof AppError && err.code === 'pdf_password_required') {
        await recordLockedStatement(user, source, mail.messageId);
        continue;
      }
      if (err instanceof AppError && err.code === 'ingestion_failed') continue;
      throw err;
    }
  }
}
```

- [ ] **Step 4: Run the pure test to verify it passes**

Run: `pnpm --filter @synitheia/api test -- webhooks/email`
Expected: PASS.

- [ ] **Step 5: Add the integration test for `handleInboundEmail`**

Append to `apps/api/src/modules/webhooks/email.test.ts`:

```ts
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, describe as describe2, expect as expect2, it as it2, vi } from 'vitest';

vi.mock('../../ai/client.js', () => ({ callStructured: vi.fn() }));
import { callStructured } from '../../ai/client.js';
import { handleInboundEmail } from './email.js';
import { UserModel, ExpenseIngestionModel } from '../../db/models.js';
import { getOrCreateInbox } from '../expenses/inbox.js';
import type { Env } from '../../config/env.js';

const env2 = { INBOUND_DOMAIN: 'in.example.app' } as Env;
const mocked2 = vi.mocked(callStructured);

let mongo2: MongoMemoryReplSet;
beforeAll(async () => {
  mongo2 = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo2.getUri());
  await UserModel.syncIndexes();
  await ExpenseIngestionModel.syncIndexes();
}, 120_000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongo2.stop();
});
afterEach(async () => {
  await UserModel.deleteMany({});
  await ExpenseIngestionModel.deleteMany({});
  vi.clearAllMocks();
});

describe2('handleInboundEmail', () => {
  async function seedInbox() {
    const u = await UserModel.create({
      name: 'A', email: 'a@x.com', timezone: 'Asia/Kolkata', currency: 'INR',
    });
    const { address } = await getOrCreateInbox(env2, u._id.toString());
    return { u, address };
  }

  it2('files a draft from a forwarded alert email', async () => {
    const { address } = await seedInbox();
    mocked2.mockResolvedValue({
      transactions: [
        { amount: 450, currencyCode: 'INR', merchant: 'Blue Tokai', occurredAt: null,
          suggestedCategory: null, confidence: 0.9, evidence: 'Rs 450', direction: 'debit' },
      ],
    });
    await handleInboundEmail(env2, { to: address, from: 'alerts@bank', subject: 'Debit', text: 'Rs 450 debited', messageId: '<m@bank>' });
    expect2(await ExpenseIngestionModel.countDocuments({ channel: 'email', status: 'needs_review' })).toBe(1);
  });

  it2('drops mail to an unknown token without creating anything', async () => {
    await seedInbox();
    await handleInboundEmail(env2, { to: 'inbox-' + 'f'.repeat(32) + '@in.example.app', text: 'Rs 10 debited' });
    expect2(await ExpenseIngestionModel.countDocuments()).toBe(0);
  });
});
```

- [ ] **Step 6: Run the full webhook suite**

Run: `pnpm --filter @synitheia/api test -- webhooks/email`
Expected: PASS (pure + integration).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/webhooks/email.ts apps/api/src/modules/webhooks/email.test.ts
git commit -m "feat(api): inbound email normalization and handler"
```

---

## Task 7: Webhook route + inbox endpoints + app wiring

**Files:**
- Create: `apps/api/src/modules/webhooks/routes.ts`
- Modify: `apps/api/src/modules/expenses/routes.ts` (add two routes after the ingestion block, ~line 201)
- Modify: `apps/api/src/app.ts:29,150-169`

**Interfaces:**
- Consumes: `handleInboundEmail` (Task 6), `getOrCreateInbox`/`getInbox` (Task 4), `isInboundConfigured` (Task 2).
- Produces: `registerWebhookRoutes(app: FastifyInstance, env: Env): Promise<void>`; `POST /v1/webhooks/email`; `POST /v1/expenses/inbox`; `GET /v1/expenses/inbox`.

- [ ] **Step 1: Implement `webhooks/routes.ts`**

```ts
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../../core/errors.js';
import type { Env } from '../../config/env.js';
import { handleInboundEmail, type InboundEmailPayload } from './email.js';

function secretOk(header: string | undefined, secret: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice(7));
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function registerWebhookRoutes(app: FastifyInstance, env: Env): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();

  const attachmentSchema = z.object({
    filename: z.string().optional(),
    contentType: z.string().optional(),
    contentBase64: z.string().optional(),
  });

  api.post(
    '/webhooks/email',
    {
      // The inbound provider is not a browser and must not share the per-user budget.
      config: { rateLimit: { max: 240, timeWindow: '1 minute' } },
      schema: {
        body: z.object({
          to: z.string().optional(),
          from: z.string().optional(),
          subject: z.string().optional(),
          text: z.string().optional(),
          html: z.string().optional(),
          messageId: z.string().optional(),
          attachments: z.array(attachmentSchema).optional(),
        }),
      },
    },
    async (req, reply) => {
      if (!env.INBOUND_WEBHOOK_SECRET || !secretOk(req.headers.authorization, env.INBOUND_WEBHOOK_SECRET)) {
        throw AppError.unauthorized('Invalid webhook credentials');
      }
      // Resolve, parse, and file. Every not-for-us / empty case resolves 200 inside.
      await handleInboundEmail(env, req.body as InboundEmailPayload);
      return reply.status(200).send({ ok: true });
    },
  );
}
```

- [ ] **Step 2: Add the inbox endpoints to `expenses/routes.ts`**

After the `GET /expenses/ingestions` block (~line 201), add:

```ts
  // ─── Statement inbox ──────────────────────────────────────────────────────

  api.post('/expenses/inbox', { onRequest: [app.requireAuth] }, async (req, reply) => {
    const inbox = await inbox_service.getOrCreateInbox(env, req.user.id);
    return reply.status(201).send({ inbox });
  });

  api.get('/expenses/inbox', { onRequest: [app.requireAuth] }, async (req) => ({
    inbox: await inbox_service.getInbox(env, req.user.id),
  }));
```

Add the import at the top of `expenses/routes.ts` (next to the other module imports):

```ts
import * as inbox_service from './inbox.js';
```

- [ ] **Step 3: Wire the webhook into `app.ts`**

Add the import (with the other `register*` imports, ~line 29):

```ts
import { registerWebhookRoutes } from './modules/webhooks/routes.js';
```

Inside the `/v1` group registration (after `registerPrivacyRoutes(api);`), add:

```ts
      await registerWebhookRoutes(api, env);
```

- [ ] **Step 4: Typecheck the API**

Run: `pnpm --filter @synitheia/api exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Manual smoke test the webhook end-to-end**

Start the API against a local Mongo with the feature configured, then curl it. Expected: unauthorized without the secret; 200 with it.

```bash
# terminal A — from apps/api, with a local/dev MONGO_URI and JWT_SECRET set:
INBOUND_DOMAIN=in.example.app INBOUND_WEBHOOK_SECRET=$(openssl rand -hex 24) pnpm --filter @synitheia/api dev

# terminal B:
curl -s -o /dev/null -w '%{http_code}\n' -XPOST localhost:4000/v1/webhooks/email \
  -H 'content-type: application/json' -d '{"to":"inbox-x@in.example.app","text":"hi"}'
# Expected: 401

curl -s -o /dev/null -w '%{http_code}\n' -XPOST localhost:4000/v1/webhooks/email \
  -H "authorization: Bearer $INBOUND_WEBHOOK_SECRET" -H 'content-type: application/json' \
  -d '{"to":"inbox-'"$(printf 'f%.0s' {1..32})"'@in.example.app","text":"Rs 10 debited"}'
# Expected: 200 (unknown token dropped, but request authorized and handled)
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/webhooks/routes.ts apps/api/src/modules/expenses/routes.ts apps/api/src/app.ts
git commit -m "feat(api): webhook route and statement-inbox endpoints"
```

---

## Task 8: Cloudflare Email Worker

**Files:**
- Create: `infra/email-worker/package.json`
- Create: `infra/email-worker/wrangler.toml`
- Create: `infra/email-worker/src/worker.js`
- Create: `infra/email-worker/README.md`

**Interfaces:**
- Consumes: `POST /v1/webhooks/email` (Task 7) with `Authorization: Bearer <secret>`.
- Produces: a deployable Worker bound to Cloudflare Email Routing that forwards parsed mail as `InboundEmailPayload` JSON.

- [ ] **Step 1: `package.json`**

```json
{
  "name": "email-worker",
  "private": true,
  "type": "module",
  "scripts": {
    "deploy": "wrangler deploy",
    "dev": "wrangler dev"
  },
  "dependencies": {
    "postal-mime": "^2.2.7"
  },
  "devDependencies": {
    "wrangler": "^3.90.0"
  }
}
```

- [ ] **Step 2: `wrangler.toml`**

```toml
name = "synitheia-email-worker"
main = "src/worker.js"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]

# API_URL and WEBHOOK_SECRET are set as secrets/vars, not committed:
#   wrangler secret put WEBHOOK_SECRET
#   wrangler deploy --var API_URL:https://<your-api-host>
[vars]
API_URL = "https://REPLACE_WITH_API_HOST"
```

- [ ] **Step 3: `src/worker.js`**

```js
import PostalMime from 'postal-mime';

/**
 * Cloudflare Email Worker. Bound to Email Routing on inbox-*@in.<domain>, it parses each
 * forwarded message and POSTs it to the API webhook as JSON. It stores nothing.
 */
export default {
  async email(message, env) {
    const parsed = await PostalMime.parse(message.raw);

    const attachments = (parsed.attachments ?? []).map((a) => ({
      filename: a.filename ?? 'attachment',
      contentType: a.mimeType ?? 'application/octet-stream',
      contentBase64: bytesToBase64(a.content),
    }));

    const payload = {
      to: message.to, // envelope recipient — the inbox-<token>@... address
      from: parsed.from?.address ?? message.from ?? null,
      subject: parsed.subject ?? null,
      text: parsed.text ?? '',
      html: parsed.html ?? '',
      messageId: parsed.messageId ?? null,
      attachments,
    };

    const res = await fetch(`${env.API_URL}/v1/webhooks/email`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.WEBHOOK_SECRET}`,
      },
      body: JSON.stringify(payload),
    });

    // A 5xx means our API is down; let Email Routing retry by throwing.
    if (res.status >= 500) throw new Error(`webhook ${res.status}`);
  },
};

function bytesToBase64(content) {
  // postal-mime gives an ArrayBuffer/Uint8Array; Workers have btoa but not Buffer by default.
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
```

- [ ] **Step 4: `README.md`**

````markdown
# Synítheia inbound email worker

Receives forwarded bank/UPI mail for `inbox-<token>@in.<domain>` and posts it to the API
webhook. Stores nothing.

## One-time setup
1. Add the domain to Cloudflare (keep registration at Vercel; point the domain's
   nameservers at Cloudflare — free). Vercel-hosted app records (A/CNAME/TXT) move to
   Cloudflare DNS.
2. Enable **Email → Email Routing** on the zone. Verify the MX records Cloudflare adds.
3. Add a **catch-all** (or `inbox-*`) route with action **Send to a Worker** → this worker.
4. Set secrets/vars:
   ```bash
   cd infra/email-worker && pnpm install
   npx wrangler secret put WEBHOOK_SECRET      # same value as the API's INBOUND_WEBHOOK_SECRET
   npx wrangler deploy --var API_URL:https://<your-api-host>
   ```
5. On the API, set `INBOUND_DOMAIN=in.<domain>` and `INBOUND_WEBHOOK_SECRET=<same secret>`.

## Test
Send an email to `inbox-<token>@in.<domain>` (get `<token>` from the app's inbox setup
screen). A transaction alert should appear in the app's review inbox within seconds.
````

- [ ] **Step 5: Verify the worker builds (dry run)**

Run: `cd infra/email-worker && pnpm install && npx wrangler deploy --dry-run --outdir /tmp/email-worker-build`
Expected: bundles with no error (no deploy performed).

- [ ] **Step 6: Commit**

```bash
git add infra/email-worker
git commit -m "feat(infra): Cloudflare email worker for inbound statement forwarding"
```

---

## Task 9: Extract `<DraftReview>` from the new-expense screen

**Files:**
- Create: `apps/mobile/src/components/DraftReview.tsx`
- Modify: `apps/mobile/app/expenses/new.tsx`

**Interfaces:**
- Consumes: `WireIngestion`, `WireCategory`, `WireDraft` from `src/api/types.ts`; `api` client; primitives.
- Produces: `<DraftReview ingestion={WireIngestion} onConfirmed={() => void} onDiscard={() => void} />`. It fetches categories itself (query key `['expense-categories']`), owns per-draft edit state, renders the draft cards, and POSTs `/expenses/ingestions/:id/confirm`.

- [ ] **Step 1: Create `DraftReview.tsx` by moving the existing review code**

Move these pieces out of `new.tsx` into `DraftReview.tsx`, unchanged in behaviour:
- The `DraftEdit` interface and `initialEdit()` helper (`new.tsx:98-122`).
- The `toAmountInput()` helper (`new.tsx:92-96`).
- The `DraftCard` component (`new.tsx:869-968`).
- The relevant styles (`draft`, `draftIncluded`, `draftHeader`, `duplicate`, `duplicateCopy`, `drafts`, `cta`, `pills`, `fieldLabel`) — copy these keys into `DraftReview`'s own `StyleSheet`.

`DraftReview.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react-native';
import { currencyMeta, formatMoney, parseMoneyInput, ZERO } from '@synitheia/shared';
import { Button, Card, Chip, Input, Text } from './primitives.js';
import { api } from '../api/client.js';
import type { ListResponse, WireCategory, WireDraft, WireIngestion } from '../api/types.js';
import { palette, spacing } from '../theme/tokens.js';

const CATEGORIES_KEY = ['expense-categories'] as const;

interface DraftEdit {
  include: boolean;
  amount: string;
  merchant: string;
  categoryId: string | null;
}

function toAmountInput(amountMinor: number, currency: string): string {
  const { decimals } = currencyMeta(currency);
  return (amountMinor / 10 ** decimals).toFixed(decimals);
}

function initialEdit(draft: WireDraft, categories: WireCategory[]): DraftEdit {
  const suggested = draft.suggestedCategoryName?.toLowerCase();
  const category =
    categories.find((c) => c.name.toLowerCase() === suggested) ??
    categories.find((c) => c.name === 'Other') ??
    categories[0];
  return {
    include: draft.duplicateOfExpenseId === null,
    amount: toAmountInput(draft.amountMinor, draft.currency),
    merchant: draft.merchant ?? '',
    categoryId: category?._id ?? null,
  };
}

export function DraftReview({
  ingestion,
  onConfirmed,
  onDiscard,
}: {
  ingestion: WireIngestion;
  onConfirmed: () => void;
  onDiscard: () => void;
}) {
  const queryClient = useQueryClient();
  const categories = useQuery({
    queryKey: CATEGORIES_KEY,
    queryFn: () => api.get<ListResponse<WireCategory>>('/expense-categories'),
  });
  const categoryItems = useMemo(() => categories.data?.items ?? [], [categories.data]);

  const [edits, setEdits] = useState<DraftEdit[]>(() =>
    ingestion.drafts.map((d) => initialEdit(d, categoryItems)),
  );
  const [error, setError] = useState<string | null>(null);

  // Categories may arrive after first render; seed edits once they do and none are set.
  const seeded = edits.some((e) => e.categoryId !== null);
  if (!seeded && categoryItems.length > 0 && ingestion.drafts.length > 0) {
    setEdits(ingestion.drafts.map((d) => initialEdit(d, categoryItems)));
  }

  function patchEdit(index: number, patch: Partial<DraftEdit>): void {
    setEdits((current) => current.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }

  const confirm = useMutation({
    mutationFn: () => {
      const confirmations = edits
        .map((edit, draftIndex) => ({ edit, draftIndex }))
        .filter(({ edit }) => edit.include && edit.categoryId !== null)
        .map(({ edit, draftIndex }) => {
          const draft = ingestion.drafts[draftIndex];
          const parsed = parseMoneyInput(edit.amount, draft?.currency ?? 'INR');
          if (parsed === null || parsed <= 0) {
            throw new Error('One of these amounts does not look right. Please check it.');
          }
          return {
            draftIndex,
            categoryId: edit.categoryId,
            amountMinor: parsed,
            merchant: edit.merchant.trim() === '' ? null : edit.merchant.trim(),
            ...(draft?.occurredAt ? { occurredAt: draft.occurredAt } : {}),
          };
        });
      if (confirmations.length === 0) throw new Error('Select at least one transaction to add.');
      return api.post<unknown>(`/expenses/ingestions/${ingestion._id}/confirm`, { confirmations });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['today'] });
      void queryClient.invalidateQueries({ queryKey: ['ingestions'] });
      onConfirmed();
    },
    onError: (err: unknown) =>
      setError(err instanceof Error ? err.message : 'Could not add these expenses.'),
  });

  return (
    <>
      {error ? (
        <Card style={styles.errorCard} accessibilityLiveRegion="polite">
          <Text variant="body" color={palette.danger}>
            {error}
          </Text>
        </Card>
      ) : null}

      <View style={styles.drafts}>
        {ingestion.drafts.map((draft, index) => {
          const edit = edits[index];
          if (!edit) return null;
          return (
            <DraftCard
              key={`${ingestion._id}:${index}`}
              draft={draft}
              edit={edit}
              categories={categoryItems}
              onChange={(patch) => patchEdit(index, patch)}
            />
          );
        })}
      </View>

      <Button
        label="Add selected"
        loading={confirm.isPending}
        onPress={() => confirm.mutate()}
        style={styles.cta}
      />
      <Button label="Discard" variant="ghost" onPress={onDiscard} />
    </>
  );
}

function DraftCard({
  draft,
  edit,
  categories,
  onChange,
}: {
  draft: WireDraft;
  edit: DraftEdit;
  categories: WireCategory[];
  onChange: (patch: Partial<DraftEdit>) => void;
}) {
  const duplicate = draft.duplicateOfExpenseId !== null;
  return (
    <Card style={[styles.draft, edit.include ? styles.draftIncluded : null]}>
      <View style={styles.draftHeader}>
        <Text variant="cardTitle">
          {formatMoney(parseMoneyInput(edit.amount, draft.currency) ?? ZERO, draft.currency)}
        </Text>
        <Chip
          label={edit.include ? 'Adding' : 'Skipped'}
          selected={edit.include}
          accessibilityLabel={edit.include ? 'This transaction will be added' : 'This transaction will be skipped'}
          onPress={() => onChange({ include: !edit.include })}
        />
      </View>

      {duplicate ? (
        <View style={styles.duplicate}>
          <AlertTriangle size={14} color={palette.warning} strokeWidth={2} />
          <Text variant="caption" color={palette.warning} style={styles.duplicateCopy}>
            This looks like an expense you already have. Add it only if it really happened twice.
          </Text>
        </View>
      ) : null}

      {draft.evidence ? (
        <Text variant="caption" color={palette.stoneFaint} numberOfLines={3}>
          {`“${draft.evidence}”`}
        </Text>
      ) : null}

      <Input
        label="Amount"
        value={edit.amount}
        onChangeText={(value) => onChange({ amount: value })}
        keyboardType="decimal-pad"
        leading={
          <Text variant="bodyMedium" color={palette.stoneFaint}>
            {currencyMeta(draft.currency).symbol}
          </Text>
        }
        error={parseMoneyInput(edit.amount, draft.currency) === null ? 'That does not look like an amount' : null}
      />
      <Input
        label="Merchant"
        value={edit.merchant}
        onChangeText={(value) => onChange({ merchant: value })}
        placeholder="Unknown"
        maxLength={120}
      />
      <View>
        <Text variant="label" color={palette.stoneMuted} style={styles.fieldLabel}>
          Category
        </Text>
        <View style={styles.pills}>
          {categories.map((category) => (
            <Chip
              key={category._id}
              label={category.name}
              accent={category.color}
              selected={edit.categoryId === category._id}
              accessibilityLabel={`Category ${category.name}`}
              onPress={() => onChange({ categoryId: category._id })}
            />
          ))}
        </View>
      </View>
      <Text variant="caption" color={palette.stoneFaint}>
        {`We are ${Math.round(draft.confidence * 100)}% sure we read this correctly.`}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  errorCard: { marginTop: spacing.lg, borderColor: palette.danger },
  drafts: { marginTop: spacing.xl, gap: spacing.base },
  draft: { gap: spacing.base, opacity: 0.6 },
  draftIncluded: { opacity: 1 },
  draftHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  duplicate: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md,
    borderRadius: 8, backgroundColor: palette.sand, borderWidth: 1, borderColor: palette.warning,
  },
  duplicateCopy: { flex: 1 },
  fieldLabel: { marginBottom: spacing.sm },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cta: { marginTop: spacing.xl },
});
```

- [ ] **Step 2: Rewrite the reviewing branch in `new.tsx` to use `<DraftReview>`**

In `new.tsx`: delete the moved pieces (`DraftEdit`, `initialEdit`, `toAmountInput`, `DraftCard`, the `confirm` mutation, `patchEdit`, and the `edits` state), import the component:

```tsx
import { DraftReview } from '../../src/components/DraftReview.js';
```

Keep `ingestion`/`setIngestion` state and the `receive`/`runIngest`/`sendStatement` upload logic. Replace the whole `reviewing ? ( ... ) : ( ... )` review branch (`new.tsx:582-617`) with:

```tsx
          {reviewing ? (
            <DraftReview
              ingestion={ingestion}
              onConfirmed={() => {
                invalidate();
                router.back();
              }}
              onDiscard={() => {
                setIngestion(null);
                setError(null);
              }}
            />
          ) : (
```

Remove the now-unused `edits`-related lines from `receive` (drop `setEdits(...)`), and delete the leftover `styles` keys that moved (`draft`, `draftIncluded`, `draftHeader`, `duplicate`, `duplicateCopy`, `drafts`, `cta`) if no longer referenced. Leave `initialEdit` import out — it lives in `DraftReview` now.

- [ ] **Step 3: Typecheck the mobile app**

Run: `pnpm --filter @synitheia/mobile exec tsc --noEmit`
Expected: exit 0 (fix any dangling references the move left behind).

- [ ] **Step 4: Lint the two files**

Run: `cd apps/mobile && npx eslint src/components/DraftReview.tsx app/expenses/new.tsx`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components/DraftReview.tsx apps/mobile/app/expenses/new.tsx
git commit -m "refactor(mobile): extract reusable DraftReview from new-expense screen"
```

---

## Task 10: Review inbox and setup screens + entry points

**Files:**
- Create: `apps/mobile/app/expenses/review.tsx`
- Create: `apps/mobile/app/expenses/inbox-setup.tsx`
- Modify: `apps/mobile/app/expenses/index.tsx` (add entry rows)
- Modify: `apps/mobile/app/_layout.tsx` (register the two screens)
- Modify: `apps/mobile/src/api/types.ts` (inbox response + confirm the WireIngestion `source`/`status` fields)

**Interfaces:**
- Consumes: `GET /expenses/ingestions`, `GET /expenses/ingestions/:id`, `POST /expenses/inbox`, `GET /expenses/inbox`; `<DraftReview>` (Task 9).
- Produces: two routable screens and entry points on the expenses index.

- [ ] **Step 1: Add types**

In `src/api/types.ts`, ensure `WireIngestion` includes `status: string`, `channel: string`, and `source: { from: string | null; subject: string | null; receivedAt: string } | null`. Add:

```ts
export interface WireInbox {
  address: string;
  enabledAt: string | null;
  lastReceivedAt: string | null;
}
```

- [ ] **Step 2: Create `inbox-setup.tsx`**

```tsx
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { ArrowLeft, Check, Copy, Mail } from 'lucide-react-native';
import { Button, Card, ErrorState, Text, Touchable } from '../../src/components/primitives.js';
import { SkeletonList } from '../../src/components/Skeleton.js';
import { api, ApiError } from '../../src/api/client.js';
import type { WireInbox } from '../../src/api/types.js';
import { palette, spacing } from '../../src/theme/tokens.js';

const INBOX_KEY = ['inbox'] as const;

export default function InboxSetup() {
  const [copied, setCopied] = useState(false);

  const inbox = useQuery({
    queryKey: INBOX_KEY,
    queryFn: () => api.get<{ inbox: WireInbox | null }>('/expenses/inbox'),
    // Poll while waiting for the first email so "Connected" appears on its own.
    refetchInterval: (q) => (q.state.data?.inbox?.lastReceivedAt ? false : 8000),
  });

  const enable = useMutation({
    mutationFn: () => api.post<{ inbox: WireInbox }>('/expenses/inbox'),
    onSuccess: () => void inbox.refetch(),
  });

  const back = (
    <Touchable onPress={() => router.back()} style={styles.back} haptic={false}
      accessibilityRole="button" accessibilityLabel="Go back">
      <ArrowLeft size={22} color={palette.stone} strokeWidth={1.8} />
    </Touchable>
  );

  if (inbox.isPending) {
    return <SafeAreaView style={styles.screen} edges={['top']}><SkeletonList /></SafeAreaView>;
  }
  if (inbox.error) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.content}>
          {back}
          <ErrorState
            message={inbox.error instanceof ApiError ? inbox.error.message : 'Could not load your inbox.'}
            onRetry={() => void inbox.refetch()}
          />
        </View>
      </SafeAreaView>
    );
  }

  const address = inbox.data.inbox?.address ?? null;
  const connected = Boolean(inbox.data.inbox?.lastReceivedAt);

  async function copy() {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {back}
        <Text variant="overline" color={palette.stoneFaint}>Expenses</Text>
        <Text variant="title" style={styles.title}>Connect your bank emails</Text>
        <Text variant="body" color={palette.stoneMuted} style={styles.subtitle}>
          Forward your bank and UPI alert emails to your private address and we will turn
          them into expenses to review. Nothing is saved until you confirm it.
        </Text>

        {address === null ? (
          <Button label="Create my inbox address" loading={enable.isPending} onPress={() => enable.mutate()} style={styles.cta} />
        ) : (
          <>
            <Card style={styles.addressCard}>
              <View style={styles.addressRow}>
                <Mail size={18} color={palette.sage} strokeWidth={1.7} />
                <Text variant="bodyMedium" style={styles.address} numberOfLines={1}>{address}</Text>
                <Touchable onPress={copy} style={styles.copy} accessibilityRole="button" accessibilityLabel="Copy address">
                  {copied ? <Check size={18} color={palette.sage} /> : <Copy size={18} color={palette.stoneMuted} />}
                </Touchable>
              </View>
            </Card>

            <Card style={[styles.statusCard, connected ? styles.statusOk : null]}>
              <Text variant="bodyMedium" color={connected ? palette.sage : palette.stoneMuted}>
                {connected ? 'Connected — mail is arriving.' : 'Waiting for your first forwarded email…'}
              </Text>
            </Card>

            <Text variant="section" style={styles.how}>How to set it up in Gmail</Text>
            {[
              'Open Gmail on the web → Settings → Filters and Blocked Addresses.',
              'Create a filter with From containing your bank’s alert address.',
              `Choose “Forward it to” and add the address above (verify it once).`,
              'Existing bank alerts will start arriving here within seconds of the next one.',
            ].map((line, i) => (
              <View key={i} style={styles.step}>
                <Text variant="caption" color={palette.sage}>{i + 1}</Text>
                <Text variant="body" color={palette.stoneMuted} style={styles.stepCopy}>{line}</Text>
              </View>
            ))}

            <Button label="Go to review inbox" variant="secondary"
              onPress={() => router.replace('/expenses/review')} style={styles.cta} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bone },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing['3xl'] },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.md },
  title: { marginTop: spacing.xs },
  subtitle: { marginTop: spacing.sm },
  cta: { marginTop: spacing.xl },
  addressCard: { marginTop: spacing.xl },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  address: { flex: 1 },
  copy: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  statusCard: { marginTop: spacing.md },
  statusOk: { borderColor: palette.sage },
  how: { marginTop: spacing['2xl'] },
  step: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.base },
  stepCopy: { flex: 1 },
});
```

- [ ] **Step 3: Create `review.tsx`**

```tsx
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Lock, Mail } from 'lucide-react-native';
import { Button, Card, EmptyState, ErrorState, Text, Touchable } from '../../src/components/primitives.js';
import { SkeletonList } from '../../src/components/Skeleton.js';
import { DraftReview } from '../../src/components/DraftReview.js';
import { api, ApiError } from '../../src/api/client.js';
import type { ListResponse, WireIngestion } from '../../src/api/types.js';
import { palette, spacing } from '../../src/theme/tokens.js';

const PENDING_KEY = ['ingestions'] as const;

export default function ReviewInbox() {
  const [openId, setOpenId] = useState<string | null>(null);

  const pending = useQuery({
    queryKey: PENDING_KEY,
    queryFn: () => api.get<ListResponse<WireIngestion>>('/expenses/ingestions'),
  });

  const detail = useQuery({
    queryKey: ['ingestion', openId],
    queryFn: () => api.get<{ ingestion: WireIngestion }>(`/expenses/ingestions/${openId}`),
    enabled: openId !== null,
  });

  const back = (
    <Touchable onPress={() => router.back()} style={styles.back} haptic={false}
      accessibilityRole="button" accessibilityLabel="Go back">
      <ArrowLeft size={22} color={palette.stone} strokeWidth={1.8} />
    </Touchable>
  );

  if (pending.isPending) {
    return <SafeAreaView style={styles.screen} edges={['top']}><SkeletonList /></SafeAreaView>;
  }
  if (pending.error) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.content}>
          {back}
          <ErrorState
            message={pending.error instanceof ApiError ? pending.error.message : 'Could not load your review inbox.'}
            onRetry={() => void pending.refetch()}
          />
        </View>
      </SafeAreaView>
    );
  }

  const items = pending.data.items;

  // A single ingestion opened for review.
  if (openId !== null) {
    const ingestion = detail.data?.ingestion;
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Touchable onPress={() => setOpenId(null)} style={styles.back} haptic={false}
            accessibilityRole="button" accessibilityLabel="Back to inbox">
            <ArrowLeft size={22} color={palette.stone} strokeWidth={1.8} />
          </Touchable>
          <Text variant="title">Review</Text>
          <Text variant="body" color={palette.stoneMuted} style={styles.subtitle}>
            We read these from a forwarded email. Nothing is saved until you confirm.
          </Text>
          {detail.isPending || !ingestion ? (
            <SkeletonList />
          ) : (
            <DraftReview
              ingestion={ingestion}
              onConfirmed={() => { setOpenId(null); void pending.refetch(); }}
              onDiscard={() => { setOpenId(null); void pending.refetch(); }}
            />
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pending.isRefetching} onRefresh={() => void pending.refetch()} tintColor={palette.sage} />}
      >
        {back}
        <Text variant="title">Review inbox</Text>
        <Text variant="body" color={palette.stoneMuted} style={styles.subtitle}>
          Transactions we read from what you shared or forwarded.
        </Text>

        {items.length === 0 ? (
          <EmptyState
            icon={<Mail size={30} color={palette.white} strokeWidth={1.5} />}
            title="Nothing to review"
            body="Forward a bank or UPI email to your inbox address, or share a screenshot, and it will show up here."
            actionLabel="Set up bank emails"
            onAction={() => router.push('/expenses/inbox-setup')}
          />
        ) : (
          <View style={styles.list}>
            {items.map((item) => {
              const locked = item.status === 'needs_password';
              const count = item.drafts.length;
              return (
                <Touchable
                  key={item._id}
                  style={styles.row}
                  onPress={() => (locked ? router.push('/expenses/new') : setOpenId(item._id))}
                  accessibilityRole="button"
                  accessibilityLabel={locked ? 'Password-locked statement' : `${count} transactions to review`}
                >
                  {locked ? <Lock size={18} color={palette.warning} /> : <Mail size={18} color={palette.sage} />}
                  <View style={styles.rowCopy}>
                    <Text variant="bodyMedium" numberOfLines={1}>
                      {item.source?.subject ?? (locked ? 'Password-locked statement' : 'Shared transactions')}
                    </Text>
                    <Text variant="caption" color={palette.stoneFaint}>
                      {locked ? 'Open in the app to import' : count === 1 ? '1 transaction' : `${count} transactions`}
                    </Text>
                  </View>
                  <ChevronRight size={18} color={palette.stoneFaint} />
                </Touchable>
              );
            })}
          </View>
        )}

        <Button label="Set up bank emails" variant="secondary"
          onPress={() => router.push('/expenses/inbox-setup')} style={styles.cta} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bone },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing['3xl'] },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.md },
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.lg },
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.base,
    borderRadius: 12, borderWidth: 1, borderColor: palette.surfaceDim, backgroundColor: palette.bone,
  },
  rowCopy: { flex: 1 },
  cta: { marginTop: spacing.xl },
});
```

- [ ] **Step 4: Add entry points on `expenses/index.tsx`**

Add a "Review inbox (N)" row and a "Connect bank emails" affordance near the top of the expenses list header. Fetch the pending count with a lightweight query:

```tsx
import { useQuery } from '@tanstack/react-query';
// ...
const pending = useQuery({
  queryKey: ['ingestions'],
  queryFn: () => api.get<ListResponse<WireIngestion>>('/expenses/ingestions'),
});
const reviewCount = pending.data?.items.length ?? 0;
```

Render (place it above the expense list, inside the header area — match the file's existing layout primitives):

```tsx
{reviewCount > 0 ? (
  <Touchable
    onPress={() => router.push('/expenses/review')}
    accessibilityRole="button"
    accessibilityLabel={`Review inbox, ${reviewCount} pending`}
    style={styles.reviewRow}
  >
    <Mail size={18} color={palette.sage} strokeWidth={1.7} />
    <Text variant="bodyMedium" style={{ flex: 1 }}>Review inbox</Text>
    <View style={styles.badge}><Text variant="caption" color={palette.white}>{reviewCount}</Text></View>
    <ChevronRight size={18} color={palette.stoneFaint} />
  </Touchable>
) : (
  <Touchable
    onPress={() => router.push('/expenses/inbox-setup')}
    accessibilityRole="button"
    accessibilityLabel="Connect your bank emails"
    style={styles.reviewRow}
  >
    <Mail size={18} color={palette.sage} strokeWidth={1.7} />
    <Text variant="bodyMedium" style={{ flex: 1 }}>Connect bank emails</Text>
    <ChevronRight size={18} color={palette.stoneFaint} />
  </Touchable>
)}
```

Add the `Mail`/`ChevronRight` imports from `lucide-react-native`, `router` from `expo-router`, and these styles:

```tsx
  reviewRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.base, marginBottom: spacing.base,
    borderRadius: 12, borderWidth: 1, borderColor: palette.surfaceDim,
  },
  badge: {
    minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11,
    backgroundColor: palette.sage, alignItems: 'center', justifyContent: 'center',
  },
```

- [ ] **Step 5: Register the two screens in `_layout.tsx`**

After `<Stack.Screen name="insights" />` (added in the native-tabs fix; if not present, after `name="nutrition"`), add:

```tsx
                <Stack.Screen name="expenses/review" />
                <Stack.Screen name="expenses/inbox-setup" />
```

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm --filter @synitheia/mobile exec tsc --noEmit`
Expected: exit 0.
Run: `cd apps/mobile && npx eslint app/expenses/review.tsx app/expenses/inbox-setup.tsx app/expenses/index.tsx app/_layout.tsx`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/app/expenses/review.tsx apps/mobile/app/expenses/inbox-setup.tsx apps/mobile/app/expenses/index.tsx apps/mobile/app/_layout.tsx apps/mobile/src/api/types.ts
git commit -m "feat(mobile): statement inbox setup and review screens with entry points"
```

---

## Task 11: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full API test suite**

Run: `pnpm --filter @synitheia/api test`
Expected: PASS (all files, including the new inbox/ingestion/webhook tests).

- [ ] **Step 2: Typecheck the whole workspace**

Run: `pnpm -r exec tsc --noEmit`
Expected: exit 0 across shared, api, mobile.

- [ ] **Step 3: Drive the mobile flow (see the `run` skill / `verify` skill)**

With the API running locally configured for inbound (`INBOUND_DOMAIN`, `INBOUND_WEBHOOK_SECRET`) and the app pointed at it:
1. Open Expenses → "Connect bank emails" → create address → copy it.
2. Simulate a forwarded email by calling the webhook directly with a valid token (paste the token from the created address):
   ```bash
   curl -XPOST localhost:4000/v1/webhooks/email \
     -H "authorization: Bearer $INBOUND_WEBHOOK_SECRET" -H 'content-type: application/json' \
     -d '{"to":"<paste address>","from":"alerts@bank","subject":"Debit alert","text":"Rs 450 debited at Blue Tokai on 17 Jul","messageId":"<e2e-1@bank>"}'
   ```
   Expected: 200.
3. In the app, Expenses shows "Review inbox (1)". Open it → the draft reads ₹450 / Blue Tokai → confirm → it appears as an expense and the badge clears.
4. Re-send the same curl (same `messageId`) → still one item (idempotent).

- [ ] **Step 4: Commit any fixes surfaced by verification, then finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to open a PR or merge.

---

## Self-review notes (addressed)

- **Spec coverage:** email channel (Task 1), env gating (Task 2), models + idempotency index (Task 3), address helpers/endpoints (Tasks 4, 7), `ingestEmail`/`needs_password`/widened pending list (Task 5), webhook normalization + security + drop-on-unknown (Tasks 6, 7), Cloudflare worker + DNS steps (Task 8), reusable `<DraftReview>` (Task 9), setup + review screens + entry points + back buttons (Task 10), tests + e2e (all tasks + Task 11). Locked-PDF → `needs_password` with no byte storage (Tasks 5, 6, 10).
- **Type consistency:** `IngestMeta` defined in Task 5 and consumed by `ingestPdf`/webhook in Task 6; `WireInbox`/`WireIngestion.source` defined in Task 10 and consumed by both mobile screens; `getOrCreateInbox`/`getInbox` shapes identical across Tasks 4/7/10.
- **Known simplifications (from spec):** no Gmail OAuth, no AA, no stored statement bytes, SMS excluded; locked monthly statements fall back to in-app upload.
