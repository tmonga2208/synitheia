import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Info, Sparkles } from 'lucide-react-native';
import type { TodayResponse } from '@synitheia/shared';
import { Button, Card, Text, Touchable } from '../components/primitives.js';
import { MIN_TAP_TARGET, spacing } from '../theme/theme.js';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider.js';
import type { Theme } from '../theme/theme.js';
import { suggestionCopy } from './suggestionCopy.js';

export type Suggestion = TodayResponse['suggestions'][number];

/**
 * Something the app noticed, or thinks happened, with the two ways to answer it.
 *
 * The evidence sits behind "Why am I seeing this?", as it does on an insight. It is what
 * lets the user check a suggestion rather than only obey or ignore it, so it is always one
 * tap away; but printed under every card it mostly repeated the sentence above it.
 */
export function SuggestionCard({
  suggestion,
  onAnswer,
}: {
  suggestion: Suggestion;
  onAnswer: (action: 'confirm' | 'reject') => void;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [explained, setExplained] = useState(false);
  const copy = suggestionCopy(suggestion.proposed.kind);

  return (
    <Card style={styles.card}>
      <View style={styles.tag}>
        <Sparkles size={14} color={t.accent} strokeWidth={1.8} />
        <Text variant="caption" color={t.textMuted}>
          {copy.tag}
        </Text>
      </View>

      <Text variant="cardTitle">{suggestion.title}</Text>

      {suggestion.description ? (
        <Text variant="body" color={t.textMuted}>
          {suggestion.description}
        </Text>
      ) : null}

      {suggestion.evidence.length > 0 ? (
        <Touchable
          accessibilityRole="button"
          accessibilityLabel="Why am I seeing this?"
          accessibilityState={{ expanded: explained }}
          haptic={false}
          onPress={() => setExplained((open) => !open)}
          style={styles.whyRow}
        >
          <Info size={14} color={t.textFaint} strokeWidth={1.8} />
          <Text variant="label" color={t.textMuted}>
            Why am I seeing this?
          </Text>
        </Touchable>
      ) : null}

      {explained ? (
        <View style={styles.evidence} accessibilityLiveRegion="polite">
          {suggestion.evidence.map((item) => (
            <Text key={item.label} variant="caption" color={t.textMuted}>
              {item.label}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={copy.reject}
          variant="secondary"
          style={styles.action}
          onPress={() => onAnswer('reject')}
        />
        <Button label={copy.confirm} style={styles.action} onPress={() => onAnswer('confirm')} />
      </View>
    </Card>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    card: { gap: spacing.sm },
    tag: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    whyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      minHeight: MIN_TAP_TARGET,
    },
    evidence: {
      gap: spacing.sm,
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderTopColor: t.border,
    },
    // Two equal halves across the card. They were two wide buttons pushed to the right,
    // which left a gap on the left that looked like a third one had gone missing.
    actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
    action: { flex: 1, minHeight: 48, paddingHorizontal: spacing.base },
  });
