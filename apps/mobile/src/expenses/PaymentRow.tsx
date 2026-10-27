import { StyleSheet, View } from 'react-native';
import { Text, Touchable } from '../components/primitives.js';
import type { WireExpense } from '../api/types.js';
import { MIN_TAP_TARGET, spacing } from '../theme/theme.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { Avatar } from './Avatar.js';
import { formatAmount } from './monthView.js';

interface Props {
  expense: WireExpense;
  onPress: () => void;
}

/**
 * One payment, said once: who and how much. No arrow and no "Other" under every name; the
 * note appears only when there is one.
 */
export function PaymentRow({ expense, onPress }: Props) {
  const t = useTheme();
  const name = expense.merchant ?? expense.categoryName;
  const amount = formatAmount(expense.amountMinor, expense.currency);

  return (
    <Touchable
      style={styles.row}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${amount}. Open details.`}
    >
      <Avatar name={name} color={expense.categoryName === 'Other' ? null : expense.categoryColor} size={34} />
      <View style={styles.copy}>
        <Text variant="bodyMedium" numberOfLines={1}>
          {name}
        </Text>
        {expense.note ? (
          <Text variant="caption" color={t.textMuted} numberOfLines={1}>
            {expense.note}
          </Text>
        ) : null}
      </View>
      <Text variant="bodyMedium">{amount}</Text>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TAP_TARGET,
    paddingVertical: spacing.sm,
  },
  copy: { flex: 1, gap: 2 },
});
