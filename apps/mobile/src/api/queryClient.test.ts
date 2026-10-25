import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'afterFirstUnlockThisDeviceOnly',
}));
vi.mock('expo-constants', () => ({
  default: { expoConfig: { version: '1.4.0', extra: {} } },
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

const { cachePersister, forgetLocalData, persistOptions, queryClient, shouldKeepQuery } =
  await import('./queryClient.js');
const outbox = await import('../offline/outbox.js');

beforeEach(() => {
  queryClient.clear();
  disk.clear();
});

function cached(queryKey: unknown[]) {
  queryClient.setQueryData(queryKey, { any: 'thing' });
  return queryClient.getQueryCache().find({ queryKey, exact: true })!;
}

describe('what is kept on the phone', () => {
  it('keeps what the screens showed, for a week', () => {
    expect(shouldKeepQuery(cached(['today']))).toBe(true);
    expect(shouldKeepQuery(cached(['expense', 'e1']))).toBe(true);
    expect(persistOptions.maxAge).toBe(7 * 24 * 60 * 60 * 1000);
    expect(queryClient.getDefaultOptions().queries?.gcTime).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('does not keep a signed receipt link, or the sign-in options', () => {
    expect(shouldKeepQuery(cached(['receipt', 'e1']))).toBe(false);
    expect(shouldKeepQuery(cached(['auth-options']))).toBe(false);
  });

  it('starts afresh after an app update, which may change what the data looks like', () => {
    expect(persistOptions.buster).toContain('1.4.0');
  });
});

describe('forgetLocalData', () => {
  it('forgets the cache, its copy on the phone, and the changes waiting to be sent', async () => {
    cached(['today']);
    await cachePersister.persistClient({
      timestamp: Date.now(),
      buster: persistOptions.buster,
      clientState: { mutations: [], queries: [] },
    });
    await outbox.enqueue({
      id: 'waiting-1',
      method: 'POST',
      path: '/water',
      body: { amountMl: 250 },
      label: '250 ml of water',
      createdAt: '2026-10-25T09:00:00.000Z',
    });

    await forgetLocalData();

    expect(queryClient.getQueryData(['today'])).toBeUndefined();
    expect([...disk.keys()]).toEqual([]);
    expect(outbox.useOutbox.getState().items).toEqual([]);
  });
});
