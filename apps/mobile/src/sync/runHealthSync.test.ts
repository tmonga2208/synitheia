import { beforeEach, describe, expect, it, vi } from 'vitest';

const isSupported = vi.fn<() => boolean>();
const readHealth = vi.fn();
const post = vi.fn();

vi.mock('../health/healthkit.js', () => ({ isSupported, readHealth }));
vi.mock('../api/client.js', () => ({ api: { post } }));

const { runHealthSync } = await import('./runHealthSync.js');

const day = (overrides: Record<string, unknown> = {}) => ({
  localDate: '2026-07-12',
  steps: 4000,
  activeEnergyKcal: null,
  exerciseMinutes: null,
  sleepMinutes: null,
  sleepStart: null,
  sleepEnd: null,
  restingHeartRate: null,
  workouts: [],
  ...overrides,
});

beforeEach(() => {
  isSupported.mockReset().mockReturnValue(true);
  readHealth.mockReset();
  post.mockReset();
});

describe('runHealthSync', () => {
  it('posts what it read and returns the suggestions the server created', async () => {
    const payload = { days: [day()] };
    readHealth.mockResolvedValue(payload);
    post.mockResolvedValue({
      days: 1,
      stepsApplied: 0,
      suggestions: [
        { id: '6a7025c8d36b5e0013390202', type: 'possible_habit_completion', title: 'Mark Run done?', actionable: true },
      ],
    });

    const result = await runHealthSync({ background: true });

    expect(post).toHaveBeenCalledWith('/health/sync', payload, { background: true });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.suggestions).toHaveLength(1);
  });

  it('skips on a platform with no health store', async () => {
    isSupported.mockReturnValue(false);
    expect(await runHealthSync()).toEqual({ ok: true, skipped: true, suggestions: [] });
    expect(readHealth).not.toHaveBeenCalled();
  });

  it('treats an empty read as a no-op — a locked phone, not an empty week', async () => {
    readHealth.mockResolvedValue({ days: [day({ steps: null })] });
    expect(await runHealthSync()).toEqual({ ok: true, skipped: true, suggestions: [] });
    // Posting it would overwrite real numbers with nulls.
    expect(post).not.toHaveBeenCalled();
  });

  it('treats a null read as a no-op', async () => {
    readHealth.mockResolvedValue(null);
    expect(await runHealthSync()).toEqual({ ok: true, skipped: true, suggestions: [] });
  });

  it('still posts when only body metrics came back', async () => {
    readHealth.mockResolvedValue({ days: [day({ steps: null })], body: { weightKg: 70 } });
    post.mockResolvedValue({ days: 1, stepsApplied: 0 });
    expect((await runHealthSync()).skipped).toBe(false);
  });

  it('reports failure without throwing when the read fails', async () => {
    readHealth.mockRejectedValue(new Error('HealthKit unavailable'));
    expect(await runHealthSync()).toEqual({ ok: false, skipped: false, suggestions: [] });
  });

  it('reports failure without throwing when the network fails', async () => {
    readHealth.mockResolvedValue({ days: [day()] });
    post.mockRejectedValue(new Error('offline'));
    expect(await runHealthSync()).toEqual({ ok: false, skipped: false, suggestions: [] });
  });

  it('accepts a response from an API that does not send suggestions yet', async () => {
    readHealth.mockResolvedValue({ days: [day()] });
    post.mockResolvedValue({ days: 1, stepsApplied: 0 });
    expect(await runHealthSync()).toEqual({ ok: true, skipped: false, suggestions: [] });
  });

  it('ignores a malformed suggestions field rather than failing a sync that worked', async () => {
    readHealth.mockResolvedValue({ days: [day()] });
    post.mockResolvedValue({ days: 1, suggestions: 'nope' });
    expect(await runHealthSync()).toEqual({ ok: true, skipped: false, suggestions: [] });
  });
});
