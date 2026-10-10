/**
 * Whether the session check should wait until the app is actually on screen.
 *
 * The OS can start the app with nobody looking, to run the background task. If the React
 * tree mounts on such a launch, the usual start-up session check runs as a foreground
 * request — and a foreground request that finds a dead session signs the user out. So on
 * a launch that is definitely in the background, the check waits for the app to become
 * active.
 *
 * Only a definite 'background' defers. iOS reports 'inactive' or 'unknown' for a moment
 * during an ordinary cold start, and deferring there would wait for an 'active' event
 * that may already have happened, holding the splash screen forever.
 */
export function shouldDeferHydrate(appState: string | null | undefined): boolean {
  return appState === 'background';
}
