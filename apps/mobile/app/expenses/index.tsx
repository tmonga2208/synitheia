import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronLeft, ChevronRight, Plus, Wallet } from 'lucide-react-native';
import {
  addMonths,
  firstOfMonth,
  formatMonthLabel,
  lastOfMonth,
  monthKeyOf,
  todayLocalDate,
  type LocalDate,
  type MonthKey,
} from '@synitheia/shared';
import { Button, EmptyState, ErrorState, Text, Touchable } from '../../src/components/primitives.js';
import { SkeletonList } from '../../src/components/Skeleton.js';
import { CountUp } from '../../src/components/CountUp.js';
import { BillsRow, OwedBanner } from '../../src/components/OwedBanner.js';
import { api } from '../../src/api/client.js';
import type { ListResponse, WireExpense } from '../../src/api/types.js';
import { goBackOrHome } from '../../src/navigation/goBackOrHome.js';
import { useAuth } from '../../src/store/auth.js';
import { MonthCalendar } from '../../src/expenses/MonthCalendar.js';
import { PayeeStrip } from '../../src/expenses/PayeeStrip.js';
import { PaymentRow } from '../../src/expenses/PaymentRow.js';
import type { WireExpenseTotals } from '../../src/expenses/monthTotal.js';
import {
  calendarCells,
  comparisonLine,
  formatAmount,
  formatWhole,
  loadMoreLabel,
  normalizeTotals,
  previousComparable,
} from '../../src/expenses/monthView.js';
import { MIN_TAP_TARGET, radius, spacing } from '../../src/theme/theme.js';
import type { Theme } from '../../src/theme/theme.js';
import { useTheme, useThemedStyles } from '../../src/theme/ThemeProvider.js';

/** Payments per page. The month's total, calendar and payees come from totals, not the list. */
const PAGE_SIZE = 10;
/** "Mostly to" and the first payments rise in once the calendar's wave has mostly passed. */
const AFTER_CALENDAR_MS = 450;
const ROW_STAGGER_MS = 70;
const EASED_ROWS = 8;
const HIGHLIGHT_MS = 1400;

function expensePagesQuery(month: MonthKey) {
  return {
    // Not ['expenses', month]: that key held a single list, and a cache saved by an
    // older build must not be read as pages.
    queryKey: ['expenses', 'pages', month] as const,
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      api.get<ListResponse<WireExpense>>(
        `/expenses?from=${firstOfMonth(month)}&to=${lastOfMonth(month)}&limit=${PAGE_SIZE}` +
          (pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last: ListResponse<WireExpense>) => last.nextCursor ?? null,
  };
}

function monthTotalQuery(month: MonthKey) {
  return {
    queryKey: ['expenses', 'totals', month] as const,
    queryFn: () =>
      api.get<WireExpenseTotals>(
        `/expenses/totals?from=${firstOfMonth(month)}&to=${lastOfMonth(month)}`,
      ),
  };
}

interface Day {
  localDate: LocalDate;
  /** What the rows under it add up to, so the header always matches what is shown. */
  totalMinor: number;
  items: WireExpense[];
}

/** "Sat 19". The date is anchored at UTC so no zone can shift it a day. */
function dayLabel(localDate: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${localDate}T00:00:00Z`),
  );
}

/** The list arrives newest first, so insertion order keeps the days in order. */
function groupByDay(items: WireExpense[]): Day[] {
  const days = new Map<string, WireExpense[]>();
  for (const expense of items) {
    const bucket = days.get(expense.localDate);
    if (bucket) bucket.push(expense);
    else days.set(expense.localDate, [expense]);
  }
  return [...days.entries()].map(([localDate, dayItems]) => ({
    localDate: localDate as LocalDate,
    totalMinor: dayItems.reduce((sum, e) => sum + e.amountMinor, 0),
    items: dayItems,
  }));
}

/**
 * Expenses opens on the month rather than on every payment: its total settling into place,
 * the month as a calendar, who the money mostly went to, and only then each payment.
 */
export default function Expenses() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const user = useAuth((s) => s.user);
  const currency = user?.currency ?? 'INR';
  const today = todayLocalDate(user?.timezone ?? 'UTC');
  const currentMonth = monthKeyOf(today);
  const [month, setMonth] = useState<MonthKey>(currentMonth);
  const previous = addMonths(month, -1);
  const atLatest = month >= currentMonth;

  const query = useInfiniteQuery(expensePagesQuery(month));
  const totalsQuery = useQuery(monthTotalQuery(month));
  const previousQuery = useQuery(monthTotalQuery(previous));
  const totals = totalsQuery.data ? normalizeTotals(totalsQuery.data) : null;

  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const days = useMemo(() => groupByDay(items), [items]);
  const cells = useMemo(() => calendarCells(month, totals?.byDay ?? {}, today), [month, totals, today]);

  const comparison = useMemo(() => {
    if (!totals || totals.count === 0 || !previousQuery.data) return null;
    const prev = previousComparable({
      previousByDay: normalizeTotals(previousQuery.data).byDay,
      previousMonth: previous,
      ongoingDay: month === currentMonth ? Number(today.slice(8, 10)) : null,
    });
    return comparisonLine({ thisMinor: totals.totalMinor, previousMinor: prev.minor, previousLabel: prev.label });
  }, [totals, previousQuery.data, previous, month, currentMonth, today]);

  // Where each day's payments start, so tapping a day can bring them into view.
  const scrollRef = useRef<ScrollView>(null);
  const bodyY = useRef(0);
  const listY = useRef(0);
  const dayY = useRef(new Map<string, number>());
  const [selected, setSelected] = useState<LocalDate | null>(null);
  const [highlighted, setHighlighted] = useState<LocalDate | null>(null);
  /** A day tapped on the calendar whose payments are on a page not loaded yet. */
  const [pendingDay, setPendingDay] = useState<LocalDate | null>(null);

  useEffect(() => {
    if (!highlighted) return;
    const id = setTimeout(() => setHighlighted(null), HIGHLIGHT_MS);
    return () => clearTimeout(id);
  }, [highlighted]);

  // Keep loading until the tapped day arrives; its row then scrolls itself into view.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    if (!pendingDay || isFetchingNextPage) return;
    if (days.some((d) => d.localDate === pendingDay)) return;
    if (hasNextPage) void fetchNextPage();
    else setPendingDay(null);
  }, [pendingDay, days, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const scrollToDay = (date: LocalDate, y: number) => {
    scrollRef.current?.scrollTo({ y: bodyY.current + listY.current + y - spacing.sm, animated: true });
    setHighlighted(date);
  };

  const changeMonth = (delta: number) => {
    setSelected(null);
    setHighlighted(null);
    setPendingDay(null);
    dayY.current.clear();
    setMonth(addMonths(month, delta));
  };

  const goToDay = (date: LocalDate) => {
    setSelected(date);
    const y = dayY.current.get(date);
    if (y === undefined) setPendingDay(date);
    else scrollToDay(date, y);
  };

  const header = (
    <View style={styles.header}>
      <Touchable
        style={styles.iconButton}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        haptic={false}
        onPress={() => goBackOrHome(router)}
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
            error={query.error}
            message="We could not load your expenses."
            onRetry={() => void query.refetch()}
          />
        </View>
      </SafeAreaView>
    );
  }

  const empty = days.length === 0;
  const listed = items.length;
  let row = 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => {
              void query.refetch();
              void totalsQuery.refetch();
              void previousQuery.refetch();
            }}
            tintColor={t.accent}
          />
        }
      >
        {header}

        <View style={styles.monthBar}>
          <Touchable
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            haptic={false}
            onPress={() => changeMonth(-1)}
            style={styles.iconButton}
          >
            <ChevronLeft size={20} color={t.textMuted} strokeWidth={1.8} />
          </Touchable>

          <Text variant="bodyMedium">{formatMonthLabel(month)}</Text>

          <Touchable
            accessibilityRole="button"
            accessibilityLabel="Next month"
            accessibilityState={{ disabled: atLatest }}
            disabled={atLatest}
            haptic={false}
            onPress={() => changeMonth(1)}
            style={styles.iconButton}
          >
            <ChevronRight size={20} color={atLatest ? t.textFaint : t.textMuted} strokeWidth={1.8} />
          </Touchable>
        </View>

        {/* Keyed by month: everything below eases in again only when the month changes. */}
        <View key={month} onLayout={(e) => (bodyY.current = e.nativeEvent.layout.y)}>
          <View style={styles.hero}>
            {totals ? (
              <CountUp
                to={totals.totalMinor}
                format={(n) => formatWhole(n, currency)}
                animate
                variant="display"
                center
                numberOfLines={1}
                adjustsFontSizeToFit
              />
            ) : (
              <Text variant="display" center color={t.textFaint}>
                {' '}
              </Text>
            )}
            <Text variant="body" color={t.textMuted} center>
              {comparison ?? ' '}
            </Text>
          </View>

          <MonthCalendar cells={cells} selected={selected} onSelect={goToDay} currency={currency} />

          {empty ? (
            <View style={styles.empty}>
              <EmptyState
                icon={<Wallet size={30} color={t.onAccent} strokeWidth={1.5} />}
                title={`Nothing logged in ${formatMonthLabel(month)}`}
                body="Add an expense by hand, or pick a payment screenshot and let Synítheia read it for you."
                actionLabel="+ Add an expense"
                onAction={() => router.push('/expenses/new')}
              />
            </View>
          ) : totals && totals.topPayees.length > 0 ? (
            <Animated.View entering={FadeInDown.delay(AFTER_CALENDAR_MS).duration(420)}>
              <Text variant="overline" color={t.textFaint} style={styles.label}>
                Mostly to
              </Text>
              <PayeeStrip payees={totals.topPayees} currency={currency} />
            </Animated.View>
          ) : null}

          {/* Always here, so bills stay one tap away even in a month with nothing logged. */}
          <View style={styles.rows}>
            <OwedBanner />
            <BillsRow />
          </View>

          {empty ? null : (
            <>
              <View onLayout={(e) => (listY.current = e.nativeEvent.layout.y)}>
                <Text variant="overline" color={t.textFaint} style={styles.label}>
                  Every payment
                </Text>

                {days.map((day) => (
                  <View
                    key={day.localDate}
                    onLayout={(e) => {
                      const y = e.nativeEvent.layout.y;
                      dayY.current.set(day.localDate, y);
                      if (pendingDay === day.localDate) {
                        setPendingDay(null);
                        scrollToDay(day.localDate, y);
                      }
                    }}
                    style={[styles.day, highlighted === day.localDate && styles.highlight]}
                  >
                    <View style={styles.dayHeader}>
                      <Text variant="label" color={t.textMuted}>
                        {dayLabel(day.localDate)}
                      </Text>
                      <Text variant="label" color={t.textMuted}>
                        {formatAmount(day.totalMinor, currency)}
                      </Text>
                    </View>

                    {day.items.map((expense) => {
                      const index = row++;
                      const payment = (
                        <PaymentRow expense={expense} onPress={() => router.push(`/expenses/${expense._id}`)} />
                      );
                      return index < EASED_ROWS ? (
                        <Animated.View
                          key={expense._id}
                          entering={FadeInDown.delay(AFTER_CALENDAR_MS + 150 + index * ROW_STAGGER_MS).duration(420)}
                        >
                          {payment}
                        </Animated.View>
                      ) : (
                        <View key={expense._id}>{payment}</View>
                      );
                    })}
                  </View>
                ))}

                {hasNextPage ? (
                  <Button
                    variant="secondary"
                    label={loadMoreLabel({ total: totals?.count ?? null, shown: listed, pageSize: PAGE_SIZE })}
                    loading={isFetchingNextPage}
                    onPress={() => void fetchNextPage()}
                    style={styles.more}
                  />
                ) : null}
                {query.isFetchNextPageError ? (
                  <Text variant="caption" color={t.textMuted} center style={styles.moreError}>
                    Those payments could not be loaded. Try again.
                  </Text>
                ) : null}
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    content: { paddingHorizontal: spacing.xl, paddingBottom: spacing['4xl'] },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm,
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
    monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
    hero: { alignItems: 'center', marginTop: spacing.md, gap: spacing.xs },
    label: { marginTop: spacing['2xl'], marginBottom: spacing.md },
    rows: { gap: spacing.sm, marginTop: spacing.xl },
    empty: { marginTop: spacing.xl },
    day: { marginTop: spacing.base, borderRadius: radius.md, paddingHorizontal: spacing.xs },
    highlight: { backgroundColor: t.accentWash },
    dayHeader: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.xs, paddingBottom: spacing.xs },
    more: { marginTop: spacing.xl },
    moreError: { marginTop: spacing.sm },
  });
