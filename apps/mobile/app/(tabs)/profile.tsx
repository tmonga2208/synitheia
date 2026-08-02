import { useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import {
  Check,
  ChevronDown,
  ChevronRight,
  HeartPulse,
  KeyRound,
  LogOut,
  Mail,
  ShieldCheck,
  SunMoon,
  Target,
  Zap,
} from 'lucide-react-native';
import { Card, Chip, Text, Touchable } from '../../src/components/primitives.js';
import { SkeletonList } from '../../src/components/Skeleton.js';
import { useAuth } from '../../src/store/auth.js';
import { MIN_TAP_TARGET, motion, radius, spacing } from '../../src/theme/theme.js';
import { useTheme, useThemedStyles, useThemePreference } from '../../src/theme/ThemeProvider.js';
import type { ThemePreference } from '../../src/theme/ThemeProvider.js';
import type { Theme } from '../../src/theme/theme.js';

/**
 * The ways into this account.
 *
 * Worth showing plainly, because the behaviour surprises people: signing in with Google
 * using an email that already has a password does NOT make a second account — it attaches
 * to the existing one. Without this list, that looks like a bug ("why is my Google sign-in
 * showing someone else's habits?") instead of the feature it is.
 *
 * Safe only because the email came from a token verified against Google's signing keys, so
 * it is an assertion by Google rather than a string the client typed. See the note in
 * auth/service.ts — linking on a client-supplied email would be an account-takeover bug.
 */
const SIGN_IN_METHODS = [
  { key: 'password', label: 'Email & password' },
  { key: 'google', label: 'Google' },
  { key: 'apple', label: 'Apple' },
] as const;

const APPEARANCE_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export default function Profile() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const user = useAuth((s) => s.user);
  const signOut = useAuth((s) => s.signOut);
  const { preference, setPreference } = useThemePreference();

  const [methodsOpen, setMethodsOpen] = useState(false);
  const chevron = useSharedValue(0);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevron.value * 180}deg` }],
  }));

  function toggleMethods() {
    setMethodsOpen((open) => {
      chevron.value = withSpring(open ? 0 : 1, motion.spring);
      return !open;
    });
  }

  function confirmSignOut() {
    Alert.alert('Sign out?', 'You will need to sign in again on this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <SkeletonList />
      </SafeAreaView>
    );
  }

  const initial = user.name.trim().charAt(0).toUpperCase() || '?';

  // The collapsed summary. Names the providers rather than counting them — "Email, Google"
  // answers the question outright, where "2 of 3 connected" only tells you to go looking.
  const connected = SIGN_IN_METHODS.filter((m) => user.authProviders.includes(m.key));
  const connectedLabel =
    connected.length > 0
      ? connected.map((m) => (m.key === 'password' ? 'Email' : m.label)).join(', ')
      : 'None connected';

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          {user.avatarUrl ? (
            <Image
              source={{ uri: user.avatarUrl }}
              style={styles.avatar}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text variant="title" color={t.onAccent}>
                {initial}
              </Text>
            </View>
          )}

          <Text variant="title" center style={styles.name}>
            {user.name}
          </Text>
          <Text variant="body" color={t.textFaint} center>
            {user.email}
          </Text>

          <View style={styles.chips}>
            <Chip
              label={user.xp > 0 ? `${user.xp} XP` : 'Start collecting XP'}
              icon={<Zap size={14} color={t.textPrimary} strokeWidth={2} />}
              accessibilityRole="text"
              haptic={false}
            />
          </View>
        </View>

        <Card padded={false} style={styles.rows}>
          <Row
            icon={<ShieldCheck size={20} color={t.accent} strokeWidth={1.6} />}
            title="Connected Context"
            subtitle="What we know, where it came from, and what the AI may read"
            onPress={() => router.push('/privacy')}
          />

          <View style={styles.divider} />

          <Row
            icon={<Target size={20} color={t.accent} strokeWidth={1.6} />}
            title="Targets"
            subtitle="Water, calories, and your monthly budget"
            onPress={() => router.push('/targets')}
          />

          <View style={styles.divider} />

          <Row
            icon={<HeartPulse size={20} color={t.accent} strokeWidth={1.6} />}
            title="Body & calories"
            subtitle="BMI, what you burn, and your calorie goal"
            onPress={() => router.push('/body')}
          />

          <View style={styles.divider} />

          {/*
            Not a Row — this one has no single destination to push to. The icon/title/
            subtitle line matches the Row idiom exactly; what follows it is the control
            itself, inset the same way "methods" sits under Sign-in methods below. The three
            options are `Chip`, not a bespoke segmented control, per the brief.
          */}
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <SunMoon size={20} color={t.accent} strokeWidth={1.6} />
            </View>

            <View style={styles.rowCopy}>
              <Text variant="cardTitle">Appearance</Text>
              <Text variant="caption" color={t.textFaint}>
                Light, dark, or match your device
              </Text>
            </View>
          </View>

          <View
            style={styles.appearance}
            accessibilityRole="radiogroup"
            accessibilityLabel="Appearance"
          >
            {APPEARANCE_OPTIONS.map((option) => {
              const selected = preference === option.value;

              return (
                <Chip
                  key={option.value}
                  label={option.label}
                  selected={selected}
                  // The selected segment must read as selected without relying on the
                  // accent-vs-grey fill alone — a checkmark glyph is the second signal.
                  icon={
                    selected ? <Check size={14} color={t.onAccent} strokeWidth={2.5} /> : undefined
                  }
                  accessibilityRole="radio"
                  accessibilityLabel={option.label}
                  haptic={false}
                  style={styles.appearanceChip}
                  onPress={() => setPreference(option.value)}
                />
              );
            })}
          </View>

          <View style={styles.divider} />

          {/*
            One bar, collapsed by default. Which providers you signed in with is a thing you
            look up once, not something worth three permanent rows in the way of Sign out.
            The summary line carries the answer for the common case, so most people never
            need to open it at all.
          */}
          <Touchable
            accessibilityRole="button"
            accessibilityState={{ expanded: methodsOpen }}
            accessibilityLabel="Sign-in methods"
            accessibilityHint={`${connectedLabel}. Tap to ${methodsOpen ? 'collapse' : 'expand'}.`}
            haptic={false}
            onPress={toggleMethods}
            style={styles.row}
          >
            <View style={styles.rowIcon}>
              <KeyRound size={20} color={t.accent} strokeWidth={1.6} />
            </View>

            <View style={styles.rowCopy}>
              <Text variant="cardTitle">Sign-in methods</Text>
              <Text variant="caption" color={t.textFaint}>
                {connectedLabel}
              </Text>
            </View>

            <Animated.View style={chevronStyle}>
              <ChevronDown size={20} color={t.textFaint} strokeWidth={1.6} />
            </Animated.View>
          </Touchable>

          {methodsOpen ? (
            <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)}>
              <View style={styles.methods}>
                {SIGN_IN_METHODS.map((method) => {
                  const connected = user.authProviders.includes(method.key);

                  return (
                    <View
                      key={method.key}
                      style={styles.method}
                      accessibilityRole="text"
                      accessibilityLabel={`${method.label}. ${connected ? 'Connected' : 'Not connected'}.`}
                    >
                      <View style={[styles.methodIcon, connected && styles.methodIconOn]}>
                        {method.key === 'password' ? (
                          <Mail
                            size={16}
                            color={connected ? t.accent : t.textFaint}
                            strokeWidth={1.7}
                          />
                        ) : (
                          <Text
                            variant="caption"
                            color={connected ? t.accent : t.textFaint}
                          >
                            {method.label.charAt(0)}
                          </Text>
                        )}
                      </View>

                      <View style={styles.rowCopy}>
                        <Text variant="bodyMedium">{method.label}</Text>
                        <Text
                          variant="caption"
                          color={connected ? t.accent : t.textFaint}
                        >
                          {connected ? user.email : 'Not connected'}
                        </Text>
                      </View>

                      {connected ? (
                        <View style={styles.tick}>
                          <Check size={12} color={t.onAccent} strokeWidth={3} />
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </Animated.View>
          ) : null}

          <View style={styles.divider} />

          <Row
            icon={<LogOut size={20} color={t.danger} strokeWidth={1.6} />}
            title="Sign out"
            titleColor={t.danger}
            onPress={confirmSignOut}
            showChevron={false}
          />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  icon,
  title,
  subtitle,
  titleColor,
  onPress,
  showChevron = true,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  titleColor?: string;
  onPress: () => void;
  showChevron?: boolean;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      haptic={false}
      onPress={onPress}
      style={styles.row}
    >
      <View style={styles.rowIcon}>{icon}</View>

      <View style={styles.rowCopy}>
        <Text variant="cardTitle" color={titleColor}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color={t.textFaint}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {showChevron ? (
        <ChevronRight size={20} color={t.textFaint} strokeWidth={1.6} />
      ) : null}
    </Touchable>
  );
}

const AVATAR = 88;

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    content: {
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.xl,
    },
    header: {
      alignItems: 'center',
      paddingTop: spacing.xl,
      marginBottom: spacing['2xl'],
    },
    avatar: {
      width: AVATAR,
      height: AVATAR,
      borderRadius: radius.full,
      backgroundColor: t.surfaceRaised,
    },
    avatarFallback: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.accent,
    },
    name: { marginTop: spacing.base },
    chips: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.base,
    },
    rows: { overflow: 'hidden' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.base,
      minHeight: MIN_TAP_TARGET + spacing.lg,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.base,
    },
    rowIcon: {
      width: 40,
      height: 40,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.surfaceRaised,
    },
    rowCopy: { flex: 1, gap: spacing.xs },
    divider: {
      height: 1,
      marginLeft: spacing.lg + 40 + spacing.base,
      backgroundColor: t.border,
    },
    // Indented to sit under the parent bar rather than beside it, so the nesting is legible
    // without a second card or another divider.
    methods: {
      paddingLeft: spacing.lg + 40 + spacing.base,
      paddingRight: spacing.lg,
      paddingBottom: spacing.lg,
      gap: spacing.base,
    },
    // Same inset as `methods` — the three segments read as detail under "Appearance"
    // rather than a sibling row of their own.
    appearance: {
      flexDirection: 'row',
      paddingLeft: spacing.lg + 40 + spacing.base,
      paddingRight: spacing.lg,
      paddingBottom: spacing.lg,
      gap: spacing.sm,
    },
    // `Chip`'s default 36pt is a label pill, not a control — these are tapped directly, so
    // they get their own floor rather than changing the shared primitive's height everywhere.
    appearanceChip: { minHeight: MIN_TAP_TARGET, flex: 1 },
    method: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    methodIcon: {
      width: 32,
      height: 32,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.surfaceRaised,
    },
    methodIconOn: { backgroundColor: t.accentWash },
    tick: {
      width: 20,
      height: 20,
      borderRadius: radius.full,
      backgroundColor: t.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
