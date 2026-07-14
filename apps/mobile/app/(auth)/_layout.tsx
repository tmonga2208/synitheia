import { Stack } from 'expo-router';
import { palette } from '../../src/theme/tokens.js';

/**
 * Without this file expo-router never forms the `(auth)` group — it registers the
 * screens as flat `(auth)/sign-in` routes instead, and the root layout's
 * `<Stack.Screen name="(auth)" />` then refers to a route that does not exist.
 */
export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: palette.bone },
      }}
    >
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
    </Stack>
  );
}
