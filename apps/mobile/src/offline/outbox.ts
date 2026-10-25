import { create } from 'zustand';

/**
 * Changes made offline, waiting on the phone to be sent.
 *
 * Saved to the phone (AsyncStorage, private to the app) on every change, so a glass of water
 * logged on a train survives the app being closed. Sent in the order they were made, each
 * under its own id as its Idempotency-Key, so a resend after a lost answer is never applied
 * twice (apps/api/src/core/idempotency.ts).
 *
 * AsyncStorage is imported lazily, as in src/sync/sourcePrefs.ts: the module checks for
 * `window` at import time and throws under Node.
 */

export interface QueuedChange {
  /** Also the change's Idempotency-Key. */
  id: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  /** What the change is called if it has to be undone: “250 ml of water”. */
  label: string;
  /** When it was made, as an ISO string. */
  createdAt: string;
}

/** What became of one change: accepted, refused with the server's reason, or not yet. */
export type SendResult = 'done' | { refused: string } | 'retry';

export interface DrainResult {
  sent: number;
  refused: Array<{ change: QueuedChange; reason: string }>;
}

interface OutboxState {
  items: QueuedChange[];
  /** Whether what was saved on the phone has been read back. */
  loaded: boolean;
  /** Whether waiting changes are being sent right now. */
  syncing: boolean;
}

export const useOutbox = create<OutboxState>(() => ({ items: [], loaded: false, syncing: false }));

const KEY = 'synitheia.outbox.v1';
const METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function storage() {
  const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
  return AsyncStorage;
}

function isChange(value: unknown): value is QueuedChange {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === 'string' &&
    typeof c.method === 'string' &&
    METHODS.has(c.method) &&
    typeof c.path === 'string' &&
    typeof c.label === 'string' &&
    typeof c.createdAt === 'string'
  );
}

function parse(raw: string | null): QueuedChange[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isChange) : [];
  } catch {
    return [];
  }
}

let loading: Promise<void> | null = null;

/** Read back what was saved. Runs once; every change waits for it, so none is written over. */
export function loadOutbox(): Promise<void> {
  loading ??= (async () => {
    let saved: QueuedChange[] = [];
    try {
      saved = parse(await (await storage()).getItem(KEY));
    } catch {
      // Unreadable storage starts an empty queue rather than block every change behind it.
    }
    useOutbox.setState((s) => ({ items: [...saved, ...s.items], loaded: true }));
  })();
  return loading;
}

/** Writes run one after another, and each writes the queue as it is when its turn comes. */
let writing: Promise<void> = Promise.resolve();

function save(): Promise<void> {
  writing = writing
    .then(async () => {
      const { items } = useOutbox.getState();
      const store = await storage();
      if (items.length === 0) await store.removeItem(KEY);
      else await store.setItem(KEY, JSON.stringify(items));
    })
    .catch(() => {
      // The queue is still in memory and is sent from there; the next change writes again.
    });
  return writing;
}

export async function enqueue(change: QueuedChange): Promise<void> {
  await loadOutbox();
  if (useOutbox.getState().items.some((c) => c.id === change.id)) return;
  useOutbox.setState((s) => ({ items: [...s.items, change] }));
  await save();
}

let draining: Promise<DrainResult> | null = null;

/**
 * Send what waits, oldest first, until the queue is empty or a change has to wait.
 *
 * A change that has to wait ('retry': no connection, the server busy or down) stops the
 * drain, so nothing made after it overtakes it. A refused change is dropped and reported:
 * sending it again would be refused again. Asked again while it runs, it does not start a
 * second drain; the caller gets the one already running.
 */
export function drainOutbox(
  send: (change: QueuedChange) => Promise<SendResult>,
): Promise<DrainResult> {
  draining ??= drain(send).finally(() => {
    draining = null;
  });
  return draining;
}

async function drain(send: (change: QueuedChange) => Promise<SendResult>): Promise<DrainResult> {
  await loadOutbox();
  const result: DrainResult = { sent: 0, refused: [] };
  if (useOutbox.getState().items.length === 0) return result;

  useOutbox.setState({ syncing: true });
  try {
    // The head is read fresh each time, so a change made during the sync is sent in it too.
    const head = () => useOutbox.getState().items[0];
    for (let change = head(); change; change = head()) {
      let outcome: SendResult;
      try {
        outcome = await send(change);
      } catch {
        outcome = 'retry';
      }
      if (outcome === 'retry') break;

      if (outcome === 'done') result.sent += 1;
      else result.refused.push({ change, reason: outcome.refused });

      const sentId = change.id;
      useOutbox.setState((s) => ({ items: s.items.filter((c) => c.id !== sentId) }));
      await save();
    }
  } finally {
    useOutbox.setState({ syncing: false });
  }
  return result;
}

/** Forget every waiting change, on the phone and in memory. For signing out. */
export async function clearOutbox(): Promise<void> {
  await loadOutbox();
  useOutbox.setState({ items: [] });
  await save();
}
