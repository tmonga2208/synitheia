import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as OutboxModule from './outbox.js';
import type { QueuedChange, SendResult } from './outbox.js';

/** The phone's storage. It outlives the module, the way it outlives the app. */
const disk = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => disk.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      disk.set(key, value);
    },
    removeItem: async (key: string) => {
      disk.delete(key);
    },
  },
}));

const KEY = 'synitheia.outbox.v1';
let outbox: typeof OutboxModule;

/** The app closed and opened again: its memory is gone, the phone's storage is not. */
async function relaunch() {
  vi.resetModules();
  outbox = await import('./outbox.js');
}

beforeEach(async () => {
  disk.clear();
  await relaunch();
});

const change = (id: string, label = `change ${id}`): QueuedChange => ({
  id,
  method: 'POST',
  path: '/water',
  body: { amountMl: 250 },
  label,
  createdAt: '2026-10-25T09:00:00.000Z',
});

const ids = () => outbox.useOutbox.getState().items.map((c) => c.id);
const savedIds = () => (JSON.parse(disk.get(KEY) ?? '[]') as QueuedChange[]).map((c) => c.id);

describe('the outbox', () => {
  it('keeps waiting changes on the phone, in the order they were made', async () => {
    await outbox.enqueue(change('a'));
    await outbox.enqueue(change('b'));

    await relaunch();
    await outbox.loadOutbox();

    expect(ids()).toEqual(['a', 'b']);
    expect(outbox.useOutbox.getState().loaded).toBe(true);
  });

  it('puts a change made before the saved ones have loaded after them, not over them', async () => {
    await outbox.enqueue(change('a'));
    await relaunch();

    await outbox.enqueue(change('b'));

    expect(ids()).toEqual(['a', 'b']);
    expect(savedIds()).toEqual(['a', 'b']);
  });

  it('holds a change once, however often it is queued', async () => {
    await outbox.enqueue(change('a'));
    await outbox.enqueue(change('a'));

    expect(ids()).toEqual(['a']);
  });

  it.each(['not json', '{"id":"a"}', '[{"id":"a"}]'])(
    'starts empty when the phone holds %j',
    async (raw) => {
      disk.set(KEY, raw);
      await relaunch();

      await outbox.loadOutbox();

      expect(ids()).toEqual([]);
      expect(outbox.useOutbox.getState().loaded).toBe(true);
    },
  );
});

describe('drainOutbox', () => {
  it('sends in order, and stops at the first that has to wait, keeping the rest', async () => {
    for (const id of ['a', 'b', 'c']) await outbox.enqueue(change(id));
    const send = vi.fn(
      async (c: QueuedChange): Promise<SendResult> => (c.id === 'a' ? 'done' : 'retry'),
    );

    const result = await outbox.drainOutbox(send);

    expect(send.mock.calls.map(([c]) => c.id)).toEqual(['a', 'b']);
    expect(result).toEqual({ sent: 1, refused: [] });
    expect(ids()).toEqual(['b', 'c']);
    expect(savedIds()).toEqual(['b', 'c']);
  });

  it('drops a refused change and says why', async () => {
    await outbox.enqueue(change('a', 'Morning run'));
    await outbox.enqueue(change('b'));
    const send = async (c: QueuedChange): Promise<SendResult> =>
      c.id === 'a' ? { refused: 'This habit was archived.' } : 'done';

    const result = await outbox.drainOutbox(send);

    expect(result).toEqual({
      sent: 1,
      refused: [{ change: change('a', 'Morning run'), reason: 'This habit was archived.' }],
    });
    expect(ids()).toEqual([]);
    expect(disk.has(KEY)).toBe(false);
  });

  it('sends a change made during the sync in the same sync, after the others', async () => {
    await outbox.enqueue(change('a'));
    const send = vi.fn(async (c: QueuedChange): Promise<SendResult> => {
      if (c.id === 'a') await outbox.enqueue(change('b'));
      return 'done';
    });

    const result = await outbox.drainOutbox(send);

    expect(send.mock.calls.map(([c]) => c.id)).toEqual(['a', 'b']);
    expect(result.sent).toBe(2);
  });

  it('does not run twice when asked again while sending', async () => {
    await outbox.enqueue(change('a'));
    let answer: (result: SendResult) => void = () => undefined;
    const send = vi.fn(
      () =>
        new Promise<SendResult>((resolve) => {
          answer = resolve;
        }),
    );

    const first = outbox.drainOutbox(send);
    const second = outbox.drainOutbox(send);
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    answer('done');

    expect(await first).toEqual({ sent: 1, refused: [] });
    expect(await second).toEqual({ sent: 1, refused: [] });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps a change whose sending broke, for the next try', async () => {
    await outbox.enqueue(change('a'));

    const result = await outbox.drainOutbox(async () => {
      throw new Error('boom');
    });

    expect(result).toEqual({ sent: 0, refused: [] });
    expect(ids()).toEqual(['a']);
  });

  it('says it is syncing only while it is', async () => {
    await outbox.enqueue(change('a'));
    const seen: boolean[] = [];

    await outbox.drainOutbox(async () => {
      seen.push(outbox.useOutbox.getState().syncing);
      return 'done';
    });

    expect(seen).toEqual([true]);
    expect(outbox.useOutbox.getState().syncing).toBe(false);
  });
});

describe('clearOutbox', () => {
  it('empties the queue and the phone’s copy', async () => {
    await outbox.enqueue(change('a'));

    await outbox.clearOutbox();

    expect(ids()).toEqual([]);
    expect(disk.has(KEY)).toBe(false);
    await relaunch();
    await outbox.loadOutbox();
    expect(ids()).toEqual([]);
  });
});
