import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncSuggestion } from '@synitheia/shared';

const getPermissionsAsync = vi.fn<() => Promise<{ granted: boolean }>>();
const requestPermissionsAsync = vi.fn();
const scheduleNotificationAsync = vi.fn<(input: unknown) => Promise<string>>();

vi.mock('expo-notifications', () => ({
  getPermissionsAsync,
  requestPermissionsAsync,
  scheduleNotificationAsync,
}));

const getItem = vi.fn<(key: string) => Promise<string | null>>();
const setItem = vi.fn<(key: string, value: string) => Promise<void>>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem, setItem },
}));

const { notifySuggestions } = await import('./notifySuggestions.js');

const suggestion: SyncSuggestion = {
  id: '6a7025c8d36b5e0013390202',
  type: 'possible_habit_completion',
  title: 'Mark Morning run done?',
  actionable: true,
};

beforeEach(() => {
  // Local noon, whatever zone the test machine is in: outside the policy's quiet hours.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 6, 12, 12, 0, 0));

  getPermissionsAsync.mockReset().mockResolvedValue({ granted: true });
  requestPermissionsAsync.mockReset();
  scheduleNotificationAsync.mockReset().mockResolvedValue('id');
  getItem.mockReset().mockResolvedValue(null);
  setItem.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('notifySuggestions', () => {
  it('posts the suggestion, carrying its id for the tap handler', async () => {
    await notifySuggestions([suggestion]);

    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(scheduleNotificationAsync).toHaveBeenCalledWith({
      content: {
        title: 'Mark Morning run done?',
        body: 'Tap to confirm in Today.',
        data: { suggestionId: suggestion.id },
      },
      trigger: null,
    });
  });

  it('stays silent without permission, and never asks for it', async () => {
    // A background task cannot show a permission sheet, and must not try.
    getPermissionsAsync.mockResolvedValue({ granted: false });

    await notifySuggestions([suggestion]);

    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(requestPermissionsAsync).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('records that it notified BEFORE posting, so a crash cannot repeat a nudge', async () => {
    await notifySuggestions([suggestion]);

    expect(setItem.mock.invocationCallOrder[0]!).toBeLessThan(
      scheduleNotificationAsync.mock.invocationCallOrder[0]!,
    );
    expect(JSON.parse(setItem.mock.calls[0]![1])).toMatchObject({
      count: 1,
      notifiedIds: [suggestion.id],
    });
  });

  it('does not post one it has already posted', async () => {
    getItem.mockResolvedValue(
      JSON.stringify({ localDate: '2026-07-12', count: 1, notifiedIds: [suggestion.id] }),
    );

    await notifySuggestions([suggestion]);

    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('never throws, even when posting fails', async () => {
    scheduleNotificationAsync.mockRejectedValue(new Error('notifications unavailable'));
    await expect(notifySuggestions([suggestion])).resolves.toBeUndefined();
  });

  it('never throws when storage is unreadable', async () => {
    getItem.mockRejectedValue(new Error('storage unavailable'));
    await expect(notifySuggestions([suggestion])).resolves.toBeUndefined();
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});
