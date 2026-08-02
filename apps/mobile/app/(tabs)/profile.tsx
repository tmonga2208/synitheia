import { useState } from 'react';
import { Alert, Image, Modal, ScrollView, StyleSheet, View } from 'react-native';
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

const APPEARANCE_OPTIONS: { value: ThemePreference; label: string; hint: string }[] = [
  { value: 'light', label: 'Light', hint: 'Always the light theme.' },
  { value: 'dark', label: 'Dark', hint: 'Always the dark theme.' },
  {
    value: 'system',
    label: 'System',
    hint: 'Follow your phone, including its night schedule.',
  },
];

const APPEARANCE_LABEL: Record<ThemePreference, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

export default function Profile() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const user = useAuth((s) => s.user);
  const signOut = useAuth((s) => s.signOut);
  const { preference, setPreference } = useThemePreference();

  const [methodsOpen, setMethodsOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
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
            An ordinary Row, with the current choice as its subtitle. The three options
            live in a sheet rather than inline: a settings list reads as a list of
            settings, and the value belongs where every other row puts its value.
          */}
          <Row
            icon={<SunMoon size={20} color={t.accent} strokeWidth={1.6} />}
            title="Appearance"
            subtitle={APPEARANCE_LABEL[preference]}
            onPress={() => setAppearanceOpen(true)}
          />

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

      <AppearanceSheet
        visible={appearanceOpen}
        preference={preference}
        onSelect={(value) => {
          setPreference(value);
          setAppearanceOpen(false);
        }}
        onClose={() => setAppearanceOpen(false)}
      />
    </SafeAreaView>
  );
}

/**
 * Three choices, one of them checked.
 *
 * A real bottom sheet — `transparent` Modal over the scrim — matching the delete-account
 * sheet on Privacy. The checkmark is the second signal: which row is selected must not
 * depend on the accent-versus-grey text colour alone.
 */
function AppearanceSheet({
  visible,
  preference,
  onSelect,
  onClose,
}: {
  visible: boolean;
  preference: ThemePreference;
  onSelect: (value: ThemePreference) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Touchable
          style={styles.backdropDismiss}
          haptic={false}
          accessibilityRole="button"
          accessibilityLabel="Close appearance options"
          onPress={onClose}
        />

        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.handle} />

          <Text variant="heading" style={styles.sheetTitle}>
            Appearance
          </Text>

          <View style={styles.options} accessibilityRole="radiogroup">
            {APPEARANCE_OPTIONS.map((option) => {
              const selected = preference === option.value;

              return (
                <Touchable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={option.label}
                  accessibilityHint={option.hint}
                  haptic={false}
                  onPress={() => onSelect(option.value)}
                  style={styles.option}
                >
                  <View style={styles.optionCopy}>
                    <Text variant="cardTitle">{option.label}</Text>
                    <Text variant="caption" color={t.textFaint}>
                      {option.hint}
                    </Text>
                  </View>

                  {selected ? (
                    <Check size={20} color={t.accent} strokeWidth={2.5} />
                  ) : null}
                </Touchable>
              );
            })}
          </View>
        </SafeAreaView>
      </View>
    </Modal>
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
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: t.scrim,
    },
    backdropDismiss: { flex: 1 },
    // A real bottom sheet: transparent Modal, slides up over the scrim.
    sheet: {
      backgroundColor: t.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
    },
    handle: {
      alignSelf: 'center',
      width: 96,
      height: 6,
      borderRadius: radius.full,
      backgroundColor: t.border,
    },
    sheetTitle: { marginTop: spacing.lg },
    options: { paddingVertical: spacing.base },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.base,
      minHeight: MIN_TAP_TARGET,
      paddingVertical: spacing.md,
    },
    optionCopy: { flex: 1, gap: spacing.xs },
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
