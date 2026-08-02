import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';
import trackPng from '../../src/assets/tabs/track.png';
import todayPng from '../../src/assets/tabs/today.png';
import youPng from '../../src/assets/tabs/you.png';
import { useTheme } from '../../src/theme/ThemeProvider.js';

/**
 * Three destinations, with Today in the middle.
 *
 * Today is the product — the ring, the habits, the day as Synítheia read it. Putting it in
 * the CENTRE, under the thumb, says so structurally: it is the place you return to, not the
 * first item in a list of features. Track sits to its left because that is where the day
 * comes from; You sits to its right because that is where you go to change how it behaves.
 *
 * "Track" is a verb, not "Trackers". Nobody thinks "I will go to my trackers"; they think
 * "I want to log this" or "how much have I spent". The tab is named for the intent.
 */

/**
 * This is the platform's REAL tab bar, not a React re-creation of one.
 *
 * expo-router's NativeTabs renders a UITabBarController on iOS and a Material
 * BottomNavigationView on Android — so each OS draws its own bar. Built against the iOS 26
 * SDK, that means Liquid Glass with nothing asked for: the system provides the material,
 * the blur, the minimise-on-scroll, the safe-area handling. We supply the destinations, the
 * icons, and the tint; the OS supplies everything about how a tab bar should look and feel.
 *
 * Icons are the platform's own too. iOS takes an SF Symbol; Android takes a raster (a React
 * SVG component cannot be handed to a native tab item), so each icon names a symbol for iOS
 * and points at a generated PNG of the matching glyph for Android — one <Icon> covers both.
 *
 * Insights, Habits and Reminders are NOT tabs and do not belong here. They were briefly
 * declared as `hidden` triggers on the theory that `hidden` is the native equivalent of the
 * old `href: null` — registered, reachable, just not drawn on the bar. It is not:
 * NativeTabsView FILTERS hidden triggers out of the native tab container entirely
 * (shouldTabBeVisible === `options.hidden === false`), so no BottomTabsScreen is ever mounted
 * for them. A push then moved the navigation state with nothing on screen to show it, and
 * every tap that led there — the bell, the Habits tile, "What Synítheia noticed" — looked
 * dead. They are secondary detail screens, so they live in the root Stack alongside water,
 * nutrition and expenses and push OVER the bar — the idiomatic place for a screen you
 * navigate to but never tab to.
 */

/**
 * Today is the landing tab, even though Track's trigger is declared FIRST. Trigger order is
 * left-to-right placement; without this, the router would also treat the first-declared
 * route as the initial one and cold-start on Track.
 */
export const unstable_settings = { initialRouteName: 'index' };

export default function TabsLayout() {
  const t = useTheme();

  /**
   * `tintColor` is the only theme-aware prop this needs.
   *
   * Task 8 first wired the bar's background and inactive icon/label colours here directly
   * (`backgroundColor`, `iconColor`, `labelStyle`, plus `disableTransparentOnScrollEdge` to
   * reach the tab bar's transparent "scroll edge" state) because, at the time, nothing in
   * this app ever told the OS that a Dark override was in effect — only the SCREENS knew.
   * That is no longer true: `ThemeProvider`'s `useSyncNativeAppearance` now calls
   * `Appearance.setColorScheme()` whenever `preference` changes, which (see that function's
   * doc comment, and the RN/iOS/Android source it cites) sets `overrideUserInterfaceStyle`
   * on every `UIWindow` / flips `AppCompatDelegate`'s night mode for the whole app — not
   * just this screen.
   *
   * That is the SAME mechanism the "nothing asked for" Liquid Glass material this file used
   * to brag about was always reading its light/dark colouring from — it was only ever
   * correct by coincidence, because the app had never diverged from the OS before Task 8.
   * Once the window/activity itself carries the app's chosen theme, the untouched system
   * default (still nothing asked for here beyond `tintColor`) resolves against THAT
   * override for both the standard and scroll-edge appearances, on both platforms — so the
   * `backgroundColor`/`iconColor`/`labelStyle`/`disableTransparentOnScrollEdge` block this
   * file briefly carried is redundant and has been removed; keeping it would have meant a
   * flat, no-blur dark tab bar for no reason once the native layer already tracks theme on
   * its own. `tintColor` still needs to be explicit in both modes — it is this app's sage
   * accent overriding the platform's default tint, not a light/dark distinction.
   */
  return (
    <NativeTabs tintColor={t.accent}>
      <NativeTabs.Trigger name="trackers">
        <Icon sf="square.grid.2x2" androidSrc={trackPng} />
        <Label>Track</Label>
      </NativeTabs.Trigger>

      {/* The middle. Declaration order is left-to-right, so this is literally centre. */}
      <NativeTabs.Trigger name="index">
        <Icon sf="house" androidSrc={todayPng} />
        <Label>Today</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile">
        <Icon sf="person" androidSrc={youPng} />
        <Label>You</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
