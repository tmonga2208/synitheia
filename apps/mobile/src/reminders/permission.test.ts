import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
}));

vi.mock('expo-notifications', () => ({
  getPermissionsAsync: mocks.getPermissionsAsync,
  requestPermissionsAsync: mocks.requestPermissionsAsync,
}));

const { accessCopy, askForNotifications, readNotificationAccess } = await import('./permission.js');

beforeEach(() => {
  mocks.getPermissionsAsync.mockReset();
  mocks.requestPermissionsAsync.mockReset();
});

describe('reading notification access', () => {
  it('tells allowed, not yet asked, and refused-for-good apart', async () => {
    mocks.getPermissionsAsync.mockResolvedValueOnce({ granted: true, canAskAgain: true });
    expect(await readNotificationAccess()).toBe('granted');

    mocks.getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: true });
    expect(await readNotificationAccess()).toBe('ask');

    mocks.getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false });
    expect(await readNotificationAccess()).toBe('blocked');
  });
});

describe('asking for notifications', () => {
  it('asks when the phone still can, and reports the answer', async () => {
    mocks.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    mocks.requestPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });

    expect(await askForNotifications()).toBe('granted');
    expect(mocks.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('does not ask once the phone will no longer show the question', async () => {
    mocks.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });

    expect(await askForNotifications()).toBe('blocked');
    expect(mocks.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('does not ask again when already allowed', async () => {
    mocks.getPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });

    expect(await askForNotifications()).toBe('granted');
    expect(mocks.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('what the Reminders screen says', () => {
  it('says nothing when reminders can arrive', () => {
    expect(accessCopy('granted')).toBeNull();
  });

  it('offers to ask while the phone still can', () => {
    expect(accessCopy('ask')).toMatchObject({ action: 'ask', actionLabel: 'Turn on notifications' });
  });

  it('sends the user to Settings once it cannot', () => {
    expect(accessCopy('blocked')).toMatchObject({ action: 'settings', actionLabel: 'Open Settings' });
  });
});
