import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, HandCoins, Repeat } from 'lucide-react-native';
import { asMinor, formatMoney } from '@synitheia/shared';
import { Text, Touchable } from './primitives.js';
import { api } from '../api/client.js';
import { useAuth } from '../store/auth.js';
import { accentFor, palette, radius, spacing } from '../theme/tokens.js';

const ACCENT = accentFor('#C08A7D');

/**
 * Shown only when somebody actually owes you something.
 *
 * A permanently-present "₹0 owed" row would be a standing reminder of a feature most
 * people use occasionally — clutter in exchange for nothing. It appears when it has
 * something to say and is invisible otherwise.
 */
/** Recurring bills, reachable from where money lives. */
export function BillsRow() {
  const currency = useAuth((s) => s.user?.currency) ?? 'INR';

  const { data } = useQuery({
    queryKey: ['subscriptions'],
    queryFn: () =>
      api.get<{ items: unknown[]; monthlyTotalMinor: number; activeCount: number }>(
        '/subscriptions',
      ),
  });

  const accent = accentFor('#A98DA9');

  return (
    <Touchable
      style={[styles.banner, { borderColor: accent.base, backgroundColor: accent.wash }]}
      onPress={() => router.push('/subscriptions')}
      accessibilityRole="button"
      accessibilityLabel="Recurring bills and subscriptions"
    >
      <View style={[styles.icon, { backgroundColor: palette.bone }]}>
        <Repeat size={18} color={accent.text} strokeWidth={1.8} />
      </View>

      <View style={{ flex: 1 }}>
        <Text variant="bodyMedium">Bills & subscriptions</Text>
        <Text variant="caption" color={palette.stoneMuted}>
          {data && data.activeCount > 0
            ? `${formatMoney(asMinor(data.monthlyTotalMinor), currency)} a month · ${data.activeCount} ${data.activeCount === 1 ? 'bill' : 'bills'}`
            : 'Netflix, rent, the gym — added on their due date'}
        </Text>
      </View>

      <ChevronRight size={18} color={palette.stoneFaint} strokeWidth={1.8} />
    </Touchable>
  );
}

export function OwedBanner() {
  const currency = useAuth((s) => s.user?.currency) ?? 'INR';

  const { data } = useQuery({
    queryKey: ['expenses', 'owed'],
    queryFn: () => api.get<{ items: unknown[]; totalMinor: number }>('/expenses/owed'),
  });

  if (!data || data.totalMinor === 0) return null;

  const people = data.items.length;

  return (
    <Touchable
      style={styles.banner}
      onPress={() => router.push('/expenses/owed')}
      accessibilityRole="button"
      accessibilityLabel={`${formatMoney(asMinor(data.totalMinor), currency)} owed to you across ${people} splits. Open settle up.`}
    >
      <View style={[styles.icon, { backgroundColor: ACCENT.wash }]}>
        <HandCoins size={18} color={ACCENT.text} strokeWidth={1.8} />
      </View>

      <View style={{ flex: 1 }}>
        <Text variant="bodyMedium">
          {formatMoney(asMinor(data.totalMinor), currency)} owed to you
        </Text>
        <Text variant="caption" color={palette.stoneMuted}>
          {people === 1 ? '1 split to settle' : `${people} splits to settle`}
        </Text>
      </View>

      <ChevronRight size={18} color={palette.stoneFaint} strokeWidth={1.8} />
    </Touchable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.base,
    marginBottom: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: ACCENT.base,
    backgroundColor: ACCENT.wash,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
