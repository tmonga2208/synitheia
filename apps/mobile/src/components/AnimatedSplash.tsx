import { useEffect, useState } from 'react';
import { Appearance, Platform, StyleSheet, useWindowDimensions } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { SPLASH_ARCS, SPLASH_BACKGROUND, arcDash } from './splashLogo.js';

const SPIN_MS = 700;
const STAGGER_MS = 70;
const EXIT_MS = 260;

/**
 * The launch logo, animated.
 *
 * The phone's own splash can only show a still image, so this draws an identical copy on
 * top of it, hides the native one underneath (nothing visibly changes), and once the app is
 * ready spins each arc a full turn, inner first, before easing out to reveal the app.
 *
 * It follows the SYSTEM light/dark setting, not the app's theme override, because that is
 * what the native splash it replaces follows. The scheme is read once, on mount: that is
 * before the theme provider exists, and the provider's override (Appearance.setColorScheme)
 * would otherwise flip the splash to the app's theme halfway through.
 */
export function AnimatedSplash({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const [scheme] = useState<'light' | 'dark'>(() =>
    Appearance.getColorScheme() === 'dark' ? 'dark' : 'light',
  );
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  // iOS draws the splash image across the full width; Android at expo-splash-screen's imageWidth.
  const size = Platform.OS === 'ios' ? width : 200;

  const spins = [useSharedValue(0), useSharedValue(0), useSharedValue(0)] as const;
  const exit = useSharedValue(0);

  useEffect(() => {
    if (!ready) return;
    const leave = () => {
      exit.value = withTiming(1, { duration: reduceMotion ? 180 : EXIT_MS }, (finished) => {
        'worklet';
        if (finished) runOnJS(onDone)();
      });
    };
    // Runs on the UI thread, so it must be a worklet: a plain function there aborts the app.
    const afterSpin = (finished?: boolean) => {
      'worklet';
      if (finished) runOnJS(leave)();
    };
    if (reduceMotion) {
      leave();
      return;
    }
    spins.forEach((spin, i) => {
      const last = i === spins.length - 1;
      spin.value = withDelay(
        i * STAGGER_MS,
        withTiming(
          1,
          { duration: SPIN_MS, easing: Easing.inOut(Easing.cubic) },
          last ? afterSpin : undefined,
        ),
      );
    });
    // Shared values are stable; the effect runs once, when the app becomes ready.
  }, [ready]);

  const containerStyle = useAnimatedStyle(() => ({ opacity: 1 - exit.value }));
  const logoStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + exit.value * 0.08 }] }));
  const spinStyles = [
    useAnimatedStyle(() => ({ transform: [{ rotate: `${spins[0].value * 360}deg` }] })),
    useAnimatedStyle(() => ({ transform: [{ rotate: `${spins[1].value * 360}deg` }] })),
    useAnimatedStyle(() => ({ transform: [{ rotate: `${spins[2].value * 360}deg` }] })),
  ];

  return (
    <Animated.View
      pointerEvents={ready ? 'none' : 'auto'}
      style={[styles.fill, { backgroundColor: SPLASH_BACKGROUND[scheme] }, containerStyle]}
      // Only once this copy is on screen does the native splash go, so the swap is invisible.
      onLayout={() => void SplashScreen.hideAsync()}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={[{ width: size, height: size }, logoStyle]}>
        {SPLASH_ARCS.map((arc, i) => {
          const dash = arcDash(arc.radius, arc.sweepDeg);
          return (
            <Animated.View key={arc.radius} style={[StyleSheet.absoluteFill, spinStyles[i]]}>
              <Svg width={size} height={size} viewBox="0 0 1024 1024">
                <Circle
                  cx={512}
                  cy={512}
                  r={arc.radius}
                  stroke={arc.color}
                  strokeWidth={arc.width}
                  strokeLinecap="round"
                  fill="none"
                  strokeDasharray={dash}
                  rotation={arc.startDeg}
                  origin="512, 512"
                />
              </Svg>
            </Animated.View>
          );
        })}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    elevation: 1000,
  },
});
