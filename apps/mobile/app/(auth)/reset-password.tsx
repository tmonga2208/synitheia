import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, KeyRound, Lock, Mail } from 'lucide-react-native';
import { Button, Input, Text, Touchable } from '../../src/components/primitives.js';
import { api } from '../../src/api/client.js';
import { errorLine } from '../../src/api/errorCopy.js';
import { resetFormErrors } from '../../src/auth/resetForm.js';
import { useAuth } from '../../src/store/auth.js';
import { radius, spacing } from '../../src/theme/theme.js';
import { useTheme, useThemedStyles } from '../../src/theme/ThemeProvider.js';
import type { Theme } from '../../src/theme/theme.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldErrors = Partial<Record<'email' | 'code' | 'password', string>>;

/**
 * Forgot password: a code by email, then the code with a new password.
 *
 * Before this, a forgotten password lost the account. The server answers the same for every
 * address, so the second step says the code went to that address "if it has an account"
 * rather than claiming it did. Success signs straight in.
 */
export default function ResetPassword() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const resetPassword = useAuth((s) => s.resetPassword);
  const params = useLocalSearchParams<{ email?: string }>();

  const [step, setStep] = useState<'ask' | 'code'>('ask');
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function sendCode() {
    if (!EMAIL_PATTERN.test(email.trim())) {
      setFields({ email: 'Enter a valid email address' });
      return;
    }

    setFields({});
    setFormError(null);
    setPending(true);
    try {
      await api.post<unknown>('/auth/password-reset/request', { email: email.trim() });
      setCode('');
      setStep('code');
    } catch (error) {
      setFormError(errorLine(error, 'Couldn’t send the code'));
    } finally {
      setPending(false);
    }
  }

  async function setNewPassword() {
    const errors = resetFormErrors({ code, password });
    setFields(errors);
    if (Object.keys(errors).length > 0) return;

    setFormError(null);
    setPending(true);
    try {
      await resetPassword({ email, code, password });
      router.replace('/');
    } catch (error) {
      setFormError(errorLine(error, 'Couldn’t reset your password'));
    } finally {
      setPending(false);
    }
  }

  function back() {
    if (step === 'code') {
      setStep('ask');
      setFormError(null);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/(auth)/sign-in');
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Touchable
            onPress={back}
            style={styles.back}
            haptic={false}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={22} color={t.textPrimary} strokeWidth={1.8} />
          </Touchable>

          <Text variant="title">{step === 'ask' ? 'Forgot your password?' : 'Check your email'}</Text>
          <Text variant="body" color={t.textMuted} style={styles.subtitle}>
            {step === 'ask'
              ? 'We’ll email you a six-digit code. You type it here with a new password.'
              : `If ${email.trim()} has an account, a six-digit code is on its way. It works once, for 15 minutes.`}
          </Text>

          <View style={styles.fields}>
            {step === 'ask' ? (
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
            ) : (
              <>
                <Input
                  label="Code"
                  value={code}
                  onChangeText={setCode}
                  error={fields.code}
                  placeholder="123456"
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  maxLength={6}
                  leading={<KeyRound size={18} color={t.textFaint} />}
                />
                <Input
                  label="New password"
                  value={password}
                  onChangeText={setPassword}
                  error={fields.password}
                  placeholder="At least 10 characters"
                  secureTextEntry
                  autoComplete="new-password"
                  textContentType="newPassword"
                  leading={<Lock size={18} color={t.textFaint} />}
                />
              </>
            )}
          </View>

          {formError ? (
            <View style={styles.formError} accessibilityLiveRegion="polite">
              <Text variant="label" color={t.danger}>
                {formError}
              </Text>
            </View>
          ) : null}

          <Button
            label={step === 'ask' ? 'Send the code' : 'Set new password'}
            loading={pending}
            disabled={pending}
            style={styles.cta}
            onPress={() => void (step === 'ask' ? sendCode() : setNewPassword())}
          />

          {step === 'code' ? (
            <View style={styles.links}>
              <Touchable
                onPress={() => void sendCode()}
                disabled={pending}
                haptic={false}
                accessibilityRole="button"
                accessibilityLabel="Send a new code"
                style={styles.link}
              >
                <Text variant="bodyMedium" color={t.accent}>
                  Send a new code
                </Text>
              </Touchable>
              <Touchable
                onPress={back}
                haptic={false}
                accessibilityRole="button"
                accessibilityLabel="Use a different email"
                style={styles.link}
              >
                <Text variant="bodyMedium" color={t.textMuted}>
                  Use a different email
                </Text>
              </Touchable>
            </View>
          ) : null}
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
      paddingTop: spacing.base,
      paddingBottom: spacing.xl,
    },
    back: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: -spacing.sm,
      marginBottom: spacing.base,
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
    cta: { marginTop: spacing.xl },
    links: { marginTop: spacing.xl, alignItems: 'center', gap: spacing.xs },
    link: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm },
  });
