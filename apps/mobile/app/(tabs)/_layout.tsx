import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';
import trackPng from '../../src/assets/tabs/track.png';
import todayPng from '../../src/assets/tabs/today.png';
import youPng from '../../src/assets/tabs/you.png';
import { palette } from '../../src/theme/tokens.js';

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
 * The routable-but-hidden screens (insights, habits, reminders) each need a Trigger with
 * `hidden`. Leaving them out entirely does NOT keep them navigable — NativeTabs only knows
 * the routes it has triggers for, so a push to an unregistered one has no page and the
 * router falls back to the initial tab (Today). `hidden` is the native equivalent of the old
 * `href: null`: registered, reachable, just not drawn on the bar.
 */

/**
 * Today is the landing tab, even though Track's trigger is declared FIRST. Trigger order is
 * left-to-right placement; without this, the router would also treat the first-declared
 * route as the initial one and cold-start on Track.
 */
export const unstable_settings = { initialRouteName: 'index' };

export default function TabsLayout() {
  return (
    <NativeTabs tintColor={palette.sage}>
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

      {/* Registered so they're reachable, hidden so they're not tabs. Insights is opened from
          Today, Habits from Today and Track, Reminders from the bell. */}
      <NativeTabs.Trigger name="insights" hidden />
      <NativeTabs.Trigger name="habits" hidden />
      <NativeTabs.Trigger name="reminders" hidden />
    </NativeTabs>
  );
}
