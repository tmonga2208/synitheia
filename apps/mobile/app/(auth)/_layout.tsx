import { Stack } from 'expo-router';
import { useTheme } from '../../src/theme/ThemeProvider.js';

/**
 * Without this file expo-router never forms the `(auth)` group — it registers the
 * screens as flat `(auth)/sign-in` routes instead, and the root layout's
 * `<Stack.Screen name="(auth)" />` then refers to a route that does not exist.
 */
export default function AuthLayout() {
  const t = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.bg },
      }}
    >
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
    </Stack>
  );
}
