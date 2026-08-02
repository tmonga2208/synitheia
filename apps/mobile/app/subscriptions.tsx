import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Repeat, Trash2 } from 'lucide-react-native';
import {
  CYCLE_LABEL,
  asMinor,
  formatMoney,
  monthlyEquivalent,
  parseMoneyInput,
  type BillingCycle,
} from '@synitheia/shared';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Input,
  Text,
  Touchable,
} from '../src/components/primitives.js';
import { SkeletonScreen } from '../src/components/Skeleton.js';
import { ApiError, api } from '../src/api/client.js';
import type { ListResponse, WireCategory } from '../src/api/types.js';
import { useAuth } from '../src/store/auth.js';
import { radius, spacing } from '../src/theme/theme.js';
import { useTheme, useThemedStyles } from '../src/theme/ThemeProvider.js';
import { accentFor, type Theme } from '../src/theme/theme.js';

const SUBS_KEY = ['subscriptions'] as const;
const ACCENT_COLOR = '#A98DA9';

const CYCLES: BillingCycle[] = ['monthly', 'weekly', 'quarterly', 'yearly'];

interface WireSubscription {
  _id: string;
  name: string;
  amountMinor: number;
  categoryName: string;
  categoryColor: string;
  cycle: BillingCycle;
  anchorDay: number;
  nextDueDate: string;
  autoPost: boolean;
}

interface SubsResponse {
  items: WireSubscription[];
  monthlyTotalMinor: number;
  activeCount: number;
  nextDue: { name: string; amountMinor: number; dueDate: string } | null;
}

/**
 * Recurring bills.
 *
 * A subscription is the one thing in this app that may write an expense without the
 * user acting in the moment — because it is the one thing the user explicitly declared:
 * they typed the name, the amount, and the day. That is not an inference, it is a
 * statement, and AGENTS.md permits automation exactly here.
 *
 * The `autoPost` toggle is on every row, not buried in a settings screen, because a
 * user must always be able to see — and revoke — what the app adds on their behalf.
 */
export default function SubscriptionsScreen() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const ACCENT = accentFor(ACCENT_COLOR, t);
  const queryClient = useQueryClient();
  const currency = useAuth((s) => s.user?.currency) ?? 'INR';
  const [adding, setAdding] = useState(false);

  const { data, error, isPending, isRefetching, refetch } = useQuery({
    queryKey: SUBS_KEY,
    queryFn: () => api.get<SubsResponse>('/subscriptions'),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: SUBS_KEY });
    void queryClient.invalidateQueries({ queryKey: ['today'] });
    void queryClient.invalidateQueries({ queryKey: ['expenses'] });
  };

  const setAuto = useMutation({
    mutationFn: ({ id, autoPost }: { id: string; autoPost: boolean }) =>
      api.patch<unknown>(`/subscriptions/${id}`, { autoPost }),
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/subscriptions/${id}`),
    onSettled: invalidate,
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
            message={error instanceof ApiError ? error.message : 'Could not load your bills.'}
            onRetry={() => void refetch()}
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
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={ACCENT.base}
          />
        }
      >
        <View style={styles.header}>
          {back}
          <Touchable
            style={styles.add}
            onPress={() => setAdding(true)}
            accessibilityRole="button"
            accessibilityLabel="Add a bill"
          >
            <Plus size={22} color={t.onAccent} strokeWidth={2.2} />
          </Touchable>
        </View>

        <Text variant="overline" color={ACCENT.text} style={{ marginTop: spacing.base }}>
          Recurring
        </Text>
        <Text variant="title">Bills</Text>

        {data.items.length === 0 ? (
          <EmptyState
            icon={<Repeat size={26} color={t.onAccent} strokeWidth={1.6} />}
            title="No bills yet"
            body="Add Netflix, rent, the gym — anything that charges you on a schedule. They'll be added on their due date so you don't have to remember."
            actionLabel="Add a bill"
            onAction={() => setAdding(true)}
          />
        ) : (
          <>
            {/*
              The number people actually want: what all of this costs per month, with
              weekly and yearly bills converted honestly. Weekly uses 52/12 — treating a
              month as "4 weeks" under-reports the year by a full month.
            */}
            <Card style={styles.total} accent={ACCENT.base}>
              <Text variant="overline" color={t.textMuted}>
                Every month
              </Text>
              <Text variant="title" style={{ marginTop: spacing.xs }}>
                {formatMoney(asMinor(data.monthlyTotalMinor), currency)}
              </Text>
              <Text variant="caption" color={t.textMuted}>
                {data.activeCount === 1 ? '1 bill' : `${data.activeCount} bills`}
                {data.nextDue
                  ? ` · next: ${data.nextDue.name} on ${data.nextDue.dueDate.slice(5)}`
                  : ''}
              </Text>
            </Card>

            {data.items.map((sub) => (
              <Card key={sub._id} style={styles.row}>
                <View style={styles.rowTop}>
                  <View style={{ flex: 1 }}>
                    <Text variant="cardTitle" numberOfLines={1}>
                      {sub.name}
                    </Text>
                    <Text variant="caption" color={t.textMuted}>
                      {CYCLE_LABEL[sub.cycle]} · due {sub.nextDueDate.slice(5)} ·{' '}
                      {sub.categoryName}
                    </Text>
                  </View>

                  <View style={{ alignItems: 'flex-end' }}>
                    <Text variant="cardTitle">
                      {formatMoney(asMinor(sub.amountMinor), currency)}
                    </Text>
                    {sub.cycle !== 'monthly' ? (
                      <Text variant="caption" color={t.textFaint}>
                        {formatMoney(
                          asMinor(monthlyEquivalent(sub.amountMinor, sub.cycle)),
                          currency,
                        )}
                        /mo
                      </Text>
                    ) : null}
                  </View>
                </View>

                <View style={styles.rowBottom}>
                  {/*
                    On the row, never hidden in settings. The user must always be able to
                    see — and revoke — what the app adds to their expenses on their behalf.
                  */}
                  <View style={styles.autoRow}>
                    <View style={styles.switchBox}>
                      <Switch
                        value={sub.autoPost}
                        onValueChange={(autoPost) => setAuto.mutate({ id: sub._id, autoPost })}
                        trackColor={{ true: t.accent, false: t.border }}
                        accessibilityLabel={`Add ${sub.name} automatically on its due date`}
                      />
                    </View>
                    <Text variant="caption" color={t.textMuted}>
                      {sub.autoPost ? 'Added automatically' : 'Asks first'}
                    </Text>
                  </View>

                  <Touchable
                    onPress={() => remove.mutate(sub._id)}
                    style={styles.delete}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${sub.name}`}
                  >
                    <Trash2 size={16} color={t.textFaint} strokeWidth={1.7} />
                  </Touchable>
                </View>
              </Card>
            ))}
          </>
        )}
      </ScrollView>

      <AddBillSheet
        visible={adding}
        currency={currency}
        onClose={() => setAdding(false)}
        onAdded={() => {
          setAdding(false);
          invalidate();
        }}
      />
    </SafeAreaView>
  );
}

function AddBillSheet({
  visible,
  currency,
  onClose,
  onAdded,
}: {
  visible: boolean;
  currency: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [day, setDay] = useState('1');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [autoPost, setAutoPost] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const categories = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => api.get<ListResponse<WireCategory>>('/expense-categories'),
  });

  const items = categories.data?.items ?? [];
  const chosen = categoryId ?? items.find((c) => c.name === 'Bills')?._id ?? items[0]?._id ?? null;

  const amountMinor = parseMoneyInput(amount, currency);
  const anchorDay = Number(day);

  const valid =
    name.trim().length > 0 &&
    amountMinor !== null &&
    amountMinor > 0 &&
    chosen !== null &&
    Number.isInteger(anchorDay) &&
    anchorDay >= (cycle === 'weekly' ? 0 : 1) &&
    anchorDay <= (cycle === 'weekly' ? 6 : 31);

  const create = useMutation({
    mutationFn: () =>
      api.post<unknown>('/subscriptions', {
        name: name.trim(),
        amountMinor,
        categoryId: chosen,
        cycle,
        anchorDay,
        // Quarterly and yearly bills need to know WHICH month, not just which day.
        anchorMonth:
          cycle === 'quarterly' || cycle === 'yearly'
            ? new Date().getMonth() + 1
            : undefined,
        autoPost,
      }),

    onSuccess: () => {
      setName('');
      setAmount('');
      setError(null);
      onAdded();
    },

    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not add that bill.');
    },
  });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      {/* SafeAreaProvider again — a Modal renders outside the root provider's tree. */}
      <SafeAreaProvider>
        <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ flex: 1 }}
          >
            <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
              <Text variant="heading" style={{ marginBottom: spacing.lg }}>
                Add a bill
              </Text>

              <Input
                label="What is it?"
                value={name}
                onChangeText={setName}
                placeholder="Netflix"
                accessibilityLabel="Bill name"
              />

              <Input
                label="Amount"
                value={amount}
                onChangeText={setAmount}
                placeholder="649"
                keyboardType="decimal-pad"
                accessibilityLabel="Amount"
              />

              <View>
                <Text variant="label" color={t.textMuted} style={styles.label}>
                  How often
                </Text>
                <View style={styles.pills}>
                  {CYCLES.map((c) => (
                    <Chip
                      key={c}
                      label={CYCLE_LABEL[c]}
                      selected={cycle === c}
                      onPress={() => setCycle(c)}
                      accessibilityLabel={CYCLE_LABEL[c]}
                    />
                  ))}
                </View>
              </View>

              <Input
                label={cycle === 'weekly' ? 'Day of the week (0 = Monday)' : 'Day of the month'}
                value={day}
                onChangeText={setDay}
                keyboardType="number-pad"
                accessibilityLabel="Billing day"
                error={
                  day !== '' && !valid && name.trim() !== '' && amountMinor !== null
                    ? cycle === 'weekly'
                      ? 'Use 0 (Monday) to 6 (Sunday)'
                      : 'Use a day from 1 to 31'
                    : null
                }
              />

              {/*
                A 31st anchor is legal and correct: it bills on the last day of any
                shorter month and returns to the 31st afterwards. Saying so here stops
                people picking the 28th "to be safe" and being billed early all year.
              */}
              {cycle !== 'weekly' && anchorDay > 28 ? (
                <Text variant="caption" color={t.textMuted}>
                  Short months bill on their last day, then it returns to the {anchorDay}
                  {anchorDay === 31 ? 'st' : 'th'}.
                </Text>
              ) : null}

              <View>
                <Text variant="label" color={t.textMuted} style={styles.label}>
                  Category
                </Text>
                <View style={styles.pills}>
                  {items.map((c) => (
                    <Chip
                      key={c._id}
                      label={c.name}
                      accent={c.color}
                      selected={chosen === c._id}
                      onPress={() => setCategoryId(c._id)}
                      accessibilityLabel={`Category ${c.name}`}
                    />
                  ))}
                </View>
              </View>

              <View style={styles.autoRow}>
                <View style={styles.switchBox}>
                  <Switch
                    value={autoPost}
                    onValueChange={setAutoPost}
                    trackColor={{ true: t.accent, false: t.border }}
                    accessibilityLabel="Add this automatically on its due date"
                  />
                </View>
                <Text variant="caption" color={t.textMuted} style={{ flex: 1 }}>
                  {autoPost
                    ? 'Added to your expenses on its due date.'
                    : "You'll be asked before it's added."}
                </Text>
              </View>

              {error ? (
                <Text variant="caption" color={t.danger}>
                  {error}
                </Text>
              ) : null}

              <Button
                label="Add bill"
                disabled={!valid}
                loading={create.isPending}
                onPress={() => create.mutate()}
              />

              <Button label="Cancel" variant="ghost" onPress={onClose} />
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    content: { padding: spacing.lg, paddingBottom: spacing['4xl'] },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    back: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: -spacing.md,
    },
    add: {
      width: 44,
      height: 44,
      borderRadius: radius.full,
      backgroundColor: t.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    total: { marginTop: spacing.xl, marginBottom: spacing.lg },
    row: { marginBottom: spacing.md },
    rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    rowBottom: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.base,
    },
    autoRow: { flexDirection: 'row', alignItems: 'center', flex: 1 },
    /**
     * iOS 26 redesigned UISwitch and it now paints wider than the classic 51pt — wide
     * enough to overflow a 51pt box and slide under the label beside it. Size the box to
     * the real paint width rather than to the number the old docs give.
     */
    switchBox: { width: 64, marginRight: spacing.sm },
    delete: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

    // Non-transparent full-screen Modal — replaces the screen, so t.bg not t.surface.
    sheet: { flex: 1, backgroundColor: t.bg },
    sheetBody: { padding: spacing.lg, gap: spacing.base, paddingBottom: spacing['4xl'] },
    label: { marginBottom: spacing.sm },
    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  });
