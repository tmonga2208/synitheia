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
  Target,
  Zap,
} from 'lucide-react-native';
import { Card, Chip, LoadingState, Text, Touchable } from '../../src/components/primitives.js';
import { useAuth } from '../../src/store/auth.js';
import { MIN_TAP_TARGET, motion, palette, radius, spacing } from '../../src/theme/tokens.js';

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

export default function Profile() {
  const user = useAuth((s) => s.user);
  const signOut = useAuth((s) => s.signOut);

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
        <LoadingState />
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
              <Text variant="title" color={palette.white}>
                {initial}
              </Text>
            </View>
          )}

          <Text variant="title" center style={styles.name}>
            {user.name}
          </Text>
          <Text variant="body" color={palette.stoneFaint} center>
            {user.email}
          </Text>

          <View style={styles.chips}>
            <Chip
              label={user.xp > 0 ? `${user.xp} XP` : 'Start collecting XP'}
              icon={<Zap size={14} color={palette.stone} strokeWidth={2} />}
              accessibilityRole="text"
              haptic={false}
            />
          </View>
        </View>

        <Card padded={false} style={styles.rows}>
          <Row
            icon={<ShieldCheck size={20} color={palette.sage} strokeWidth={1.6} />}
            title="Connected Context"
            subtitle="What we know, where it came from, and what the AI may read"
            onPress={() => router.push('/privacy')}
          />

          <View style={styles.divider} />

          <Row
            icon={<Target size={20} color={palette.sage} strokeWidth={1.6} />}
            title="Targets"
            subtitle="Water, calories, and your monthly budget"
            onPress={() => router.push('/setup')}
          />

          <View style={styles.divider} />

          <Row
            icon={<HeartPulse size={20} color={palette.sage} strokeWidth={1.6} />}
            title="Body & calories"
            subtitle="BMI, what you burn, and your calorie goal"
            onPress={() => router.push('/body')}
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
              <KeyRound size={20} color={palette.sage} strokeWidth={1.6} />
            </View>

            <View style={styles.rowCopy}>
              <Text variant="cardTitle">Sign-in methods</Text>
              <Text variant="caption" color={palette.stoneFaint}>
                {connectedLabel}
              </Text>
            </View>

            <Animated.View style={chevronStyle}>
              <ChevronDown size={20} color={palette.stoneFaint} strokeWidth={1.6} />
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
                            color={connected ? palette.sage : palette.stoneFaint}
                            strokeWidth={1.7}
                          />
                        ) : (
                          <Text
                            variant="caption"
                            color={connected ? palette.sage : palette.stoneFaint}
                          >
                            {method.label.charAt(0)}
                          </Text>
                        )}
                      </View>

                      <View style={styles.rowCopy}>
                        <Text variant="bodyMedium">{method.label}</Text>
                        <Text
                          variant="caption"
                          color={connected ? palette.sage : palette.stoneFaint}
                        >
                          {connected ? user.email : 'Not connected'}
                        </Text>
                      </View>

                      {connected ? (
                        <View style={styles.tick}>
                          <Check size={12} color={palette.white} strokeWidth={3} />
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
            icon={<LogOut size={20} color={palette.danger} strokeWidth={1.6} />}
            title="Sign out"
            titleColor={palette.danger}
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
          <Text variant="caption" color={palette.stoneFaint}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {showChevron ? (
        <ChevronRight size={20} color={palette.stoneFaint} strokeWidth={1.6} />
      ) : null}
    </Touchable>
  );
}

const AVATAR = 88;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bone },
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
    backgroundColor: palette.sand,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.sage,
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
    backgroundColor: palette.sand,
  },
  rowCopy: { flex: 1, gap: spacing.xs },
  divider: {
    height: 1,
    marginLeft: spacing.lg + 40 + spacing.base,
    backgroundColor: palette.surfaceDim,
  },
  // Indented to sit under the parent bar rather than beside it, so the nesting is legible
  // without a second card or another divider.
  methods: {
    paddingLeft: spacing.lg + 40 + spacing.base,
    paddingRight: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.base,
  },
  method: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  methodIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.sand,
  },
  methodIconOn: { backgroundColor: palette.sageWash },
  tick: {
    width: 20,
    height: 20,
    borderRadius: radius.full,
    backgroundColor: palette.sage,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
