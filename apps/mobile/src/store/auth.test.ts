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

vi.mock('../api/client.js', () => ({
  api: { post: mocks.post, get: mocks.get },
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
  useAuth.setState({ user: null, status: 'loading' });
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
});

describe('knowing who is signed in', () => {
  it('tells the reminders which currency to write', async () => {
    mocks.hasSession.mockResolvedValue(true);
    mocks.get.mockResolvedValue({ user: USER });

    await useAuth.getState().hydrate();

    expect(mocks.setReminderCurrency).toHaveBeenCalledWith('USD');
  });
});
