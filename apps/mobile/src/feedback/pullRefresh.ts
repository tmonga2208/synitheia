import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * One pull: spinner on, wait for the refresh, spinner off. Also when the refresh fails —
 * the screen's own error state reports that, and a spinner left on would turn for ever
 * above it.
 */
export async function runPull(
  refresh: () => Promise<unknown>,
  setRefreshing: (on: boolean) => void,
): Promise<void> {
  setRefreshing(true);
  try {
    await refresh();
  } catch {
    // Reported by the screen. The spinner only has to stop.
  } finally {
    setRefreshing(false);
  }
}

/**
 * Pull-to-refresh whose spinner shows for a pull and for nothing else.
 *
 * Screens used to hand the query's `isRefetching` to `refreshing`. That is also true for
 * every quiet re-check: after logging a glass of water, ticking a habit, or coming back to
 * a screen a minute later. Each one dropped the spinner in at the top and pushed the whole
 * screen down and back up — the page lurched every time something was logged.
 */
export function usePullRefresh(refresh: () => Promise<unknown>): {
  refreshing: boolean;
  onRefresh: () => void;
} {
  const [refreshing, setRefreshing] = useState(false);

  // A screen passes a new closure each render; the pull must call the latest one without
  // `onRefresh` changing identity, or the RefreshControl is rebuilt mid-pull.
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });

  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const onRefresh = useCallback(() => {
    void runPull(
      () => latest.current(),
      (on) => {
        // Leaving the screen mid-pull must not set state on a screen that is gone.
        if (mounted.current) setRefreshing(on);
      },
    );
  }, []);

  return { refreshing, onRefresh };
}
