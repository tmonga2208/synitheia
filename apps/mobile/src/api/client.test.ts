import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
/** The accessibility class each item was CREATED with. */
const accessibility = new Map<string, unknown>();
/**
 * Behaves like the iOS keychain: writing to a key that already exists updates its value
 * and nothing else. The accessibility class is fixed when the item is first added, which
 * is exactly why re-saving a token does not make it readable in the background.
 */
const setItemAsync = vi.fn(
  async (key: string, value: string, options?: { keychainAccessible?: unknown }) => {
    if (!store.has(key)) accessibility.set(key, options?.keychainAccessible);
    store.set(key, value);
  },
);
const getItemAsync = vi.fn(async (key: string) => store.get(key) ?? null);
const deleteItemAsync = vi.fn(async (key: string) => {
  store.delete(key);
  accessibility.delete(key);
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
  accessibility.clear();
  getItemAsync.mockClear();
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

  it('actually changes the class of tokens an older build stored', async () => {
    // Stored by a build that passed no options: readable only while unlocked.
    store.set('synitheia.access', 'old-access');
    store.set('synitheia.refresh', 'old-refresh');
    accessibility.set('synitheia.access', undefined);
    accessibility.set('synitheia.refresh', undefined);

    await client.migrateTokenAccessibility();

    expect(accessibility.get('synitheia.access')).toBe('afterFirstUnlockThisDeviceOnly');
    expect(accessibility.get('synitheia.refresh')).toBe('afterFirstUnlockThisDeviceOnly');
    expect(store.get('synitheia.access')).toBe('old-access');
    expect(store.get('synitheia.refresh')).toBe('old-refresh');
  });

  it('does not throw, and tries again next launch, when the keychain cannot be read', async () => {
    // A launch while the phone is locked: the old items are unreadable until unlock.
    getItemAsync.mockRejectedValueOnce(new Error('errSecInteractionNotAllowed'));

    await expect(client.migrateTokenAccessibility()).resolves.toBeUndefined();
    expect(store.has('synitheia.tokens.v2')).toBe(false);
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

describe('a failed refresh shared by a background and a foreground request', () => {
  it('signs out, because someone is looking', async () => {
    store.set('synitheia.access', 'stale');
    store.set('synitheia.refresh', 'expired');
    const expired = vi.fn();
    client.setSessionExpiredHandler(expired);

    // Both requests 401, and both wait on ONE refresh — started by the background one.
    let releaseRefresh!: (res: Response) => void;
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith('/auth/refresh')) {
        return new Promise<Response>((resolve) => {
          releaseRefresh = resolve;
        });
      }
      return json(401);
    });

    const background = client.api.post('/health/sync', {}, { background: true });
    const foreground = client.api.get('/me');
    await vi.waitFor(() => expect(releaseRefresh).toBeTypeOf('function'));
    // Let the foreground request reach the shared refresh before it settles.
    await new Promise((resolve) => setTimeout(resolve, 10));
    releaseRefresh(json(401));

    await expect(background).rejects.toThrow();
    await expect(foreground).rejects.toThrow();

    expect(store.has('synitheia.refresh')).toBe(false);
    expect(expired).toHaveBeenCalledTimes(1);
  });
});
