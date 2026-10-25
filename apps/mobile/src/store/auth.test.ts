import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  clearTokens: vi.fn(),
  hasSession: vi.fn(),
  setSessionExpiredHandler: vi.fn(),
  setTokens: vi.fn(),
  clearReminders: vi.fn(),
  setReminderCurrency: vi.fn(),
}));

/** Shaped like the real ones: what the store looks at is `reason` and `kind`. */
const errors = vi.hoisted(() => {
  class NetworkError extends Error {
    constructor(readonly reason: 'offline' | 'timeout') {
      super(reason);
    }
  }
  class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly kind: 'server' | 'rate' | 'validation' | 'auth' | 'app',
    ) {
      super(`HTTP ${status}`);
    }
  }
  return { NetworkError, ApiError };
});

/** The phone's secure storage, where the last known user is kept for offline launches. */
const secure = vi.hoisted(() => new Map<string, string>());

vi.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => secure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => void secure.set(key, value),
  deleteItemAsync: async (key: string) => void secure.delete(key),
}));

vi.mock('../api/client.js', () => ({
  api: { post: mocks.post, get: mocks.get },
  ApiError: errors.ApiError,
  NetworkError: errors.NetworkError,
  clearTokens: mocks.clearTokens,
  hasSession: mocks.hasSession,
  setSessionExpiredHandler: mocks.setSessionExpiredHandler,
  setTokens: mocks.setTokens,
}));
vi.mock('../reminders/schedule.js', () => ({
  clearReminders: mocks.clearReminders,
  setReminderCurrency: mocks.setReminderCurrency,
}));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('react-native', () => ({
  Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android },
}));
vi.mock('expo-apple-authentication', () => ({}));
vi.mock('expo-auth-session', () => ({}));

const { useAuth } = await import('./auth.js');
const { onlineManager } = await import('@tanstack/react-query');

const USER = {
  id: '6a7025c8d36b5e0013390001',
  email: 'reader@example.com',
  name: 'Reader',
  avatarUrl: null,
  timezone: 'Asia/Kolkata',
  currency: 'USD',
  xp: 0,
  authProviders: ['password'],
  onboardedAt: '2026-10-01T09:00:00.000Z',
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.clearReminders.mockResolvedValue(undefined);
  mocks.clearTokens.mockResolvedValue(undefined);
  mocks.setTokens.mockResolvedValue(undefined);
  secure.clear();
  onlineManager.setOnline(true);
  useAuth.setState({ user: null, status: 'loading', signedOutReason: null });
});

describe('signing out', () => {
  it('cancels the reminders on this phone, even when the server cannot be reached', async () => {
    useAuth.setState({ user: USER, status: 'authed' });
    mocks.post.mockRejectedValue(new TypeError('Network request failed'));

    await useAuth.getState().signOut();

    expect(mocks.clearReminders).toHaveBeenCalledTimes(1);
    expect(mocks.clearTokens).toHaveBeenCalledTimes(1);
    expect(useAuth.getState().status).toBe('anon');
  });

  it('still signs out if cancelling the reminders fails', async () => {
    useAuth.setState({ user: USER, status: 'authed' });
    mocks.post.mockResolvedValue(undefined);
    mocks.clearReminders.mockRejectedValue(new Error('notifications unavailable'));

    await useAuth.getState().signOut();

    expect(mocks.clearTokens).toHaveBeenCalledTimes(1);
    expect(useAuth.getState().status).toBe('anon');
  });
});

describe('a session that expires', () => {
  it('cancels the reminders on this phone too', () => {
    useAuth.getState().init();
    const expire = mocks.setSessionExpiredHandler.mock.calls[0]![0] as () => void;

    expire();

    expect(mocks.clearReminders).toHaveBeenCalledTimes(1);
    expect(useAuth.getState().status).toBe('anon');
  });

  it('remembers why, so sign-in can say so; signing out on purpose does not', async () => {
    useAuth.getState().init();
    const expire = mocks.setSessionExpiredHandler.mock.calls[0]![0] as () => void;

    expire();
    expect(useAuth.getState().signedOutReason).toBe('expired');

    useAuth.setState({ user: USER, status: 'authed' });
    mocks.post.mockResolvedValue(undefined);
    await useAuth.getState().signOut();
    expect(useAuth.getState().signedOutReason).toBeNull();
  });
});

describe('resetting a forgotten password', () => {
  it('signs in with the session the reset returns', async () => {
    useAuth.setState({ user: null, status: 'anon', signedOutReason: 'expired' });
    mocks.post.mockResolvedValue({ user: USER, accessToken: 'access', refreshToken: 'refresh' });

    await useAuth.getState().resetPassword({
      email: ' reader@example.com ',
      code: ' 042719 ',
      password: 'new-password-456',
    });

    expect(mocks.post).toHaveBeenCalledWith('/auth/password-reset/confirm', {
      email: 'reader@example.com',
      code: '042719',
      password: 'new-password-456',
    });
    expect(mocks.setTokens).toHaveBeenCalledWith('access', 'refresh');
    expect(useAuth.getState()).toMatchObject({ status: 'authed', user: USER, signedOutReason: null });
  });
});

describe('opening the app', () => {
  it('remembers who opened it, for a launch without a connection', async () => {
    mocks.hasSession.mockResolvedValue(true);
    mocks.get.mockResolvedValue({ user: USER });

    await useAuth.getState().hydrate();

    expect(JSON.parse(secure.get('synitheia.user')!)).toEqual(USER);
  });

  it('offline, keeps the session and opens as the remembered user', async () => {
    secure.set('synitheia.user', JSON.stringify(USER));
    mocks.hasSession.mockResolvedValue(true);
    mocks.get.mockRejectedValue(new errors.NetworkError('offline'));

    await useAuth.getState().hydrate();

    expect(mocks.clearTokens).not.toHaveBeenCalled();
    expect(useAuth.getState()).toMatchObject({ status: 'authed', user: USER });
  });

  it('with the server down, keeps the session too', async () => {
    secure.set('synitheia.user', JSON.stringify(USER));
    mocks.hasSession.mockResolvedValue(true);
    mocks.get.mockRejectedValue(new errors.ApiError(503, 'server'));

    await useAuth.getState().hydrate();

    expect(mocks.clearTokens).not.toHaveBeenCalled();
    expect(useAuth.getState().status).toBe('authed');
  });

  it('offline with nobody remembered, waits and tries again once the connection is back', async () => {
    mocks.hasSession.mockResolvedValue(true);
    mocks.get
      .mockRejectedValueOnce(new errors.NetworkError('offline'))
      .mockResolvedValueOnce({ user: USER });

    await useAuth.getState().hydrate();
    expect(mocks.clearTokens).not.toHaveBeenCalled();
    expect(useAuth.getState().status).toBe('loading');

    onlineManager.setOnline(false);
    onlineManager.setOnline(true);

    await vi.waitFor(() => expect(useAuth.getState().status).toBe('authed'));
    expect(useAuth.getState().user).toEqual(USER);
  });

  it('signs out when the server says the session is over', async () => {
    secure.set('synitheia.user', JSON.stringify(USER));
    mocks.hasSession.mockResolvedValue(true);
    mocks.get.mockRejectedValue(new errors.ApiError(401, 'auth'));

    await useAuth.getState().hydrate();

    expect(mocks.clearTokens).toHaveBeenCalledTimes(1);
    expect(useAuth.getState().status).toBe('anon');
    expect(secure.has('synitheia.user')).toBe(false);
  });
});

describe('knowing who is signed in', () => {
  it('tells the reminders which currency to write', async () => {
    mocks.hasSession.mockResolvedValue(true);
    mocks.get.mockResolvedValue({ user: USER });

    await useAuth.getState().hydrate();

    expect(mocks.setReminderCurrency).toHaveBeenCalledWith('USD');
  });
});
