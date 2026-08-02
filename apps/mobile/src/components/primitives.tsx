import { forwardRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text as RNText,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
  type StyleProp,
  type TextProps as RNTextProps,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { MIN_TAP_TARGET, motion, radius, spacing, type } from '../theme/tokens.js';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider.js';
import type { Theme } from '../theme/theme.js';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// ─── Text ───────────────────────────────────────────────────────────────────

type Variant = keyof typeof type;

interface TextProps extends RNTextProps {
  variant?: Variant;
  color?: string;
  center?: boolean;
}

/**
 * The only text component. Screens never reach for RNText directly, which is what
 * keeps the type scale from quietly growing a fourteenth size.
 */
export function Text({ variant = 'body', color, center, style, ...rest }: TextProps) {
  const t = useTheme();

  return (
    <RNText
      style={[
        type[variant],
        { color: color ?? t.textPrimary },
        center && { textAlign: 'center' },
        style,
      ]}
      {...rest}
    />
  );
}

// ─── Card ───────────────────────────────────────────────────────────────────

interface CardProps extends ViewProps {
  padded?: boolean;
  /** Cards in the reference carry BOTH a hairline border and a soft shadow. */
  elevated?: boolean;
  accent?: string;
}

export function Card({ padded = true, elevated = true, accent, style, children, ...rest }: CardProps) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <View
      style={[
        styles.card,
        padded && { padding: spacing.lg },
        elevated && t.shadow.card,
        accent ? { borderColor: accent } : null,
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

// ─── Pressable with gentle feedback ─────────────────────────────────────────

interface TouchableProps extends Omit<PressableProps, 'style'> {
  // StyleProp, not ViewStyle[] — callers legitimately pass `cond && style`, which is
  // `false` when the condition fails, and RN handles that fine.
  style?: StyleProp<ViewStyle>;
  /** Off for destructive or high-frequency actions where a buzz becomes noise. */
  haptic?: boolean;
}

/**
 * Every tappable surface scales down slightly and springs back. design.md calls for
 * "gentle feedback" and "subtle scale changes" — this is the one place that is
 * implemented, so the whole app moves the same way.
 *
 * forwardRef, because expo-router's `<Link asChild>` clones its child and hands it a ref.
 * A plain function component cannot receive one: React warns "Function components cannot
 * be given refs", and the ref is silently dropped — which is what the sign-in / sign-up
 * footers were doing.
 */
export const Touchable = forwardRef<View, TouchableProps>(function Touchable(
  { style, haptic = true, onPressIn, onPress, disabled, children, ...rest },
  ref,
) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      ref={ref}
      style={[style, animatedStyle, disabled && { opacity: 0.45 }]}
      disabled={disabled}
      onPressIn={(e) => {
        scale.value = withTiming(motion.press.scale, { duration: motion.press.duration });
        onPressIn?.(e);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, motion.spring);
      }}
      onPress={(e) => {
        if (haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.(e);
      }}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
});

// ─── Button ─────────────────────────────────────────────────────────────────

interface ButtonProps extends Omit<TouchableProps, 'children'> {
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
  /** The reference CTAs read "Keep Growing →". */
  trailingArrow?: boolean;
  fullWidth?: boolean;
}

export function Button({
  label,
  variant = 'primary',
  loading,
  trailingArrow,
  fullWidth = true,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const isPrimary = variant === 'primary';
  const isGhost = variant === 'ghost';

  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      style={[
        styles.button,
        fullWidth && { alignSelf: 'stretch' },
        isPrimary && { backgroundColor: t.accent, ...t.shadow.button },
        variant === 'secondary' && {
          backgroundColor: t.surfaceRaised,
          borderWidth: 1,
          borderColor: t.border,
        },
        isGhost && { backgroundColor: 'transparent' },
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? t.onAccent : t.textPrimary} />
      ) : (
        <Text
          variant="cardTitle"
          color={isPrimary ? t.onAccent : t.textPrimary}
          style={{ textAlign: 'center' }}
        >
          {label}
          {trailingArrow ? '  →' : ''}
        </Text>
      )}
    </Touchable>
  );
}

// ─── Chip ───────────────────────────────────────────────────────────────────

interface ChipProps extends Omit<TouchableProps, 'children'> {
  label: string;
  icon?: React.ReactNode;
  selected?: boolean;
  accent?: string;
}

/** The outlined pills under the ring — "12 Day Streak", "512 XP". */
export function Chip({ label, icon, selected, accent, style, ...rest }: ChipProps) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const color = accent ?? t.textPrimary;

  return (
    <Touchable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        styles.chip,
        selected && { backgroundColor: t.accent, borderColor: t.accent },
        !selected && accent ? { borderColor: accent } : null,
        style,
      ]}
      {...rest}
    >
      {icon}
      <Text
        variant="caption"
        color={selected ? t.onAccent : color}
        style={icon ? { marginLeft: spacing.xs } : undefined}
      >
        {label}
      </Text>
    </Touchable>
  );
}

// ─── Input ──────────────────────────────────────────────────────────────────

interface InputProps extends TextInputProps {
  label?: string;
  error?: string | null;
  leading?: React.ReactNode;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, error, leading, style, ...rest },
  ref,
) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={{ gap: spacing.sm }}>
      {label ? (
        <Text variant="label" color={t.textMuted}>
          {label}
        </Text>
      ) : null}

      <View style={[styles.inputWrap, error ? { borderColor: t.danger } : null]}>
        {leading}
        <TextInput
          ref={ref}
          style={[styles.input, leading ? { marginLeft: spacing.md } : null, style]}
          placeholderTextColor={t.textFaint}
          // The design's inputs are large, soft-filled containers; the cursor should
          // match the accent rather than the OS default blue.
          selectionColor={t.accent}
          accessibilityLabel={label}
          {...rest}
        />
      </View>

      {error ? (
        <Text variant="caption" color={t.danger}>
          {error}
        </Text>
      ) : null}
    </View>
  );
});

// ─── Section header ─────────────────────────────────────────────────────────

export function SectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.sectionHeader}>
      <Text variant="section">{title}</Text>
      {action ? (
        <Touchable onPress={onAction} haptic={false} accessibilityRole="button">
          <Text variant="label" color={t.textMuted}>
            {action}
          </Text>
        </Touchable>
      ) : null}
    </View>
  );
}

// ─── States ─────────────────────────────────────────────────────────────────

/**
 * Empty, loading, and error states are first-class components, not afterthoughts.
 * The reference dedicates an entire card to "No Rituals Yet" — an empty state is a
 * screen the user WILL see on day one, and it is the app's first impression.
 */
export function EmptyState({
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon?: React.ReactNode;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <Card style={{ alignItems: 'center', paddingVertical: spacing['2xl'] }}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}

      <Text variant="cardTitle" center style={{ marginTop: spacing.lg }}>
        {title}
      </Text>
      <Text
        variant="body"
        color={t.textMuted}
        center
        style={{ marginTop: spacing.sm, maxWidth: 280 }}
      >
        {body}
      </Text>

      {actionLabel && onAction ? (
        <Button
          label={actionLabel}
          variant="secondary"
          onPress={onAction}
          style={{ marginTop: spacing.xl }}
        />
      ) : null}
    </Card>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useTheme();

  return (
    <Card style={{ alignItems: 'center', paddingVertical: spacing['2xl'] }}>
      <Text variant="cardTitle" center>
        Something went wrong
      </Text>
      <Text
        variant="body"
        color={t.textMuted}
        center
        style={{ marginTop: spacing.sm, maxWidth: 280 }}
      >
        {message}
      </Text>
      {onRetry ? (
        <Button
          label="Try again"
          variant="secondary"
          onPress={onRetry}
          style={{ marginTop: spacing.xl }}
        />
      ) : null}
    </Card>
  );
}

export function LoadingState({ label }: { label?: string }) {
  const t = useTheme();

  return (
    <View style={{ paddingVertical: spacing['3xl'], alignItems: 'center', gap: spacing.md }}>
      <ActivityIndicator color={t.accent} />
      {label ? (
        <Text variant="caption" color={t.textMuted}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    card: {
      backgroundColor: t.surface,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: t.border,
    },
    button: {
      minHeight: 56,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.xl,
    },
    chip: {
      minHeight: 36,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.base,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface,
    },
    inputWrap: {
      minHeight: MIN_TAP_TARGET + 8,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.surfaceRaised,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: 'transparent',
      paddingHorizontal: spacing.base,
    },
    input: {
      flex: 1,
      ...type.body,
      color: t.textPrimary,
      paddingVertical: spacing.md,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.base,
    },
    emptyIcon: {
      width: 72,
      height: 72,
      borderRadius: radius.full,
      backgroundColor: t.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
