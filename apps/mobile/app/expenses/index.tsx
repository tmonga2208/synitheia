import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ArrowLeft, Plus, Wallet } from 'lucide-react-native';
import {
  addMonths,
  asMinor,
  firstOfMonth,
  formatMonthLabel,
  lastOfMonth,
  monthKeyOf,
  formatMoney,
  sumMoney,
  todayLocalDate,
  type Minor,
  type MonthKey,
} from '@synitheia/shared';
import {
  Card,
  EmptyState,
  ErrorState,
  Text,
  Touchable,
} from '../../src/components/primitives.js';
import { SkeletonList } from '../../src/components/Skeleton.js';
import { api } from '../../src/api/client.js';
import type { ListResponse, WireExpense } from '../../src/api/types.js';
import { useAuth } from '../../src/store/auth.js';
import { MIN_TAP_TARGET, radius, spacing } from '../../src/theme/theme.js';
import { useTheme, useThemedStyles } from '../../src/theme/ThemeProvider.js';
import type { Theme } from '../../src/theme/theme.js';
import { BillsRow, OwedBanner } from '../../src/components/OwedBanner.js';

function expenseQuery(month: MonthKey) {
  const from = firstOfMonth(month);
  const to = lastOfMonth(month);

  return {
    queryKey: ['expenses', month] as const,
    queryFn: () =>
      api.get<ListResponse<WireExpense>>(`/expenses?from=${from}&to=${to}&limit=200`),
  };
}

interface Day {
  localDate: string;
  totalMinor: Minor;
  items: WireExpense[];
}

/**
 * A LocalDate carries no timezone. Anchoring it at UTC midnight and formatting it in UTC
 * is the only way to render it without some zone quietly shifting it a day — the exact
 * class of bug local-date.ts exists to prevent.
 */
function formatDay(localDate: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${localDate}T00:00:00Z`));
}

/** The list arrives sorted by occurredAt desc, so insertion order preserves the day order. */
function groupByDay(items: WireExpense[]): Day[] {
  const days = new Map<string, WireExpense[]>();

  for (const expense of items) {
    const bucket = days.get(expense.localDate);
    if (bucket) bucket.push(expense);
    else days.set(expense.localDate, [expense]);
  }

  return [...days.entries()].map(([localDate, dayItems]) => ({
    localDate,
    totalMinor: sumMoney(dayItems.map((e) => asMinor(e.amountMinor))),
    items: dayItems,
  }));
}

export default function Expenses() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const user = useAuth((s) => s.user);
  const currency = user?.currency ?? 'INR';
  const timezone = user?.timezone ?? 'UTC';
  const today = todayLocalDate(timezone);
  const [month, setMonth] = useState<MonthKey>(() => monthKeyOf(today));
  const atLatest = month >= monthKeyOf(today);

  const query = useQuery(expenseQuery(month));

  const days = useMemo(() => groupByDay(query.data?.items ?? []), [query.data]);

  const header = (
    <View style={styles.header}>
      <Touchable
        style={styles.iconButton}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        haptic={false}
        onPress={() => router.back()}
      >
        <ArrowLeft size={22} color={t.textPrimary} />
      </Touchable>

      <Touchable
        accessibilityRole="button"
        accessibilityLabel="Add an expense"
        onPress={() => router.push('/expenses/new')}
        style={styles.add}
      >
        <Plus size={22} color={t.onAccent} strokeWidth={2} />
      </Touchable>
    </View>
  );

  if (query.isPending) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <SkeletonList />
      </SafeAreaView>
    );
  }

  if (query.error) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.content}>
          {header}
          <ErrorState
            message={
              query.error instanceof Error
                ? query.error.message
                : 'We could not load your expenses.'
            }
            onRetry={() => void query.refetch()}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
            tintColor={t.accent}
          />
        }
      >
        {header}

        <Text variant="overline" color={t.textFaint}>
          Your spending
        </Text>
        <Text variant="title" style={styles.heading}>
          Expenses
        </Text>

        <View style={styles.monthBar}>
          <Touchable
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            haptic={false}
            onPress={() => setMonth(addMonths(month, -1))}
            style={styles.iconButton}
          >
            <ChevronLeft size={20} color={t.textMuted} strokeWidth={1.8} />
          </Touchable>

          <Text variant="section">{formatMonthLabel(month)}</Text>

          <Touchable
            accessibilityRole="button"
            accessibilityLabel="Next month"
            accessibilityState={{ disabled: atLatest }}
            disabled={atLatest}
            haptic={false}
            onPress={() => setMonth(addMonths(month, 1))}
            style={styles.iconButton}
          >
            <ChevronRight
              size={20}
              color={atLatest ? t.textFaint : t.textMuted}
              strokeWidth={1.8}
            />
          </Touchable>
        </View>

        <OwedBanner />
        <BillsRow />

        {days.length === 0 ? (
          <View style={styles.empty}>
            <EmptyState
              icon={<Wallet size={30} color={t.onAccent} strokeWidth={1.5} />}
              title={`Nothing logged in ${formatMonthLabel(month)}`}
              body="Add an expense by hand, or share a payment screenshot and let Synítheia read it for you."
              actionLabel="+ Add an expense"
              onAction={() => router.push('/expenses/new')}
            />
          </View>
        ) : (
          days.map((day) => (
            <View key={day.localDate} style={styles.day}>
              <View style={styles.dayHeader}>
                <Text variant="label" color={t.textMuted}>
                  {formatDay(day.localDate)}
                </Text>
                <Text variant="label" color={t.textPrimary}>
                  {formatMoney(day.totalMinor, currency)}
                </Text>
              </View>

              <Card padded={false} style={styles.dayCard}>
                {day.items.map((expense, index) => (
                  <View key={expense._id}>
                    {index > 0 ? <View style={styles.divider} /> : null}

                    <Touchable
                      style={styles.expense}
                      onPress={() => router.push(`/expenses/${expense._id}`)}
                      accessibilityRole="button"
                      accessibilityLabel={`${
                        expense.merchant ?? expense.categoryName
                      }, ${formatMoney(asMinor(expense.amountMinor), expense.currency)}. Open details.`}
                    >
                      <View
                        style={[styles.dot, { backgroundColor: expense.categoryColor }]}
                      />

                      <View style={styles.expenseCopy}>
                        <Text variant="bodyMedium" numberOfLines={1}>
                          {expense.merchant ?? expense.categoryName}
                        </Text>
                        <Text variant="caption" color={t.textFaint} numberOfLines={1}>
                          {expense.note
                            ? `${expense.categoryName} · ${expense.note}`
                            : expense.categoryName}
                        </Text>
                      </View>

                      <View style={styles.expenseRight}>
                        <Text variant="bodyMedium">
                          {formatMoney(asMinor(expense.amountMinor), expense.currency)}
                        </Text>
                        <ChevronRight
                          size={16}
                          color={t.textFaint}
                          strokeWidth={1.8}
                        />
                      </View>
                    </Touchable>
                  </View>
                ))}
              </Card>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    content: {
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing['4xl'],
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm,
      marginBottom: spacing.base,
    },
    iconButton: {
      width: MIN_TAP_TARGET,
      height: MIN_TAP_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
    },
    add: {
      width: MIN_TAP_TARGET,
      height: MIN_TAP_TARGET,
      borderRadius: radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.accent,
    },
    heading: { marginTop: spacing.xs },
    monthBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.md,
    },
    empty: { marginTop: spacing.xl },
    day: { marginTop: spacing.xl },
    dayHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.sm,
    },
    dayCard: { overflow: 'hidden' },
    expense: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.base,
      minHeight: MIN_TAP_TARGET,
    },
    expenseRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    expenseCopy: { flex: 1, gap: spacing.xs },
    dot: {
      width: 10,
      height: 10,
      borderRadius: radius.full,
    },
    divider: {
      height: 1,
      marginLeft: spacing.lg,
      backgroundColor: t.border,
    },
  });
