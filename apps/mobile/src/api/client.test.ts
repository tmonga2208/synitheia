import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const setItemAsync = vi.fn(async (key: string, value: string, _options?: unknown) => {
  store.set(key, value);
});
const getItemAsync = vi.fn(async (key: string) => store.get(key) ?? null);
const deleteItemAsync = vi.fn(async (key: string) => {
  store.delete(key);
});

vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'afterFirstUnlockThisDeviceOnly',
  setItemAsync,
  getItemAsync,
  deleteItemAsync,
}));
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { apiUrl: 'https://api.test' } } },
}));

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

const client = await import('./client.js');

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  store.clear();
  setItemAsync.mockClear();
  deleteItemAsync.mockClear();
  fetchMock.mockReset();
});

describe('token storage', () => {
  it('stores tokens so a background task can read them on a locked phone', async () => {
    await client.setTokens('access', 'refresh');

    for (const call of setItemAsync.mock.calls) {
      expect(call[2]).toEqual({ keychainAccessible: 'afterFirstUnlockThisDeviceOnly' });
    }
    expect(setItemAsync).toHaveBeenCalledTimes(2);
  });

  it('rewrites existing tokens once, then never again', async () => {
    store.set('synitheia.access', 'old-access');
    store.set('synitheia.refresh', 'old-refresh');

    await client.migrateTokenAccessibility();
    expect(setItemAsync.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(['synitheia.access', 'synitheia.refresh']),
    );
    expect(store.get('synitheia.refresh')).toBe('old-refresh');

    setItemAsync.mockClear();
    await client.migrateTokenAccessibility();
    expect(setItemAsync).not.toHaveBeenCalled();
  });

  it('does nothing when there is no session to migrate', async () => {
    await client.migrateTokenAccessibility();
    expect(setItemAsync.mock.calls.some((c) => c[0] === 'synitheia.access')).toBe(false);
  });
});

describe('a refresh that fails', () => {
  beforeEach(() => {
    store.set('synitheia.access', 'stale');
    store.set('synitheia.refresh', 'expired');
    // The request 401s, then the refresh itself is refused.
    fetchMock.mockResolvedValueOnce(json(401)).mockResolvedValueOnce(json(401));
  });

  it('signs the user out in the foreground', async () => {
    const expired = vi.fn();
    client.setSessionExpiredHandler(expired);

    await expect(client.api.post('/health/sync', {})).rejects.toThrow();

    expect(store.has('synitheia.refresh')).toBe(false);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('leaves the session alone in the background', async () => {
    const expired = vi.fn();
    client.setSessionExpiredHandler(expired);

    await expect(
      client.api.post('/health/sync', {}, { background: true }),
    ).rejects.toThrow();

    // The phone is in a pocket. The next foreground request decides what happens.
    expect(store.get('synitheia.refresh')).toBe('expired');
    expect(store.get('synitheia.access')).toBe('stale');
    expect(expired).not.toHaveBeenCalled();
  });
});
