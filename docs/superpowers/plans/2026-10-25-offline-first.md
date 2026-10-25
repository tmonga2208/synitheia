# Offline-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use the app offline: everything logged or edited by hand is saved on the phone, shown at once, and sent when the connection returns; what was last seen is kept on the phone and refreshed when it can.

**Architecture:** Two halves. Reads: React Query's cache is persisted to AsyncStorage, so screens open with the last data. Writes: offline-capable calls go through `api.offline.*`; while offline (or on a dropped connection) they are put in a persisted outbox and reported as queued, and screens apply them optimistically. When the connection returns, the outbox is replayed in order *before* queries resume. Every write carries an `Idempotency-Key`, and the server stores the answer per key, so a replay never applies twice. Creates carry a client-chosen ObjectId, so things made offline can be ticked, edited or deleted before they sync.

**Tech Stack:** as before, plus `@tanstack/react-query-persist-client` and `@tanstack/query-async-storage-persister` (pure JS).

**Spec:** approved in chat on 2026-10-25 ("yes build it") — the design message listing what works offline, cached data, and what still needs a connection.

## Global Constraints

- Offline-capable: water add/delete; habit tick/untick, create, archive; food add/delete; expense add, date change, delete, settle; reminders create/toggle/delete; bills create/autopost/delete; targets; suggestion confirm/reject; insight feedback/dismiss.
- Online only (fail at once): AI reading (`/expenses/ingest/*`, `/expenses/ingestions/*`, `/food/photo*`, receipt upload), `/insights/generate`, auth and password reset, privacy and consent changes (`/privacy/*`, `/data-sources/*`), account deletion and export, `/me/onboarded`, new expense categories, calorie goal and body details.
- Queued changes are sent in the order made; the queue drains before paused queries refetch.
- Copy: offline pill `You’re offline. Changes are saved on this phone.` plus ` · {n} waiting` when n > 0; while sending `Syncing {n} changes…`; first queued change of an offline period toasts `Saved on this phone. It’ll sync when you’re back online.`; a refused change toasts `Couldn’t sync “{label}”. {reason}`; an online-only action offline reads `You’re offline` / `This needs a connection. Try again when you’re back online.`
- Cache and outbox live in AsyncStorage (app-private), 7 days for the cache, both cleared on sign-out; sign-out with waiting changes asks first: `{n} changes made offline haven’t synced yet. Signing out now deletes them.`
- No native modules.

## Review Focus

1. The server got a change but the answer was lost (timeout): the replay must return the stored answer, not apply it twice. Tests in Tasks 1 and 5.
2. Reconnecting with waiting changes and stale screens: the queue lands before queries refetch. Test in Task 6.
3. Something created offline is ticked or edited before it syncs: its id is final from the start. Tests in Task 2 and Task 3.
4. Signing out with waiting changes: asked first; cache and outbox wiped. Task 7.
5. The server refuses a queued change (the habit was archived on another phone): dropped, the user told, the screen corrected by refetch. Tests in Tasks 4 and 6.

---

### Task 1: API idempotency keys

**Files:** Create `apps/api/src/core/idempotency.ts` + `idempotency.test.ts`; Modify `apps/api/src/db/models.ts` (`IdempotencyRecord`: userId, key, method, path, state `pending|done`, responseStatus, responseBody, expiresAt TTL 48 h; unique userId+key), `apps/api/src/app.ts` (register inside `/v1`), `apps/api/src/modules/privacy/routes.ts` (USER_DATA, not exported) and its test exclusion.

**Produces:** `registerIdempotency(app: FastifyInstance): void` — for authenticated POST/PUT/PATCH/DELETE with header `idempotency-key` (8–64 chars): first sight records `pending`, runs the handler, stores status+body when < 500 (deletes the record on ≥ 500); a repeat with the same key returns the stored answer with header `idempotent-replay: true`; a repeat while pending answers 409 `conflict` "This change is still being saved."; the same key on a different method/path answers 422.
- [ ] Tests (dummy route counting executions): same key twice runs once and returns the same status/body; different keys run twice; a 4xx is replayed; a 5xx is not stored and runs again; pending → 409; no header → untouched; unauthenticated → untouched.

### Task 2: client-chosen ids on create

**Files:** Modify shared create schemas (water, food entry, expense, habit, reminder, subscription: `id: objectIdSchema.optional()`), the six create sites (`water/routes.ts`, `nutrition/service.ts`, `expenses/service.ts`, `habits/service.ts`, `reminders/routes.ts`, `subscriptions/service.ts`); Test `apps/api/src/modules/client-ids.test.ts`.
- [ ] Tests: each create with `id` stores that `_id`; an `id` already taken answers 409.

### Task 3: ids and keys on the phone

**Files:** Create `apps/mobile/src/offline/ids.ts` + test; Modify `apps/mobile/src/api/client.ts` + test.

**Produces:** `newObjectId(now?: Date): string` (24 hex, time-ordered), `newKey(): string`; every non-GET request sends `Idempotency-Key` (`options.idempotencyKey` or a new one).
- [ ] Tests: 24 lowercase hex and distinct; time prefix matches `now`; writes carry a key, reads do not; a given key is sent as given.

### Task 4: the outbox

**Files:** Create `apps/mobile/src/offline/outbox.ts` + test.

**Produces:** `QueuedChange { id; method; path; body?; label; createdAt }`; `useOutbox` (zustand: `items`, `loaded`); `loadOutbox()`, `enqueue(change)`, `drainOutbox(send): Promise<{ sent: number; refused: Array<{ change; reason }> }>` where `send` returns `'done' | { refused: string } | 'retry'`; `clearOutbox()`. Persisted under `synitheia.outbox.v1`.
- [ ] Tests: persists and reloads in order; drains in order and stops at the first `retry`, keeping it and the rest; a refusal is removed and reported; a drain while one runs does not run twice; clear empties storage.

### Task 5: `api.offline.*`

**Files:** Modify `apps/mobile/src/api/client.ts` + test; Create `apps/mobile/src/offline/replay.ts` + test.

**Produces:** `Queued { queued: true; id: string }`, `isQueued(x)`; `api.offline.post|put|patch|delete<T>(path, body?, label)` → `Promise<T | Queued>`: offline (onlineManager) → enqueue without a request; NetworkError → enqueue with the key already sent; ApiError → thrown as before. `replayChange(change)` → `'done'` on 2xx, `{ refused }` on 4xx except 409 in-progress and 429, `'retry'` otherwise.
- [ ] Tests: offline enqueues and returns Queued without fetch; a dropped connection enqueues with the same Idempotency-Key it sent; a 422 throws and enqueues nothing; replay maps 200/204 → done, 422/404 → refused with the server's reason, 409/429/503/network → retry, and sends the change's id as its key.

### Task 6: drain before queries resume

**Files:** Modify `apps/mobile/src/api/connectivity.ts` + test, `apps/mobile/app/_layout.tsx`; Create `apps/mobile/src/offline/sync.ts` (+ test for the summary copy).

**Produces:** `startConnectivity(probe, { beforeOnline })` — going online runs `beforeOnline` first, once, even when several requests succeed meanwhile; `syncNow()` drains, invalidates all queries, toasts refusals and `Synced {n} changes`.
- [ ] Tests: `beforeOnline` completes before `onlineManager.isOnline()` turns true; success notes during the drain do not flip early; sync copy for refusals and counts.

### Task 7: persisted cache, sign-out

**Files:** Create `apps/mobile/src/api/queryClient.ts` (singleton, `gcTime` 7 days, persister); Modify `apps/mobile/app/_layout.tsx` (PersistQueryClientProvider; clear cache, persisted copy and outbox when signed out), `apps/mobile/app/(tabs)/profile.tsx` (sign-out warning), `apps/mobile/package.json`.
- [ ] Verify by typecheck; sign-out warning copy per Global Constraints.

### Task 8: logging offline

**Files:** water screen + trackers tile, `useHabitLog`, Today suggestions, insights feedback/dismiss.
- Water creates send `id: newObjectId()`; the pending-id bin guard goes (ids are final). Saved-offline toast via the outbox's first-queued signal.

### Task 9: meals and expenses offline

**Files:** `food/new.tsx`, `nutrition.tsx`, `expenses/new.tsx` (by hand only), `expenses/[id].tsx` (date, delete, settle), `expenses/owed.tsx`, `expenses/index.tsx`.
- Creates send a client id and insert the optimistic record into the list cache and Today's totals; deletes and edits update caches optimistically.

### Task 10: setup things offline

**Files:** `reminders.tsx`, `subscriptions.tsx`, `habit/new.tsx`, `habit/[id].tsx` (archive), `targets.tsx`.

### Task 11: reminders from the cache

**Files:** `apps/mobile/src/reminders/schedule.ts` + test — when the network fails, plan from cached `['reminders']` and `['today']` (the shared query client) instead of keeping a stale schedule.
- [ ] Tests: fetch fails with cache present → planned from cache; no cache → `failed`, schedule untouched.

### Task 12: what the user sees

**Files:** `OfflineBanner.tsx` (waiting count, syncing), `errorCopy.ts` (offline message) + test.

## Finish

- [ ] `pnpm build && pnpm check`; self-review; ask before merge, push, deploy (API first, then a new app build).
