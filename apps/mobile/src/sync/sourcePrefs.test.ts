import { beforeEach, describe, expect, it, vi } from 'vitest';

const getItem = vi.fn<(key: string) => Promise<string | null>>();
const setItem = vi.fn<(key: string, value: string) => Promise<void>>();
const removeItem = vi.fn<(key: string) => Promise<void>>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem, setItem, removeItem },
}));

const { DEFAULT_PREFS, clearSourcePrefs, readSourcePrefs, writeSourcePrefs } = await import(
  './sourcePrefs.js'
);

beforeEach(() => {
  getItem.mockReset().mockResolvedValue(null);
  setItem.mockReset().mockResolvedValue(undefined);
  removeItem.mockReset().mockResolvedValue(undefined);
});

describe('sourcePrefs', () => {
  it('defaults to nothing connected and the background switch on', async () => {
    expect(await readSourcePrefs()).toEqual({ health: false, calendar: false, background: true });
    expect(DEFAULT_PREFS.background).toBe(true);
  });

  it('merges a patch into what is stored and returns the result', async () => {
    getItem.mockResolvedValue(JSON.stringify({ health: true, calendar: false, background: true }));

    const next = await writeSourcePrefs({ calendar: true });

    expect(next).toEqual({ health: true, calendar: true, background: true });
    expect(setItem).toHaveBeenCalledWith('synitheia.sync-prefs', JSON.stringify(next));
  });

  it.each(['not json', '[]', '{"health":"yes"}', '42'])(
    'falls back to defaults when storage holds %j',
    async (raw) => {
      getItem.mockResolvedValue(raw);
      expect(await readSourcePrefs()).toEqual(DEFAULT_PREFS);
    },
  );

  it('falls back to defaults when storage throws', async () => {
    getItem.mockRejectedValue(new Error('storage unavailable'));
    expect(await readSourcePrefs()).toEqual(DEFAULT_PREFS);
  });

  it('does not reject when a write fails', async () => {
    setItem.mockRejectedValue(new Error('disk full'));
    await expect(writeSourcePrefs({ health: true })).resolves.toEqual({
      health: true,
      calendar: false,
      background: true,
    });
  });

  it('clears on sign-out', async () => {
    await clearSourcePrefs();
    expect(removeItem).toHaveBeenCalledWith('synitheia.sync-prefs');
  });
});
