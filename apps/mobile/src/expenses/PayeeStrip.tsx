import { ScrollView, StyleSheet, View } from 'react-native';
import { asMinor, formatMoneyCompact, SYSTEM_CATEGORIES } from '@synitheia/shared';
import { Text } from '../components/primitives.js';
import { spacing } from '../theme/theme.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { Avatar } from './Avatar.js';
import type { WireExpenseTotals } from './monthTotal.js';
import { formatAmount } from './monthView.js';

const CATEGORY_COLOR = new Map<string, string>(SYSTEM_CATEGORIES.map((c) => [c.name, c.color]));

interface Props {
  payees: WireExpenseTotals['topPayees'];
  currency: string;
}

/** "Mostly to": who the month's money went to, biggest first, as faces rather than rows. */
export function PayeeStrip({ payees, currency }: Props) {
  const t = useTheme();

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {payees.map((p) => (
        <View
          key={p.name}
          style={styles.payee}
          accessible
          accessibilityLabel={`${p.name}, ${formatAmount(p.totalMinor, currency)} across ${p.count} ${p.count === 1 ? 'payment' : 'payments'}`}
        >
          <Avatar
            name={p.name}
            color={p.categoryName === 'Other' ? null : (CATEGORY_COLOR.get(p.categoryName) ?? null)}
            size={44}
          />
          <Text variant="caption" color={t.textMuted} numberOfLines={1}>
            {p.name.split(' ')[0]}
          </Text>
          <Text variant="label">{formatMoneyCompact(asMinor(p.totalMinor), currency)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { gap: spacing.base, paddingRight: spacing.base },
  payee: { alignItems: 'center', gap: spacing.xs, width: 56 },
});
