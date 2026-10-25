import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, HandCoins } from 'lucide-react-native';
import { asMinor, formatMoney } from '@synitheia/shared';
import {
  Card,
  EmptyState,
  ErrorState,
  Text,
  Touchable,
} from '../../src/components/primitives.js';
import { SkeletonScreen } from '../../src/components/Skeleton.js';
import { api } from '../../src/api/client.js';
import { useAuth } from '../../src/store/auth.js';
import { radius, spacing } from '../../src/theme/theme.js';
import { useTheme, useThemedStyles } from '../../src/theme/ThemeProvider.js';
import { accentFor, type Theme } from '../../src/theme/theme.js';

const OWED_KEY = ['expenses', 'owed'] as const;
const ACCENT_COLOR = '#C08A7D';

interface OwedEntry {
  expenseId: string;
  index: number;
  name: string;
  contactId: string | null;
  shareMinor: number;
  merchant: string | null;
  categoryName: string;
  localDate: string;
  amountMinor: number;
}

interface OwedResponse {
  items: OwedEntry[];
  totalMinor: number;
}

/**
 * Who owes you, and settling up.
 *
 * Marking someone as settled reduces what the original expense COST you — which means it
 * changes what that *day* cost you, retroactively. That is correct: a ₹1,000 dinner three
 * friends repaid was always a ₹250 dinner; you just did not know it yet. The daily summary
 * for that day is invalidated on settle and rebuilt, which is exactly why summaries are a
 * cache rather than a ledger.
 *
 * What settling does NOT do is touch the expense's amount. What you paid is a historical
 * fact and is never rewritten.
 */
export default function OwedScreen() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const ACCENT = accentFor(ACCENT_COLOR, t);
  const queryClient = useQueryClient();
  const currency = useAuth((s) => s.user?.currency) ?? 'INR';

  const { data, error, isPending, isRefetching, refetch } = useQuery({
    queryKey: OWED_KEY,
    queryFn: () => api.get<OwedResponse>('/expenses/owed'),
  });

  const settle = useMutation({
    meta: { failed: 'Couldn’t update who has paid' },
    mutationFn: (entry: OwedEntry) =>
      api.post<unknown>(`/expenses/${entry.expenseId}/settle`, {
        index: entry.index,
        settled: true,
      }),

    // Optimistic: the row leaves immediately. Being paid back should feel like being paid.
    onMutate: async (entry) => {
      await queryClient.cancelQueries({ queryKey: OWED_KEY });
      const previous = queryClient.getQueryData<OwedResponse>(OWED_KEY);

      if (previous) {
        const items = previous.items.filter(
          (i) => !(i.expenseId === entry.expenseId && i.index === entry.index),
        );
        queryClient.setQueryData<OwedResponse>(OWED_KEY, {
          items,
          totalMinor: items.reduce((acc, i) => acc + i.shareMinor, 0),
        });
      }

      return { previous };
    },

    onError: (_err, _entry, context) => {
      if (context?.previous) queryClient.setQueryData(OWED_KEY, context.previous);
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: OWED_KEY });
      void queryClient.invalidateQueries({ queryKey: ['today'] });
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
  });

  const back = (
    <Touchable
      onPress={() => router.back()}
      style={styles.back}
      haptic={false}
      accessibilityRole="button"
      accessibilityLabel="Go back"
    >
      <ArrowLeft size={22} color={t.textPrimary} strokeWidth={1.8} />
    </Touchable>
  );

  if (isPending) return <SkeletonScreen />;

  if (error || !data) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.content}>
          {back}
          <ErrorState
            error={error}
            message="Could not load what you are owed."
            onRetry={() => void refetch()}
          />
        </View>
      </SafeAreaView>
    );
  }

  // Group by person: you settle up with Ana, not with four separate dinners.
  const byPerson = new Map<string, OwedEntry[]>();
  for (const item of data.items) {
    const key = item.contactId ?? item.name;
    byPerson.set(key, [...(byPerson.get(key) ?? []), item]);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={ACCENT.base}
          />
        }
      >
        {back}

        <Text variant="overline" color={ACCENT.text} style={{ marginTop: spacing.base }}>
          Split expenses
        </Text>
        <Text variant="title">Owed to you</Text>

        {data.items.length === 0 ? (
          <EmptyState
            icon={<HandCoins size={26} color={t.onAccent} strokeWidth={1.6} />}
            title="Nobody owes you"
            body="When you split an expense with people, what they owe you shows up here until they pay you back."
          />
        ) : (
          <>
            <Text variant="display" style={styles.total}>
              {formatMoney(asMinor(data.totalMinor), currency)}
            </Text>

            {[...byPerson.entries()].map(([key, entries]) => {
              const personTotal = entries.reduce((acc, e) => acc + e.shareMinor, 0);

              return (
                <View key={key} style={styles.person}>
                  <View style={styles.personHeader}>
                    <Text variant="cardTitle">{entries[0]!.name}</Text>
                    <Text variant="cardTitle" color={ACCENT.text}>
                      {formatMoney(asMinor(personTotal), currency)}
                    </Text>
                  </View>

                  {entries.map((entry) => (
                    <Card
                      key={`${entry.expenseId}:${entry.index}`}
                      style={styles.entry}
                      padded={false}
                    >
                      <View style={styles.entryRow}>
                        <View style={{ flex: 1 }}>
                          <Text variant="bodyMedium" numberOfLines={1}>
                            {entry.merchant ?? entry.categoryName}
                          </Text>
                          <Text variant="caption" color={t.textMuted}>
                            {formatMoney(asMinor(entry.shareMinor), currency)} of{' '}
                            {formatMoney(asMinor(entry.amountMinor), currency)} ·{' '}
                            {entry.localDate}
                          </Text>
                        </View>

                        <Touchable
                          style={styles.settle}
                          onPress={() => settle.mutate(entry)}
                          accessibilityRole="button"
                          accessibilityLabel={`Mark ${entry.name} as paid you back for ${entry.merchant ?? entry.categoryName}`}
                        >
                          <Check size={16} color={t.onAccent} strokeWidth={2.4} />
                          <Text variant="caption" color={t.onAccent}>
                            Paid
                          </Text>
                        </Touchable>
                      </View>
                    </Card>
                  ))}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    content: { padding: spacing.lg, paddingBottom: spacing['4xl'] },
    back: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: -spacing.md,
    },
    total: { marginTop: spacing.lg, marginBottom: spacing.xl },
    person: { marginBottom: spacing.xl },
    personHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.md,
    },
    entry: { marginBottom: spacing.sm },
    entryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.base,
      paddingHorizontal: spacing.lg,
    },
    settle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      minHeight: 36,
      paddingHorizontal: spacing.base,
      borderRadius: radius.full,
      backgroundColor: t.accent,
    },
  });
