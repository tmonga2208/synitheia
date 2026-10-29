import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import Animated, {
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useReducedMotion,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { motion, type } from '../theme/theme.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { Text } from './primitives.js';
import { ringArc } from './ringArc.js';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface ProgressRingProps {
  /** 0–100. */
  percent: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  /** The big number in the middle. Off for the small rings on tracker cards. */
  showLabel?: boolean;
  /** Stay empty until this turns false, then fill. Today holds it while the splash is up. */
  hold?: boolean;
  children?: React.ReactNode;
}

/**
 * The Daily Flow ring.
 *
 * The single most important element in the app: it is the emotional summary of the
 * user's day, and the number inside it is deliberately oversized so that everything
 * else on the screen is subordinate to it.
 *
 * It fills from empty on mount, and the number counts up with it, so the two arrive
 * together. The arc's rounded ends sit inside its true start and end (see ringArc), so it
 * begins exactly at 12 o'clock instead of bulging past it, and at 0% nothing is drawn
 * rather than a lone dot.
 */
export function ProgressRing({
  percent,
  size = 240,
  strokeWidth = 16,
  color,
  trackColor,
  showLabel = true,
  hold = false,
  children,
}: ProgressRingProps) {
  const t = useTheme();
  const reduceMotion = useReducedMotion();
  // Defaults resolved here, not in the destructure, so they can reach the theme.
  const strokeColor = color ?? t.accent;
  const track = trackColor ?? t.border;
  const clamped = Math.min(100, Math.max(0, percent));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const centre = size / 2;
  // Rotate so progress starts at 12 o'clock, nudged by half a cap so the cap starts there.
  const startDeg = -90 + ((strokeWidth / 2 / radius) * 180) / Math.PI;

  const progress = useSharedValue(0);
  const [shown, setShown] = useState(reduceMotion ? Math.round(clamped) : 0);

  useEffect(() => {
    if (hold) return;
    progress.value = withTiming(clamped / 100, {
      duration: reduceMotion ? 0 : motion.ring.duration,
      easing: Easing.out(Easing.cubic),
    });
  }, [clamped, progress, reduceMotion, hold]);

  // The label follows the arc. Only whole-number changes cross to JS, so about one per percent.
  useAnimatedReaction(
    () => Math.round(progress.value * 100),
    (now, before) => {
      if (now !== before) runOnJS(setShown)(now);
    },
  );

  const arcProps = useAnimatedProps(() => {
    const arc = ringArc(progress.value, circumference, strokeWidth);
    return { strokeDashoffset: arc.offset, strokeOpacity: arc.visible ? 1 : 0 };
  });

  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped) }}
      accessibilityLabel={`Daily flow ${Math.round(clamped)} percent`}
    >
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle
          cx={centre}
          cy={centre}
          r={radius}
          stroke={track}
          strokeOpacity={0.7}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <G rotation={startDeg} origin={`${centre}, ${centre}`}>
          <AnimatedCircle
            cx={centre}
            cy={centre}
            r={radius}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={circumference}
            strokeLinecap="round"
            animatedProps={arcProps}
          />
        </G>
      </Svg>

      {children ??
        (showLabel ? (
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Text variant="display">{shown}</Text>
            {/* The % sits smaller and muted — the number is what matters. */}
            <Text color={t.textFaint} style={{ ...type.title, marginLeft: 2 }}>
              %
            </Text>
          </View>
        ) : null)}
    </View>
  );
}
