import { Tabs } from 'expo-router';
import { Home, LayoutGrid, User } from 'lucide-react-native';
import { palette, type } from '../../src/theme/tokens.js';

/**
 * Three destinations, with Today in the middle.
 *
 * Today is the product — the ring, the habits, the day as Synítheia read it. Putting it in
 * the CENTRE, under the thumb, says so structurally: it is the place you return to, not the
 * first item in a list of features. Track sits to its left because that is where the day
 * comes from; You sits to its right because that is where you go to change how it behaves.
 *
 * Insights is deliberately NOT a tab any more. A whole destination for a feature that is off
 * by default, and that "only speaks when it has something to say", is a tab that is empty
 * most of the time — the app's own thesis, filed away in a drawer nobody opens. It now
 * surfaces inside Today, where the day it is talking about already is, and the full history
 * is one tap deeper.
 *
 * "Track" is a verb, not "Trackers". Nobody thinks "I will go to my trackers"; they think
 * "I want to log this" or "how much have I spent". The tab is named for the intent.
 *
 * The bar itself is the platform's own — the OS's blur, safe-area handling, height, and
 * behaviour on every device, none of it reimplemented. Only the tint is ours.
 */

/**
 * Today is the landing tab, even though Track is declared FIRST.
 *
 * Declaration order is what puts Today in the centre of the bar — but expo-router also treats
 * the first declared screen as the initial route, so ordering alone silently landed every cold
 * start on Track. This is the documented way to say "leftmost is not home".
 */
export const unstable_settings = { initialRouteName: 'index' };

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.sage,
        tabBarInactiveTintColor: palette.stoneFaint,
        tabBarLabelStyle: type.caption,
      }}
    >
      <Tabs.Screen
        name="trackers"
        options={{
          title: 'Track',
          tabBarIcon: ({ color, size }) => (
            <LayoutGrid color={color} size={size} strokeWidth={1.8} />
          ),
        }}
      />

      {/* The middle. Declaration order is left-to-right, so this is literally centre. */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} strokeWidth={1.8} />,
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: 'You',
          tabBarIcon: ({ color, size }) => <User color={color} size={size} strokeWidth={1.8} />,
        }}
      />

      {/*
        Routable, never a tab. Insights is reached from Today, Habits from Today and Track,
        Reminders from the bell. They live in this group so they keep the tab bar and its
        insets — `href: null` is what stops them appearing as a fourth and fifth icon in a
        bar the whole navigation model depends on holding at three.
      */}
      <Tabs.Screen name="insights" options={{ href: null }} />
      <Tabs.Screen name="habits" options={{ href: null }} />
      <Tabs.Screen name="reminders" options={{ href: null }} />
    </Tabs>
  );
}
