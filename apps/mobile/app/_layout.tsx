import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Stack, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
import { ErrorBoundary } from '../src/components/ErrorBoundary.js';
import { useAuth } from '../src/store/auth.js';
import { palette } from '../src/theme/tokens.js';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Personal tracking data changes slowly and mostly from this device. A minute of
      // staleness avoids a refetch storm on every tab switch without ever showing the
      // user a number they'd call wrong.
      staleTime: 60_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

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
  const hydrate = useAuth((s) => s.hydrate);
  const init = useAuth((s) => s.init);

  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    init();
    void hydrate();
  }, [hydrate, init]);

  useEffect(() => {
    if (status === 'loading') return;

    const inAuthGroup = segments[0] === '(auth)';
    const inOnboarding = segments[0] === 'onboarding';
    const inSetup = segments[0] === 'setup';

    if (status === 'anon' && !inAuthGroup && !inOnboarding) {
      router.replace('/onboarding');
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
  }, [status, segments, router, user?.onboardedAt]);

  return <>{children}</>;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });

  useEffect(() => {
    // Hide the splash on font error too — shipping a permanently-stuck splash screen
    // because a font 404'd is worse than shipping a fallback font.
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <AuthGate>
              <StatusBar style="dark" />
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: palette.bone },
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
              </Stack>
            </AuthGate>
          </QueryClientProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
