import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, HandCoins, Repeat } from 'lucide-react-native';
import { asMinor, formatMoney } from '@synitheia/shared';
import { Text, Touchable } from './primitives.js';
import { api } from '../api/client.js';
import { useAuth } from '../store/auth.js';
import { radius, spacing } from '../theme/tokens.js';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider.js';
import { accentFor, type Theme } from '../theme/theme.js';

/** OwedBanner's own accent — clay, distinct from Bills' mauve. */
const OWED_ACCENT_COLOR = '#C08A7D';

/**
 * Shown only when somebody actually owes you something.
 *
 * A permanently-present "₹0 owed" row would be a standing reminder of a feature most
 * people use occasionally — clutter in exchange for nothing. It appears when it has
 * something to say and is invisible otherwise.
 */
/** Recurring bills, reachable from where money lives. */
export function BillsRow() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const currency = useAuth((s) => s.user?.currency) ?? 'INR';

  const { data } = useQuery({
    queryKey: ['subscriptions'],
    queryFn: () =>
      api.get<{ items: unknown[]; monthlyTotalMinor: number; activeCount: number }>(
        '/subscriptions',
      ),
  });

  const accent = accentFor('#A98DA9', t);

  return (
    <Touchable
      style={[styles.banner, { borderColor: accent.base, backgroundColor: accent.wash }]}
      onPress={() => router.push('/subscriptions')}
      accessibilityRole="button"
      accessibilityLabel="Recurring bills and subscriptions"
    >
      <View style={[styles.icon, { backgroundColor: t.surface }]}>
        <Repeat size={18} color={accent.text} strokeWidth={1.8} />
      </View>

      <View style={{ flex: 1 }}>
        <Text variant="bodyMedium">Bills & subscriptions</Text>
        <Text variant="caption" color={t.textMuted}>
          {data && data.activeCount > 0
            ? `${formatMoney(asMinor(data.monthlyTotalMinor), currency)} a month · ${data.activeCount} ${data.activeCount === 1 ? 'bill' : 'bills'}`
            : 'Netflix, rent, the gym — added on their due date'}
        </Text>
      </View>

      <ChevronRight size={18} color={t.textFaint} strokeWidth={1.8} />
    </Touchable>
  );
}

export function OwedBanner() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const accent = accentFor(OWED_ACCENT_COLOR, t);
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
      <View style={[styles.icon, { backgroundColor: accent.wash }]}>
        <HandCoins size={18} color={accent.text} strokeWidth={1.8} />
      </View>

      <View style={{ flex: 1 }}>
        <Text variant="bodyMedium">
          {formatMoney(asMinor(data.totalMinor), currency)} owed to you
        </Text>
        <Text variant="caption" color={t.textMuted}>
          {people === 1 ? '1 split to settle' : `${people} splits to settle`}
        </Text>
      </View>

      <ChevronRight size={18} color={t.textFaint} strokeWidth={1.8} />
    </Touchable>
  );
}

const makeStyles = (t: Theme) => {
  const accent = accentFor(OWED_ACCENT_COLOR, t);

  return StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.base,
      marginBottom: spacing.lg,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: accent.base,
      backgroundColor: accent.wash,
    },
    icon: {
      width: 36,
      height: 36,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
};
