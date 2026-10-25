import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Stack, useRouter, useSegments } from 'expo-router';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  useFonts,
} from '@expo-google-fonts/manrope';
import * as Notifications from 'expo-notifications';
import { migrateTokenAccessibility, probeServer, setWriteListener } from '../src/api/client.js';
import {
  checkConnectivityNow,
  holdUntilSynced,
  startConnectivity,
} from '../src/api/connectivity.js';
import { forgetLocalData, persistOptions, queryClient } from '../src/api/queryClient.js';
import { ErrorBoundary } from '../src/components/ErrorBoundary.js';
import { OfflineBanner } from '../src/components/OfflineBanner.js';
import { ToastHost } from '../src/components/ToastHost.js';
import { loadOutbox, useOutbox } from '../src/offline/outbox.js';
import { syncNow } from '../src/offline/sync.js';
import type { ReminderRoute } from '../src/reminders/plan.js';
import { routeForNotification } from '../src/reminders/route.js';
import { refreshReminders, requestReminderRefresh } from '../src/reminders/schedule.js';
import { useAuth } from '../src/store/auth.js';
// Imported for its side effect too: this is what defines the background task.
import { syncBackgroundRegistration } from '../src/sync/backgroundTask.js';
import { shouldDeferHydrate } from '../src/sync/launch.js';
import { clearSourcePrefs } from '../src/sync/sourcePrefs.js';
import { ThemeProvider, useTheme, useThemeHydrated } from '../src/theme/ThemeProvider.js';

void SplashScreen.preventAutoHideAsync();

// Any change the server accepts may change what a reminder should say (water so far, a
// habit done), so every write asks for the reminders to be re-planned.
setWriteListener(requestReminderRefresh);

// While a request cannot connect, the server is checked until it answers; queries pause
// meanwhile. On the way back, the changes made offline are sent first, and only then do
// the queries refetch (src/api/connectivity.ts, src/offline/sync.ts).
startConnectivity(probeServer, { beforeOnline: () => syncNow(queryClient) });

/**
 * Runs once the saved cache has been read back, before any query may fetch: changes still
 * waiting from last time are sent first, so the first data the screens fetch has them.
 */
async function holdIfWaiting(): Promise<void> {
  await loadOutbox();
  if (useOutbox.getState().items.length > 0) void holdUntilSynced();
}

/**
 * Routes the user to the right place once we know who they are.
 *
 * Kept as a separate component INSIDE the providers, because it needs both the auth
 * store and the router — and because doing this in the layout body would run the
 * redirect before the font/auth gates resolve, producing a visible flash of the
 * sign-in screen for an already-authenticated user.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const status = useAuth((s) => s.status);
  const user = useAuth((s) => s.user);
  const signedOutReason = useAuth((s) => s.signedOutReason);
  const hydrate = useAuth((s) => s.hydrate);
  const init = useAuth((s) => s.init);

  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    init();

    // Before hydrate: tokens stored by an older build must be re-stored where a
    // background task can read them, and hydrate is the first thing that reads them.
    const start = () => void migrateTokenAccessibility().then(() => hydrate());

    if (!shouldDeferHydrate(AppState.currentState)) {
      start();
      return;
    }

    // Launched by the OS for the background task, with nobody looking. See
    // shouldDeferHydrate: the session check waits until the app is on screen.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      subscription.remove();
      start();
    });
    return () => subscription.remove();
  }, [hydrate, init]);

  useEffect(() => {
    if (status === 'loading') return;

    const inAuthGroup = segments[0] === '(auth)';
    const inOnboarding = segments[0] === 'onboarding';
    const inSetup = segments[0] === 'setup';

    if (status === 'anon' && !inAuthGroup && !inOnboarding) {
      // Someone whose session ended goes to sign-in, which says why. The welcome screen is
      // for someone new, and landing there looked like the app had forgotten them.
      router.replace(signedOutReason === 'expired' ? '/(auth)/sign-in' : '/onboarding');
      return;
    }

    if (status !== 'authed') return;

    /**
     * An authed user who has not finished setup goes to setup FROM ANYWHERE — not only
     * from the auth screens.
     *
     * The previous version only redirected out of `(auth)`/`onboarding`, so quitting the
     * app halfway through setup and relaunching restored the last route — `(tabs)` — which
     * matched neither branch. The user landed on Today with no habits, no tracked domains
     * and no targets, and setup never ran again, because it only ever ran on the hop out
     * of sign-up.
     */
    if (!user?.onboardedAt) {
      if (!inSetup) router.replace('/setup');
      return;
    }

    if (inAuthGroup || inOnboarding || inSetup) {
      router.replace('/');
    }
  }, [status, segments, router, user?.onboardedAt, signedOutReason]);

  useEffect(() => {
    if (status === 'loading') return;

    // Signed out: the mirror must not outlive the session, or the next account on this
    // phone would inherit the last one's "connected" sources. Nor may the saved data, or
    // the changes made offline: the next account would see the one, and send the other.
    const settle =
      status === 'anon'
        ? Promise.all([clearSourcePrefs(), forgetLocalData()])
        : Promise.resolve();
    void settle.then(() => syncBackgroundRegistration());
  }, [status]);

  /**
   * Reminders are planned two weeks ahead from today's numbers, so they are re-planned
   * whenever the app is opened or comes back to the front. Writes ask too (above).
   */
  useEffect(() => {
    if (status !== 'authed') return;

    void refreshReminders();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshReminders();
    });
    return () => subscription.remove();
  }, [status]);

  // Back from the background while offline: check now rather than at the next tick.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkConnectivityNow();
    });
    return () => subscription.remove();
  }, []);

  /**
   * A tapped notification opens what it is about: a water reminder the water screen, a
   * suggestion Today. Held until the user is signed in and set up, because the tap that
   * launches the app arrives before either is known.
   */
  const [tappedRoute, setTappedRoute] = useState<ReminderRoute | null>(null);

  useEffect(() => {
    const launch = Notifications.getLastNotificationResponse();
    const initial = routeForNotification(launch?.notification.request.content.data);
    if (initial) setTappedRoute(initial);

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const route = routeForNotification(response.notification.request.content.data);
      if (route) setTappedRoute(route);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!tappedRoute || status !== 'authed' || !user?.onboardedAt) return;

    // Handled: the next launch must not open it again.
    Notifications.clearLastNotificationResponse();
    setTappedRoute(null);
    router.navigate(tappedRoute);
  }, [tappedRoute, status, user?.onboardedAt, router]);

  return <>{children}</>;
}

/**
 * The status bar and the stack, split out from `RootLayout` for one reason: both need
 * `useTheme()`, which throws outside `<ThemeProvider>`, and this component only ever
 * renders inside it (see the provider order below).
 */
function ThemedShell() {
  const t = useTheme();

  return (
    <>
      {/* Dark CONTENT (glyphs) on a light bar, light content on a dark one — the opposite
          of the theme name, which is why this isn't just `t.name`. */}
      <StatusBar style={t.name === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.bg },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen
          name="habit/new"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="food/photo"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="food/new"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen name="water" />
        <Stack.Screen name="expenses/owed" />
        <Stack.Screen name="subscriptions" />
        <Stack.Screen name="expenses/[id]" />
        <Stack.Screen name="nutrition" />
        <Stack.Screen name="targets" />
        {/* Secondary screens navigated to but never tabbed to — see (tabs)/_layout. */}
        <Stack.Screen name="habits" />
        <Stack.Screen name="reminders" />
        <Stack.Screen name="insights" />
        <Stack.Screen name="day/[date]" />
        <Stack.Screen name="history" />
      </Stack>
      <OfflineBanner />
      <ToastHost />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });

  // Called here, ahead of the render gate below, rather than only once `<ThemeProvider>`
  // mounts — the AsyncStorage read this triggers needs to start at the same time font
  // loading does, not one render later, or the gate would open on fonts alone and paint
  // one frame before a stored theme override was known. See the doc on `useThemeHydrated`.
  const themeHydrated = useThemeHydrated();

  useEffect(() => {
    // Hide the splash once EVERYTHING the first paint depends on is ready — fonts (or a
    // font error, so a 404'd font can't wedge the splash forever) AND the theme
    // preference. Hiding on fonts alone would reveal a render that might still flip
    // themes a moment later.
    if ((fontsLoaded || fontError) && themeHydrated) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError, themeHydrated]);

  if ((!fontsLoaded && !fontError) || !themeHydrated) return null;

  return (
    // The OUTER boundary — static light, no `themed` prop. Wraps <ThemeProvider> itself, so
    // it is the only thing that can catch a crash IN the provider, where useTheme() is not
    // available. See the doc on ErrorBoundary's `themed` prop before touching either
    // instance.
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          {/* Outside PersistQueryClientProvider so every consumer below — including AuthGate's
              screens — can call useTheme(). */}
          <ThemeProvider>
            {/* The INNER boundary — themed. Catches every crash below this point, which is
                nearly all of them, and shows a fallback that matches the live theme rather
                than the outer boundary's static-light one. See the doc on
                ErrorBoundary's `themed` prop for why both instances exist. */}
            <ErrorBoundary themed>
              <PersistQueryClientProvider
                client={queryClient}
                persistOptions={persistOptions}
                onSuccess={holdIfWaiting}
                onError={holdIfWaiting}
              >
                <AuthGate>
                  <ThemedShell />
                </AuthGate>
              </PersistQueryClientProvider>
            </ErrorBoundary>
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
