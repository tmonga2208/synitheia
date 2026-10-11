/** The three router calls this needs — so a test can hand it a plain object. */
interface BackNavigation {
  canGoBack(): boolean;
  back(): void;
  replace(href: '/'): void;
}

/**
 * Go back; or, when there is nothing to go back to, go to Today.
 *
 * A screen opened from outside the app is the only screen in the stack. That is how
 * Connected Context arrives when Health Connect's "privacy policy" link is tapped while
 * Synítheia is not in memory. `router.back()` is then a no-op, so the arrow at the top of
 * the one screen that explains what the app reads would be a button that does nothing.
 *
 * The phone's own back button is left alone: it returns to Health Connect, which is where
 * that user came from.
 */
export function goBackOrHome(router: BackNavigation): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
