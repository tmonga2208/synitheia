import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Leaf } from 'lucide-react-native';
import { Button, Text, Touchable } from '../src/components/primitives.js';
import { palette, radius, spacing } from '../src/theme/tokens.js';

/**
 * The welcome screen. One screen, not a carousel.
 *
 * This used to be three slides — "Maintain Streaks", "Build Consistency", "Stay Focused" —
 * which is one promise said three times, to a person who has not yet agreed to anything.
 * Slides before sign-up are the worst place to spend attention: they collect nothing, they
 * teach nothing the app will not show on its own, and every extra tap is a chance to leave.
 *
 * So the pitch is one sentence and one button. The real onboarding — what you want to
 * track, which habits, what targets — lives in setup.tsx, AFTER sign-up, where every answer
 * is attached to an account and actually changes what the app does.
 */
export default function Onboarding() {
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Animated.View entering={FadeIn.duration(500)} style={styles.content}>
        <View style={styles.mark} accessibilityRole="image" accessibilityLabel="Synítheia">
          <Leaf size={38} color={palette.sage} strokeWidth={1.4} />
        </View>

        <Animated.View entering={FadeInDown.delay(120).duration(420)}>
          {/* No trailing full stop: at display size it overflows onto a line of its own
              and reads as a stray black square under the headline. */}
          <Text variant="display">Your day,{'\n'}understood</Text>

          <Text variant="body" color={palette.stoneMuted} style={styles.body}>
            Habits, spending, meals and water — tracked together, so Synítheia can tell you
            what they mean as a whole. It notices patterns and asks. It never assumes.
          </Text>
        </Animated.View>
      </Animated.View>

      <Animated.View entering={FadeIn.delay(320).duration(420)} style={styles.footer}>
        <Button
          label="Get started"
          trailingArrow
          onPress={() => router.replace('/(auth)/sign-up')}
        />

        <Touchable
          accessibilityRole="link"
          accessibilityLabel="Sign in to an existing account"
          haptic={false}
          onPress={() => router.replace('/(auth)/sign-in')}
          style={styles.signIn}
        >
          <Text variant="bodyMedium" color={palette.stoneMuted}>
            I already have an account
          </Text>
        </Touchable>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bone, paddingHorizontal: spacing.xl },
  content: { flex: 1, justifyContent: 'center' },
  mark: {
    width: 72,
    height: 72,
    borderRadius: radius.xl,
    backgroundColor: palette.sageWash,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing['2xl'],
  },
  body: { marginTop: spacing.lg },
  footer: { gap: spacing.md, paddingBottom: spacing.xl },
  signIn: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
