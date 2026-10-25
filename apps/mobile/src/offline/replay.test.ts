import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueuedChange } from './outbox.js';

const keychain = new Map<string, string>();
vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'afterFirstUnlockThisDeviceOnly',
  getItemAsync: async (key: string) => keychain.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    keychain.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    keychain.delete(key);
  },
}));
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { apiUrl: 'https://api.test' } } },
}));
vi.mock('expo-crypto', () => ({
  getRandomBytes: (count: number) => webcrypto.getRandomValues(new Uint8Array(count)),
  randomUUID: () => webcrypto.randomUUID(),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

const { replayChange } = await import('./replay.js');

beforeEach(() => {
  keychain.clear();
  fetchMock.mockReset();
});

const change = (overrides: Partial<QueuedChange> = {}): QueuedChange => ({
  id: 'change-key-0001',
  method: 'POST',
  path: '/water',
  body: { amountMl: 250 },
  label: '250 ml of water',
  createdAt: '2026-10-25T09:00:00.000Z',
  ...overrides,
});

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const refusal = (status: number, code: string, message: string, details?: unknown) =>
  json(status, { error: { code, message, details, requestId: 'r' } });

describe('replayChange', () => {
  it('sends the change as it was made, under its own id as its key', async () => {
    fetchMock.mockResolvedValueOnce(json(201));

    await replayChange(change());

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.test/v1/water');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ amountMl: 250 }));
    expect((init?.headers as Record<string, string>)['Idempotency-Key']).toBe('change-key-0001');
  });

  it.each([
    ['200', () => json(200)],
    ['204', () => new Response(null, { status: 204 })],
  ])('is done when the server answers %s', async (_status, answer) => {
    fetchMock.mockResolvedValueOnce(answer());

    expect(await replayChange(change())).toBe('done');
  });

  it.each([
    [422, 'validation_failed', 'Too much water for one entry'],
    [404, 'not_found', 'Habit not found'],
    [409, 'conflict', 'Something with this id already exists.'],
  ])('is refused on %i, with the server’s reason', async (status, code, message) => {
    fetchMock.mockResolvedValueOnce(refusal(status, code, message));

    expect(await replayChange(change())).toEqual({ refused: message });
  });

  it('is done when what it deletes is already gone', async () => {
    fetchMock.mockResolvedValueOnce(refusal(404, 'not_found', 'Water entry not found'));

    const deletion = change({ method: 'DELETE', path: '/water/w1', body: undefined });

    expect(await replayChange(deletion)).toBe('done');
  });

  it('waits while its first send is still being saved', async () => {
    fetchMock.mockResolvedValueOnce(
      refusal(409, 'conflict', 'This change is still being saved.', { inProgress: true }),
    );

    expect(await replayChange(change())).toBe('retry');
  });

  it.each([
    ['429', () => refusal(429, 'rate_limited', 'Too many requests')],
    ['503', () => refusal(503, 'ai_unavailable', 'Not available right now')],
    ['a gateway page', () => new Response('<html>Bad gateway</html>', { status: 502 })],
    ['a proxy’s 404 page', () => new Response('Not found', { status: 404 })],
  ])('waits on %s', async (_what, answer) => {
    fetchMock.mockResolvedValueOnce(answer());

    expect(await replayChange(change())).toBe('retry');
  });

  it('waits when there is no answer', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));

    expect(await replayChange(change())).toBe('retry');
  });

  it('waits, rather than drop the change, when the session cannot be renewed', async () => {
    keychain.set('synitheia.refresh', 'expired');
    fetchMock
      .mockResolvedValueOnce(refusal(401, 'unauthorized', 'Authentication required'))
      .mockResolvedValueOnce(refusal(401, 'unauthorized', 'Session expired'));

    expect(await replayChange(change())).toBe('retry');
  });

  it('drops a server fault, saying so, instead of holding every change behind it', async () => {
    fetchMock.mockResolvedValueOnce(refusal(500, 'internal', 'Something went wrong'));

    expect(await replayChange(change())).toEqual({ refused: 'Something went wrong on our side.' });
  });
});
