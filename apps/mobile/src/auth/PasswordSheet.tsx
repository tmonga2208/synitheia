import { useState } from 'react';
import { KeyboardAvoidingView, Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Input, Text, Touchable } from '../components/primitives.js';
import { errorLine } from '../api/errorCopy.js';
import { showToast } from '../feedback/toast.js';
import { useAuth } from '../store/auth.js';
import { radius, spacing } from '../theme/theme.js';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider.js';
import type { Theme } from '../theme/theme.js';

const MIN_LENGTH = 10;

/**
 * Add a password to the signed-in account, or change it.
 *
 * An account made with Google has no password, so signing in with email failed and
 * signing up said the email was taken. Adding one here makes email a second way into the
 * same account. Changing an existing password asks for the current one, as the server does.
 */
export function PasswordSheet({
  visible,
  hasPassword,
  email,
  onClose,
}: {
  visible: boolean;
  hasPassword: boolean;
  email: string;
  onClose: () => void;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const setPassword = useAuth((s) => s.setPassword);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const close = () => {
    setCurrent('');
    setNext('');
    setError(null);
    onClose();
  };

  const save = async () => {
    if (next.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setPassword({
        newPassword: next,
        ...(hasPassword ? { currentPassword: current } : {}),
      });
      showToast({
        message: hasPassword ? 'Password changed' : `You can now sign in with ${email}`,
      });
      close();
    } catch (err) {
      setError(
        errorLine(err, hasPassword ? 'Couldn’t change your password' : 'Couldn’t add a password'),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={styles.backdrop} behavior="padding">
        <Touchable
          style={styles.flex}
          haptic={false}
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={close}
        />
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.handle} />
          <Text variant="heading">{hasPassword ? 'Change password' : 'Add a password'}</Text>
          <Text variant="body" color={t.textMuted}>
            {hasPassword
              ? 'Enter your current password, then the new one.'
              : `Then you can sign in with ${email} and this password, as well as the way you do now.`}
          </Text>

          {hasPassword ? (
            <Input
              label="Current password"
              value={current}
              onChangeText={setCurrent}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
            />
          ) : null}
          <Input
            label={hasPassword ? 'New password' : 'Password'}
            value={next}
            onChangeText={setNext}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            placeholder={`At least ${MIN_LENGTH} characters`}
            error={error}
          />

          <Button
            label={hasPassword ? 'Change password' : 'Add password'}
            loading={saving}
            onPress={() => void save()}
          />
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: t.scrim },
    sheet: {
      backgroundColor: t.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      paddingBottom: spacing.xl,
      gap: spacing.base,
    },
    handle: {
      alignSelf: 'center',
      width: 48,
      height: 5,
      borderRadius: radius.full,
      backgroundColor: t.border,
    },
  });
