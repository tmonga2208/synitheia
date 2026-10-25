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
vi.mock('expo-crypto', () => ({
  getRandomBytes: (count: number) => new Uint8Array(count).map(() => Math.floor(Math.random() * 256)),
  randomUUID: () => `key-${Math.random().toString(16).slice(2)}-${Date.now()}`,
}));

/** The phone's storage, where the outbox keeps changes made offline. */
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

const { onlineManager } = await import('@tanstack/react-query');
const client = await import('./client.js');
const outbox = await import('../offline/outbox.js');

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
  onlineManager.setOnline(true);
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

describe('when a request fails', () => {
  it('calls a failure to connect "offline"', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));

    const error = await client.api.get('/today').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(client.NetworkError);
    expect((error as InstanceType<typeof client.NetworkError>).reason).toBe('offline');
  });

  it('gives up on a request that never answers, after 20 seconds', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      );

      const pending = client.api.get('/today').catch((caught: unknown) => caught);
      await vi.advanceTimersByTimeAsync(19_999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);

      const error = await pending;
      expect(error).toBeInstanceOf(client.NetworkError);
      expect((error as InstanceType<typeof client.NetworkError>).reason).toBe('timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives an upload a minute before giving up', async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      fetchMock.mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              aborted = true;
              reject(new Error('aborted'));
            });
          }),
      );

      const pending = client.api.upload('/expenses/ingest/image', new FormData()).catch(() => undefined);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(aborted).toBe(true);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });

  it('says the server is the problem when it answers with an error page', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
    );

    const error = await client.api.get('/today').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(client.ApiError);
    expect((error as InstanceType<typeof client.ApiError>).kind).toBe('server');
  });

  it('tells rate limits, refused input and other refusals apart', async () => {
    const body = (code: string, message: string) => ({ error: { code, message, requestId: 'r' } });
    fetchMock
      .mockResolvedValueOnce(json(429, body('rate_limited', 'Too many requests')))
      .mockResolvedValueOnce(json(422, body('validation_failed', 'Request validation failed')))
      .mockResolvedValueOnce(json(400, body('bad_request', 'Cannot log a habit for a future date')));

    const kinds = [];
    for (let i = 0; i < 3; i += 1) {
      const error = (await client.api.post('/habits/x/log', {}).catch((caught: unknown) => caught)) as InstanceType<
        typeof client.ApiError
      >;
      kinds.push(error.kind);
    }

    expect(kinds).toEqual(['rate', 'validation', 'app']);
  });
});

describe('telling the app whether it is online', () => {
  it('reports a request that could not connect, and the next one that gets any answer', async () => {
    const { onlineManager } = await import('@tanstack/react-query');
    onlineManager.setOnline(true);
    fetchMock
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(json(503, {}));

    await client.api.get('/today').catch(() => undefined);
    expect(onlineManager.isOnline()).toBe(false);

    // A 503 is the server being unwell, but it answered: the phone is online.
    await client.api.get('/today').catch(() => undefined);
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('checks the server with a plain health request', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    expect(await client.probeServer()).toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.test/health');

    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    expect(await client.probeServer()).toBe(false);
  });
});

describe('change keys', () => {
  const headerOf = (call: number, name: string) =>
    (fetchMock.mock.calls[call]![1]?.headers as Record<string, string>)[name];

  it('mark every write, so the server can tell a resend from a new change', async () => {
    fetchMock.mockResolvedValueOnce(json(201, {})).mockResolvedValueOnce(json(200, {}));

    await client.api.post('/water', { amountMl: 250 });
    await client.api.get('/today');

    expect(headerOf(0, 'Idempotency-Key')).toMatch(/.{8,}/);
    expect(headerOf(1, 'Idempotency-Key')).toBeUndefined();
  });

  it('send a change’s own key when it is sent again', async () => {
    fetchMock.mockResolvedValueOnce(json(201, {}));

    await client.request('/water', {
      method: 'POST',
      body: { amountMl: 250 },
      idempotencyKey: 'queued-change-1',
    });

    expect(headerOf(0, 'Idempotency-Key')).toBe('queued-change-1');
  });

  it('send a write retried after a token refresh as the same change', async () => {
    store.set('synitheia.access', 'stale');
    store.set('synitheia.refresh', 'good');
    fetchMock
      .mockResolvedValueOnce(json(401))
      .mockResolvedValueOnce(json(200, { accessToken: 'new-access', refreshToken: 'new-refresh' }))
      .mockResolvedValueOnce(json(201, {}));

    await client.api.post('/water', { amountMl: 250 });

    expect(headerOf(2, 'Idempotency-Key')).toBe(headerOf(0, 'Idempotency-Key'));
  });
});

describe('writes that can wait (api.offline)', () => {
  beforeEach(async () => {
    await outbox.clearOutbox();
  });

  const waiting = () => outbox.useOutbox.getState().items;

  it('send at once when online, and return the answer', async () => {
    fetchMock.mockResolvedValueOnce(json(201, { entry: { id: 'w1' } }));

    const result = await client.api.offline.post('/water', { amountMl: 250 }, '250 ml of water');

    expect(result).toEqual({ entry: { id: 'w1' } });
    expect(client.isQueued(result)).toBe(false);
    expect(waiting()).toEqual([]);
  });

  it('offline, keep the change on the phone and send nothing', async () => {
    onlineManager.setOnline(false);

    const result = await client.api.offline.post('/water', { amountMl: 250 }, '250 ml of water');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(client.isQueued(result)).toBe(true);
    expect(waiting()).toEqual([
      expect.objectContaining({
        id: (result as { id: string }).id,
        method: 'POST',
        path: '/water',
        body: { amountMl: 250 },
        label: '250 ml of water',
      }),
    ]);
  });

  it('when the answer is lost, keep the change under the key it was sent with', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));

    const result = await client.api.offline.delete('/water/w1', undefined, '250 ml of water');

    const sentKey = (fetchMock.mock.calls[0]![1]?.headers as Record<string, string>)[
      'Idempotency-Key'
    ];
    expect(client.isQueued(result)).toBe(true);
    expect(waiting().map((c) => [c.id, c.method, c.path])).toEqual([
      [sentKey, 'DELETE', '/water/w1'],
    ]);
  });

  it('show a refusal as before, and keep nothing', async () => {
    fetchMock.mockResolvedValueOnce(
      json(422, { error: { code: 'validation_failed', message: 'Too much', requestId: 'r' } }),
    );

    await expect(
      client.api.offline.patch('/targets', { waterMl: 99999 }, 'your targets'),
    ).rejects.toMatchObject({ name: 'ApiError', status: 422 });
    expect(waiting()).toEqual([]);
  });

  it('with changes already waiting, wait behind them so nothing overtakes', async () => {
    await outbox.enqueue({
      id: 'older-change-1',
      method: 'POST',
      path: '/habits',
      body: { name: 'Read' },
      label: 'Read',
      createdAt: '2026-10-25T09:00:00.000Z',
    });

    const result = await client.api.offline.put('/habits/h1/logs/2026-10-25', {}, 'Read');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(client.isQueued(result)).toBe(true);
    expect(waiting().map((c) => c.id)).toEqual(['older-change-1', (result as { id: string }).id]);
  });
});

describe('the write listener', () => {
  it('hears about every change that succeeded', async () => {
    const heard = vi.fn();
    client.setWriteListener(heard);
    fetchMock
      .mockResolvedValueOnce(json(201, { entry: {} }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await client.api.post('/water', { amountMl: 250 });
    await client.api.delete('/water/6a7025c8d36b5e0013390401');

    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('hears nothing for a read, or for a change the server refused', async () => {
    const heard = vi.fn();
    client.setWriteListener(heard);
    fetchMock
      .mockResolvedValueOnce(json(200, {}))
      .mockResolvedValueOnce(
        json(422, { error: { code: 'validation_failed', message: 'No', requestId: 'r' } }),
      );

    await client.api.get('/today');
    await expect(client.api.post('/water', {})).rejects.toThrow();

    expect(heard).not.toHaveBeenCalled();
  });
});
