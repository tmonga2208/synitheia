import { StyleSheet, View } from 'react-native';
import { Button, Card, Text } from '../components/primitives.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { spacing } from '../theme/theme.js';
import { sharedArrivalCopy } from './sharedCopy.js';
import type { SharedContent } from './sharedContent.js';

interface SharedArrivalProps {
  shared: SharedContent;
  /** An import is already running; a second tap must not start another. */
  busy: boolean;
  onRead: () => void;
  onDismiss: () => void;
}

/**
 * Something was shared into the app from another one. This shows what, and waits.
 *
 * It does not start reading on arrival. The link that carries a share is one any app or web
 * page can open, so arriving here is not proof the user asked for anything; pressing the
 * button is.
 */
export function SharedArrival({ shared, busy, onRead, onDismiss }: SharedArrivalProps) {
  const t = useTheme();
  const copy = sharedArrivalCopy(shared);

  return (
    <Card style={styles.card} accessibilityLiveRegion="polite">
      <Text variant="cardTitle">{copy.title}</Text>

      {copy.preview ? (
        <Text variant="caption" color={t.textMuted} numberOfLines={3}>
          {`“${copy.preview}”`}
        </Text>
      ) : null}

      <Text variant="body" color={t.textMuted}>
        {copy.body}
      </Text>

      <View style={styles.actions}>
        <Button
          label={copy.dismiss}
          variant="secondary"
          fullWidth={false}
          style={styles.action}
          disabled={busy}
          onPress={onDismiss}
        />
        {copy.action ? (
          <Button
            label={copy.action}
            fullWidth={false}
            style={styles.action}
            loading={busy}
            disabled={busy}
            onPress={onRead}
          />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, marginBottom: spacing.lg },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  action: { flex: 1 },
});
