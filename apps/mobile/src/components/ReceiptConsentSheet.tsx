import { Modal, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ImageIcon } from 'lucide-react-native';
import { Button, Text } from './primitives.js';
import { api } from '../api/client.js';
import { palette, radius, spacing } from '../theme/tokens.js';

/**
 * Asked before the first receipt image is ever stored — never after.
 *
 * The copy states what is actually true and what the user gets in return, and the
 * decline option is a real one: the app works without it, and says so. No dark patterns
 * means the "no" is as easy to press as the "yes", and choosing it costs the user nothing
 * they were promised.
 */
export function ReceiptConsentSheet({
  visible,
  onClose,
  onAllowed,
}: {
  visible: boolean;
  onClose: () => void;
  onAllowed: () => void;
}) {
  const queryClient = useQueryClient();

  const allow = useMutation({
    mutationFn: () => api.put<unknown>('/privacy/receipts', { storeReceipts: true }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      onAllowed();
    },
  });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <View style={styles.scrim}>
          <SafeAreaView style={styles.sheet} edges={['bottom']}>
            <View style={styles.handle} />

            <View style={styles.icon}>
              <ImageIcon size={24} color={palette.sage} strokeWidth={1.6} />
            </View>

            <Text variant="heading" center style={styles.title}>
              Keep a copy of receipts?
            </Text>

            <Text variant="body" color={palette.stoneMuted} center style={styles.body}>
              Receipt images will be saved to your account, so you can look one up later
              when you can&apos;t remember what a charge was.
            </Text>

            <Text variant="caption" color={palette.stoneFaint} center style={styles.body}>
              They&apos;re stored on our server, not just on this phone. You can turn this
              off at any time in Connected Context — and turning it off deletes every image
              we&apos;ve kept.
            </Text>

            <Button
              label="Keep receipts"
              loading={allow.isPending}
              onPress={() => allow.mutate()}
              style={{ marginTop: spacing.xl }}
            />

            {/*
              A real choice, not a formality. Expenses, splitting, and scanning all work
              exactly the same without it — the image simply isn't kept.
            */}
            <Button label="Not now" variant="ghost" onPress={onClose} />

            <Text variant="caption" color={palette.stoneFaint} center>
              Scanning a screenshot still works either way.
            </Text>
          </SafeAreaView>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: palette.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: palette.bone,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    alignItems: 'center',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: palette.surfaceDim,
    marginBottom: spacing.xl,
  },
  icon: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: palette.sageWash,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { marginTop: spacing.lg },
  body: { marginTop: spacing.md, maxWidth: 320 },
});
