/**
 * A local mirror of which sources are connected, plus the background switch.
 *
 * The server is the authority on consent and re-checks it on every sync. This mirror
 * exists so the background task does not even READ the OS's health or calendar data for
 * a source the user has switched off — it has no network-free way to ask the server.
 *
 * AsyncStorage is imported lazily for the same reason ThemeProvider does it: the module
 * checks for `window` at import time and throws under Node.
 */

export interface SourcePrefs {
  health: boolean;
  calendar: boolean;
  /** "Sync in the background" on Connected Context. On until the user turns it off. */
  background: boolean;
}

export const DEFAULT_PREFS: SourcePrefs = { health: false, calendar: false, background: true };

const KEY = 'synitheia.sync-prefs';

async function storage() {
  const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
  return AsyncStorage;
}

function parse(raw: string | null): SourcePrefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return DEFAULT_PREFS;
    const v = value as Record<string, unknown>;
    if (
      typeof v.health !== 'boolean' ||
      typeof v.calendar !== 'boolean' ||
      typeof v.background !== 'boolean'
    ) {
      return DEFAULT_PREFS;
    }
    return { health: v.health, calendar: v.calendar, background: v.background };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Never rejects. A background task that cannot read its prefs does nothing, safely. */
export async function readSourcePrefs(): Promise<SourcePrefs> {
  try {
    return parse(await (await storage()).getItem(KEY));
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Never rejects. Returns the merged value even if persisting it failed. */
export async function writeSourcePrefs(patch: Partial<SourcePrefs>): Promise<SourcePrefs> {
  const next = { ...(await readSourcePrefs()), ...patch };
  try {
    await (await storage()).setItem(KEY, JSON.stringify(next));
  } catch {
    // The in-memory answer is still right for this call; the next foreground load of the
    // sources list writes it again.
  }
  return next;
}

export async function clearSourcePrefs(): Promise<void> {
  try {
    await (await storage()).removeItem(KEY);
  } catch {
    // Nothing useful to do; a stale mirror is corrected by the server refusing the sync.
  }
}
