import Constants from 'expo-constants';
import { MutationCache, QueryClient, type Query } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { showToast } from '../feedback/toast.js';
import { clearOutbox } from '../offline/outbox.js';
import { errorLine } from './errorCopy.js';

/**
 * The app's one query client, and its copy on the phone.
 *
 * What the screens last showed is saved to the phone (AsyncStorage, private to the app) and
 * read back at launch, so the app opens on its last data even with no connection, and
 * refreshes it when it can. Kept for a week; forgotten on signing out.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * What a mutation may say about itself. `failed` names the action for the toast ("Couldn’t
 * log water"); `reportsOwnError` marks a screen that shows its own error, inline or in an
 * alert, so the same failure is not reported twice.
 */
interface MutationMeta {
  failed?: string;
  reportsOwnError?: boolean;
}

export const queryClient = new QueryClient({
  // A failed change always says so. Many used to fail in silence: a glass of water that
  // did not log, an expense that did not delete, with nothing on screen to show it.
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      const meta = (mutation.meta ?? {}) as MutationMeta;
      if (meta.reportsOwnError) return;
      showToast({ message: errorLine(error, meta.failed), tone: 'error' });
    },
  }),
  defaultOptions: {
    queries: {
      // Personal tracking data changes slowly and mostly from this device. A minute of
      // staleness avoids a refetch storm on every tab switch without ever showing the
      // user a number they'd call wrong.
      staleTime: 60_000,
      // As long as the copy on the phone is kept: a query dropped from memory sooner would
      // be dropped from that copy too.
      gcTime: WEEK_MS,
      retry: 2,
      refetchOnWindowFocus: false,
    },
    mutations: {
      // A change made offline fails at once and says so, rather than waiting, paused and
      // silent, for a connection that may never come while the screen is open.
      networkMode: 'always',
    },
  },
});

/** Imported lazily, as in src/sync/sourcePrefs.ts: it throws under Node at import time. */
async function asyncStorage() {
  const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
  return AsyncStorage;
}

export const cachePersister = createAsyncStoragePersister({
  key: 'synitheia.cache.v1',
  storage: {
    getItem: async (key: string) => (await asyncStorage()).getItem(key),
    setItem: async (key: string, value: string) => (await asyncStorage()).setItem(key, value),
    removeItem: async (key: string) => (await asyncStorage()).removeItem(key),
  },
});

/**
 * Not kept: a receipt's signed link, which expires within the hour and is meant never to
 * be stored, and the sign-in options, which are only read before signing in.
 */
const NOT_KEPT = new Set(['receipt', 'auth-options']);

export function shouldKeepQuery(query: Query): boolean {
  return query.state.status === 'success' && !NOT_KEPT.has(String(query.queryKey[0]));
}

export const persistOptions = {
  persister: cachePersister,
  maxAge: WEEK_MS,
  // An update may change what the data looks like; a copy saved by another version is
  // dropped rather than shown to screens that no longer expect it.
  buster: `cache-1:${Constants.expoConfig?.version ?? 'dev'}`,
  dehydrateOptions: { shouldDehydrateQuery: shouldKeepQuery },
};

/** Forget what this account left on the phone: the cache, its saved copy, waiting changes. */
export async function forgetLocalData(): Promise<void> {
  queryClient.clear();
  await Promise.all([cachePersister.removeClient(), clearOutbox()]);
}
