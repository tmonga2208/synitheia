import { useEffect } from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { motion, palette, type } from '../theme/tokens.js';
import { Text } from './primitives.js';

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
  children?: React.ReactNode;
}

/**
 * The Daily Flow ring.
 *
 * The single most important element in the app: it is the emotional summary of the
 * user's day, and the number inside it is deliberately oversized so that everything
 * else on the screen is subordinate to it.
 *
 * It animates from empty on mount rather than snapping to its value — the progress
 * filling in is the moment the app tells you how you're doing, and it should feel
 * like an exhale.
 */
export function ProgressRing({
  percent,
  size = 240,
  strokeWidth = 22,
  color = palette.sage,
  trackColor = palette.surfaceDim,
  showLabel = true,
  children,
}: ProgressRingProps) {
  const clamped = Math.min(100, Math.max(0, percent));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(clamped / 100, {
      duration: motion.ring.duration,
      easing: Easing.out(Easing.cubic),
    });
  }, [clamped, progress]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - progress.value),
  }));

  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped) }}
      accessibilityLabel={`Daily flow ${Math.round(clamped)} percent`}
    >
      <Svg
        width={size}
        height={size}
        // Rotate so progress starts at 12 o'clock rather than 3 o'clock.
        style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}
      >
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          animatedProps={animatedProps}
          strokeLinecap="round"
        />
      </Svg>

      {children ??
        (showLabel ? (
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Text variant="display">{Math.round(clamped)}</Text>
            {/* The % sits smaller and muted — the number is what matters. */}
            <Text
              color={palette.stoneFaint}
              style={{ ...type.title, marginLeft: 2 }}
            >
              %
            </Text>
          </View>
        ) : null)}
    </View>
  );
}
