import { beforeEach, describe, expect, it, vi } from 'vitest';

const isSupported = vi.fn<() => boolean>();
const readCalendar = vi.fn();
const post = vi.fn();

vi.mock('../calendar/calendar.js', () => ({ isSupported, readCalendar }));
vi.mock('../api/client.js', () => ({ api: { post } }));

const { runCalendarSync } = await import('./runCalendarSync.js');

beforeEach(() => {
  isSupported.mockReset().mockReturnValue(true);
  readCalendar.mockReset();
  post.mockReset();
});

describe('runCalendarSync', () => {
  it('posts the window it read, even when it is empty', async () => {
    // An empty calendar is a valid outcome: it is how a deleted meeting leaves the day.
    readCalendar.mockResolvedValue([]);
    post.mockResolvedValue({ events: 0, added: 0, suggestions: [] });

    const result = await runCalendarSync({ background: true });

    expect(post).toHaveBeenCalledWith('/calendar/sync', { events: [] }, { background: true });
    expect(result).toEqual({ ok: true, skipped: false, suggestions: [] });
  });

  it('skips where there is no calendar', async () => {
    isSupported.mockReturnValue(false);
    expect(await runCalendarSync()).toEqual({ ok: true, skipped: true, suggestions: [] });
  });

  it('reports failure without throwing', async () => {
    readCalendar.mockRejectedValue(new Error('permission revoked'));
    expect(await runCalendarSync()).toEqual({ ok: false, skipped: false, suggestions: [] });
  });
});
