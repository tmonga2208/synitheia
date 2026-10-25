import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link, router } from 'expo-router';
import { Lock, Mail } from 'lucide-react-native';
import { Button, Input, Text, Touchable } from '../../src/components/primitives.js';
import { errorLine } from '../../src/api/errorCopy.js';
import { useAuth } from '../../src/store/auth.js';
import { radius, spacing } from '../../src/theme/theme.js';
import { useTheme, useThemedStyles } from '../../src/theme/ThemeProvider.js';
import type { Theme } from '../../src/theme/theme.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldErrors = Partial<Record<'email' | 'password', string>>;

export default function SignIn() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const signIn = useAuth((s) => s.signIn);
  const signInWithApple = useAuth((s) => s.signInWithApple);
  const signInWithGoogle = useAuth((s) => s.signInWithGoogle);
  const expired = useAuth((s) => s.signedOutReason === 'expired');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState<'email' | 'apple' | 'google' | null>(null);

  function validate(): boolean {
    const next: FieldErrors = {};
    if (!EMAIL_PATTERN.test(email.trim())) next.email = 'Enter a valid email address';
    if (password.length === 0) next.password = 'Enter your password';

    setFields(next);
    return Object.keys(next).length === 0;
  }

  async function run(kind: 'email' | 'apple' | 'google', action: () => Promise<void>) {
    setFormError(null);
    setPending(kind);

    try {
      await action();
      router.replace('/');
    } catch (error) {
      setFormError(errorLine(error, 'Couldn’t sign in'));
    } finally {
      setPending(null);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {expired ? (
            <View style={styles.notice} accessibilityLiveRegion="polite">
              <Text variant="bodyMedium">You were signed out</Text>
              <Text variant="caption" color={t.textMuted}>
                Sign in again to pick up where you left off. Nothing you logged is lost.
              </Text>
            </View>
          ) : null}

          <Text variant="title">Welcome back</Text>
          <Text variant="body" color={t.textMuted} style={styles.subtitle}>
            Pick your habits back up where you left them.
          </Text>

          <View style={styles.fields}>
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              error={fields.email}
              placeholder="you@example.com"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              leading={<Mail size={18} color={t.textFaint} />}
            />

            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              error={fields.password}
              placeholder="Your password"
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              leading={<Lock size={18} color={t.textFaint} />}
            />
          </View>

          {formError ? (
            <View style={styles.formError} accessibilityLiveRegion="polite">
              <Text variant="label" color={t.danger}>
                {formError}
              </Text>
            </View>
          ) : null}

          <Button
            label="Sign in"
            loading={pending === 'email'}
            disabled={pending !== null}
            style={styles.cta}
            onPress={() => {
              if (validate()) void run('email', () => signIn(email, password));
            }}
          />

          <View style={styles.divider}>
            <View style={styles.rule} />
            <Text variant="caption" color={t.textFaint}>
              or
            </Text>
            <View style={styles.rule} />
          </View>

          <View style={styles.socials}>
            {/* App Store guideline 4.8: if any third-party sign-in is offered on iOS,
                Sign in with Apple must be offered alongside it. */}
            {Platform.OS === 'ios' ? (
              <Button
                label="Continue with Apple"
                variant="secondary"
                loading={pending === 'apple'}
                disabled={pending !== null}
                onPress={() => void run('apple', signInWithApple)}
              />
            ) : null}

            <Button
              label="Continue with Google"
              variant="secondary"
              loading={pending === 'google'}
              disabled={pending !== null}
              onPress={() => void run('google', signInWithGoogle)}
            />
          </View>

          <View style={styles.switchRow}>
            <Text variant="body" color={t.textMuted}>
              New here?
            </Text>
            <Link href="/(auth)/sign-up" replace asChild>
              <Touchable
                accessibilityRole="link"
                accessibilityLabel="Create an account"
                haptic={false}
                style={styles.switchLink}
              >
                <Text variant="bodyMedium" color={t.accent}>
                  Create an account
                </Text>
              </Touchable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    flex: { flex: 1 },
    content: {
      flexGrow: 1,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing['2xl'],
      paddingBottom: spacing.xl,
    },
    subtitle: { marginTop: spacing.sm },
    fields: { marginTop: spacing['2xl'], gap: spacing.base },
    formError: {
      marginTop: spacing.base,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: t.surfaceRaised,
      borderWidth: 1,
      borderColor: t.danger,
    },
    notice: {
      gap: spacing.xs,
      marginBottom: spacing.xl,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: t.surfaceRaised,
      borderWidth: 1,
      borderColor: t.border,
    },
    cta: { marginTop: spacing.xl },
    divider: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      marginVertical: spacing.xl,
    },
    rule: { flex: 1, height: 1, backgroundColor: t.border },
    socials: { gap: spacing.md },
    switchRow: {
      marginTop: spacing['2xl'],
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
    },
    switchLink: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: spacing.xs,
    },
  });
