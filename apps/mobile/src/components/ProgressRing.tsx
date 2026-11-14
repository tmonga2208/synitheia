import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Stop,
} from 'react-native-svg';
import Animated, {
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useReducedMotion,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { composite } from '../theme/contrast.js';
import { motion, type } from '../theme/theme.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { Text } from './primitives.js';
import { ringArc, ringTip } from './ringArc.js';

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
  /** A short line under the number saying what the percent is of. */
  caption?: string;
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
 *
 * When it closes, its tip laps over its own start and casts a soft shadow onto it, the way
 * the Fitness rings do, so a full ring reads as one that went all the way round.
 */
export function ProgressRing({
  percent,
  size = 240,
  strokeWidth = 30,
  color,
  trackColor,
  showLabel = true,
  hold = false,
  caption,
  children,
}: ProgressRingProps) {
  const t = useTheme();
  const reduceMotion = useReducedMotion();
  // Defaults resolved here, not in the destructure, so they can reach the theme.
  const strokeColor = color ?? t.accent;
  // The track is a faint wash of the ring's own colour, so ring and track read as one shape.
  const track = trackColor ?? strokeColor;
  const trackOpacity = trackColor ? 1 : 0.18;
  // Like the Fitness rings, the arc deepens towards its start and brightens towards its tip.
  // The default sage has a deeper step; a custom colour fades in from itself instead, as the
  // solid colour a 75% stroke over the track would show. Solid, because the tip is drawn a
  // second time over the ring when it closes, and a see-through colour would double up there.
  const tailColor = color
    ? composite(strokeColor, 0.75, trackColor ?? composite(strokeColor, trackOpacity, t.bg))
    : t.accentDeep;
  const gradientId = `ring-${size}-${strokeColor.replace(/[^a-zA-Z0-9]/g, '')}`;
  const clamped = Math.min(100, Math.max(0, percent));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const centre = size / 2;
  // Rotate so progress starts at 12 o'clock, nudged by half a cap so the cap starts there.
  const startDeg = -90 + ((strokeWidth / 2 / radius) * 180) / Math.PI;
  // The tip's shadow: a blurred copy of the cap, pushed a little ahead along the ring.
  const shadowAhead = strokeWidth * 0.12;
  const shadowBlur = strokeWidth * 0.3;
  const shadowRadius = strokeWidth / 2 + shadowBlur;
  const capEdge = strokeWidth / 2 / shadowRadius;
  const shadowId = `${gradientId}-shadow`;
  const bandId = `${gradientId}-band`;
  // The ring's band as a shape, so the shadow lands on the ring and never on the card.
  const outer = radius + strokeWidth / 2;
  const inner = radius - strokeWidth / 2;
  const band =
    `M ${centre - outer} ${centre} a ${outer} ${outer} 0 1 0 ${outer * 2} 0 ` +
    `a ${outer} ${outer} 0 1 0 ${-outer * 2} 0 Z ` +
    `M ${centre - inner} ${centre} a ${inner} ${inner} 0 1 0 ${inner * 2} 0 ` +
    `a ${inner} ${inner} 0 1 0 ${-inner * 2} 0 Z`;

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

  const tipReach = shadowAhead + shadowBlur;
  // The tip is redrawn over its shadow as a short stretch of ring, not a lone cap, so the
  // ring behind the tip stays clean and the shadow only falls ahead, onto the start.
  const tipLength = strokeWidth * 1.5;
  const capProps = useAnimatedProps(() => {
    const tip = ringTip(progress.value, circumference, strokeWidth, tipReach);
    return {
      strokeDashoffset: tipLength - tip.angle * radius,
      strokeOpacity: tip.shadow > 0 ? 1 : 0,
    };
  });

  const shadowProps = useAnimatedProps(() => {
    const tip = ringTip(progress.value, circumference, strokeWidth, tipReach);
    const angle = tip.angle + shadowAhead / radius;
    return {
      cx: centre + radius * Math.cos(angle),
      cy: centre + radius * Math.sin(angle),
      opacity: tip.shadow,
    };
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
          strokeOpacity={trackOpacity}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Defs>
          {/* In the ring's turned frame, (1,1) is the top right and (0,0) the bottom left. */}
          {/* In user space, not the shape's own box, so the tip's cap below picks up exactly
              the colour of the ring underneath it and only its shadow shows. */}
          <LinearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1={centre + radius}
            y1={centre + radius}
            x2={centre - radius}
            y2={centre - radius}
          >
            <Stop offset="0" stopColor={tailColor} stopOpacity={1} />
            <Stop offset="1" stopColor={strokeColor} stopOpacity={1} />
          </LinearGradient>
          <RadialGradient id={shadowId}>
            <Stop offset="0" stopColor="#000" stopOpacity={0.5} />
            <Stop offset={capEdge} stopColor="#000" stopOpacity={0.38} />
            <Stop offset="1" stopColor="#000" stopOpacity={0} />
          </RadialGradient>
          <ClipPath id={bandId}>
            <Path d={band} clipRule="evenodd" />
          </ClipPath>
        </Defs>
        <G rotation={startDeg} origin={`${centre}, ${centre}`}>
          <AnimatedCircle
            cx={centre}
            cy={centre}
            r={radius}
            stroke={`url(#${gradientId})`}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={circumference}
            strokeLinecap="round"
            animatedProps={arcProps}
          />
          <G clipPath={`url(#${bandId})`}>
            <AnimatedCircle
              r={shadowRadius}
              fill={`url(#${shadowId})`}
              animatedProps={shadowProps}
            />
          </G>
          <AnimatedCircle
            cx={centre}
            cy={centre}
            r={radius}
            stroke={`url(#${gradientId})`}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={[tipLength, circumference * 2]}
            strokeLinecap="round"
            animatedProps={capProps}
          />
        </G>
      </Svg>

      {children ??
        (showLabel ? (
          <View style={{ alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={{ ...type.display, fontSize: 52, lineHeight: 56 }}>{shown}</Text>
              {/* The % sits smaller and muted — the number is what matters. */}
              <Text color={t.textFaint} style={{ ...type.heading, marginLeft: 2 }}>
                %
              </Text>
            </View>
            {caption ? (
              <Text variant="caption" color={t.textMuted} style={{ marginTop: 2 }}>
                {caption}
              </Text>
            ) : null}
          </View>
        ) : null)}
    </View>
  );
}
