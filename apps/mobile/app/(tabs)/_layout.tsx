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
   * `tintColor` alone was enough while the app only ever followed the OS: the bar's
   * background and inactive glyphs came from the platform's OWN light/dark appearance,
   * which always matched. Task 8 breaks that assumption — a user can now put the app in
   * Dark on a light phone (or vice-versa), and the platform has no idea that happened,
   * because nothing here ever calls `Appearance.setColorScheme()`. Left alone, the bar
   * would sit there in the OS's colour while every screen above it went the other way.
   *
   * `NativeTabs` (read from `node_modules/expo-router/build/native-tabs/NativeBottomTabs/`)
   * takes plain, non-adaptive colours for exactly this, confirmed against the runtime, not
   * just the .d.ts:
   *   - `backgroundColor` → NativeTabsView.js:72 folds straight into `tabBarBackgroundColor`
   *     for both platforms.
   *   - `iconColor` → utils.js:34 `convertIconColorPropToObject` takes a plain colour as the
   *     "default" (inactive) state; NativeTabsView.js:60 pulls exactly that back out.
   *   - `labelStyle` → utils.js:23 the same way, feeding the inactive label colour
   *     (NativeTabsView.js:61, :101 `tabBarItemTitleFontColor`).
   * `tintColor` still owns the SELECTED icon/label colour on both platforms — confirmed at
   * NativeTabsView.js:75-77, where a `tintColor` appends selected-state colour after the
   * base appearance is built, and at NativeTabsView.js:101's `tabBarItemIconColorActive` /
   * `tabBarItemTitleFontColorActive`, which fall back to `props.tintColor`.
   *
   * One gap remains even with this wired: iOS gives the bar a second appearance for when
   * content is scrolled to the top — "scrollEdgeAppearance" — and (appearance.js:26-42)
   * that ALWAYS resets `backgroundColor` to fully transparent unless the tab bar is also
   * told `disableTransparentOnScrollEdge`. Left off, our `backgroundColor` would only ever
   * show once the user scrolls away from the top; at rest, the bar reverts to the OS's
   * native blur, which is driven by the phone's actual Dark/Light Mode setting (there is no
   * app-level trait-collection override here), not ours — so a light phone running the app
   * in Dark would show a light-tinted blur peeking through at the top of every tab. Setting
   * it only in dark mode closes that gap for the state we can control, at a disclosed cost:
   * the tab bar no longer shows the translucent "Liquid Glass" blur at rest in dark mode —
   * it is a flat, themed bar throughout. The minimise-on-scroll behaviour itself
   * (`minimizeBehavior`, untouched here) is unaffected; only the edge transparency is.
   *
   * Light mode passes none of this — same three props as before this task — so it is
   * pixel-for-pixel what shipped before Task 8.
   */
  const isDark = t.name === 'dark';

  return (
    <NativeTabs
      tintColor={t.accent}
      {...(isDark
        ? {
            backgroundColor: t.surface,
            iconColor: t.textFaint,
            labelStyle: { color: t.textFaint },
            disableTransparentOnScrollEdge: true,
          }
        : null)}
    >
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
