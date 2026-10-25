import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueuedChange } from './outbox.js';

vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'afterFirstUnlockThisDeviceOnly',
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { apiUrl: 'https://api.test' } } },
}));
vi.mock('expo-crypto', () => ({
  getRandomBytes: (count: number) => webcrypto.getRandomValues(new Uint8Array(count)),
  randomUUID: () => webcrypto.randomUUID(),
}));
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

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

const { QueryClient, onlineManager } = await import('@tanstack/react-query');
const outbox = await import('./outbox.js');
const { useToast } = await import('../feedback/toast.js');
const { syncMessage, syncNow } = await import('./sync.js');

const change = (id: string, label = '250 ml of water'): QueuedChange => ({
  id,
  method: 'POST',
  path: '/water',
  body: { amountMl: 250 },
  label,
  createdAt: '2026-10-25T09:00:00.000Z',
});

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('syncMessage', () => {
  it('counts what was sent', () => {
    expect(syncMessage({ sent: 3, refused: [] })).toEqual({
      message: 'Synced 3 changes',
      tone: 'neutral',
    });
    expect(syncMessage({ sent: 1, refused: [] })?.message).toBe('Synced 1 change');
  });

  it('says nothing when nothing was waiting', () => {
    expect(syncMessage({ sent: 0, refused: [] })).toBeNull();
  });

  it('names a refused change, and why, over what was sent', () => {
    const refused = [{ change: change('a', 'Morning run'), reason: 'Habit not found' }];

    expect(syncMessage({ sent: 2, refused })).toEqual({
      message: 'Couldn’t sync “Morning run”. Habit not found',
      tone: 'error',
    });
  });

  it('counts several refused changes', () => {
    const refused = [
      { change: change('a', 'Morning run'), reason: 'Habit not found' },
      { change: change('b', 'Coffee'), reason: 'Category not found' },
    ];

    expect(syncMessage({ sent: 0, refused })).toEqual({
      message: 'Couldn’t sync 2 changes made offline, including “Morning run”.',
      tone: 'error',
    });
  });
});

describe('syncNow', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    onlineManager.setOnline(true);
    await outbox.clearOutbox();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends what waited, refreshes the screens, and says so', async () => {
    await outbox.enqueue(change('a'));
    fetchMock.mockResolvedValueOnce(json(201));
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    await syncNow(client);

    expect(outbox.useOutbox.getState().items).toEqual([]);
    expect(invalidate).toHaveBeenCalled();
    expect(useToast.getState().current?.message).toBe('Synced 1 change');
  });

  it('leaves the screens alone when nothing was waiting', async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    await syncNow(client);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('tries a stuck queue again later, while online', async () => {
    await outbox.enqueue(change('a'));
    fetchMock
      .mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 502 }))
      .mockResolvedValueOnce(json(201));

    await syncNow(new QueryClient());
    expect(outbox.useOutbox.getState().items).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outbox.useOutbox.getState().items).toEqual([]);
  });
});
