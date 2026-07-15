import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { Bell, Minus, Plus, Trash2 } from 'lucide-react-native';
import type { CreateReminderInput, ReminderKind } from '@synitheia/shared';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Input,
  Text,
  Touchable,
} from '../../src/components/primitives.js';
import { SkeletonList } from '../../src/components/Skeleton.js';
import { ApiError, api } from '../../src/api/client.js';
import type { ListResponse, WireReminder } from '../../src/api/types.js';
import { MIN_TAP_TARGET, palette, radius, spacing } from '../../src/theme/tokens.js';

const REMINDERS_KEY = ['reminders'] as const;

/** 0 = Monday … 6 = Sunday, matching the domain. Empty selection means every day. */
const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

const KINDS: readonly ReminderKind[] = ['habit', 'water', 'food', 'expense', 'custom'];

/**
 * The domain counts weekdays from Monday (0); expo-notifications counts from Sunday (1).
 * Getting this off by one silently fires every reminder on the wrong day, which is the
 * kind of bug a user experiences as "the app is broken" rather than reports.
 */
function toExpoWeekday(domainWeekday: number): number {
  return ((domainWeekday + 1) % 7) + 1;
}

/** Every notification we schedule carries its reminder id, so we can find and cancel it. */
interface ReminderNotificationData extends Record<string, unknown> {
  reminderId: string;
}

async function cancelFor(reminderId: string): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();

  await Promise.all(
    scheduled
      .filter(
        (n) => (n.content.data as ReminderNotificationData | undefined)?.reminderId === reminderId,
      )
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

/**
 * Reminders fire on-device. The server stores only the definition — so a reminder still
 * arrives on a plane, in a tunnel, and with the backend down, and no nudge is ever a
 * network round trip.
 *
 * Cancel-then-schedule, always: it is idempotent, which means a re-sync after a
 * reinstall or an edit on another device converges instead of stacking duplicates.
 */
async function syncReminder(reminder: WireReminder): Promise<void> {
  await cancelFor(reminder._id);
  if (!reminder.enabled) return;

  const granted =
    (await Notifications.getPermissionsAsync()).granted ||
    (await Notifications.requestPermissionsAsync()).granted;

  if (!granted) return;

  const [hour, minute] = reminder.time.split(':').map(Number) as [number, number];

  const content = {
    title: reminder.label,
    body: 'A gentle nudge from Synítheia.',
    data: { reminderId: reminder._id } satisfies ReminderNotificationData,
  };

  if (reminder.weekdays.length === 0) {
    await Notifications.scheduleNotificationAsync({
      content,
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
      },
    });
    return;
  }

  await Promise.all(
    reminder.weekdays.map((day) =>
      Notifications.scheduleNotificationAsync({
        content,
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday: toExpoWeekday(day),
          hour,
          minute,
        },
      }),
    ),
  );
}

function describe(reminder: WireReminder): string {
  const days =
    reminder.weekdays.length === 0
      ? 'Every day'
      : reminder.weekdays
          .slice()
          .sort((a, b) => a - b)
          .map((d) => WEEKDAY_LABELS[d])
          .join(' · ');

  return `${reminder.time} · ${days}`;
}

export default function Reminders() {
  const queryClient = useQueryClient();
  const [composing, setComposing] = useState(false);

  const query = useQuery({
    queryKey: REMINDERS_KEY,
    queryFn: () => api.get<ListResponse<WireReminder>>('/reminders'),
  });

  // The device is the source of truth for *delivery*, and it can fall out of step with
  // the server (a reinstall, an edit on another phone). One reconciliation per load
  // brings it back in line; syncReminder is idempotent, so it cannot double-fire.
  const synced = useRef(false);
  const items = query.data?.items;

  useEffect(() => {
    if (!items || synced.current) return;
    synced.current = true;

    void Promise.all(items.map((reminder) => syncReminder(reminder).catch(() => undefined)));
  }, [items]);

  const toggle = useMutation({
    mutationFn: ({ reminder, enabled }: { reminder: WireReminder; enabled: boolean }) =>
      api.patch<{ reminder: WireReminder }>(`/reminders/${reminder._id}`, { enabled }),

    onMutate: async ({ reminder, enabled }) => {
      await queryClient.cancelQueries({ queryKey: REMINDERS_KEY });
      const previous = queryClient.getQueryData<ListResponse<WireReminder>>(REMINDERS_KEY);

      queryClient.setQueryData<ListResponse<WireReminder>>(REMINDERS_KEY, (current) =>
        current
          ? {
              items: current.items.map((r) =>
                r._id === reminder._id ? { ...r, enabled } : r,
              ),
            }
          : current,
      );

      return { previous };
    },

    // Only touch the notification schedule once the server has accepted the change —
    // a reminder that fires for a state the server rejected is a lie the device tells.
    onSuccess: (_result, { reminder, enabled }) => {
      void syncReminder({ ...reminder, enabled }).catch(() => undefined);
    },

    onError: (error: unknown, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(REMINDERS_KEY, context.previous);
      Alert.alert(
        'Could not update',
        error instanceof Error ? error.message : 'Please try again.',
      );
    },

    onSettled: () => queryClient.invalidateQueries({ queryKey: REMINDERS_KEY }),
  });

  const remove = useMutation({
    mutationFn: (reminder: WireReminder) => api.delete<void>(`/reminders/${reminder._id}`),

    onSuccess: (_result, reminder) => {
      void cancelFor(reminder._id).catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: REMINDERS_KEY });
    },

    onError: (error: unknown) => {
      Alert.alert(
        'Could not delete',
        error instanceof Error ? error.message : 'Please try again.',
      );
    },
  });

  const create = useMutation({
    mutationFn: (input: CreateReminderInput) =>
      api.post<{ reminder: WireReminder }>('/reminders', input),

    onSuccess: ({ reminder }) => {
      void syncReminder(reminder).catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: REMINDERS_KEY });
      setComposing(false);
    },
  });

  function confirmDelete(reminder: WireReminder) {
    Alert.alert(`Delete “${reminder.label}”?`, 'This reminder will stop firing on this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(reminder) },
    ]);
  }

  const header = (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <Text variant="overline" color={palette.stoneFaint}>
          On this device
        </Text>
        <Text variant="title">Reminders</Text>
      </View>

      <Touchable
        accessibilityRole="button"
        accessibilityLabel="Add a reminder"
        onPress={() => setComposing(true)}
        style={styles.add}
      >
        <Plus size={22} color={palette.white} strokeWidth={2} />
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
                : 'We could not load your reminders.'
            }
            onRetry={() => void query.refetch()}
          />
        </View>
      </SafeAreaView>
    );
  }

  const reminders = query.data?.items ?? [];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
            tintColor={palette.sage}
          />
        }
      >
        {header}

        {reminders.length === 0 ? (
          <EmptyState
            icon={<Bell size={30} color={palette.white} strokeWidth={1.5} />}
            title="No reminders yet"
            body="A gentle nudge at the right moment does more than a streak ever will. They fire on this device, even offline."
            actionLabel="+ Add a reminder"
            onAction={() => setComposing(true)}
          />
        ) : (
          <View style={styles.list}>
            {reminders.map((reminder) => (
              <Card key={reminder._id} style={styles.reminder}>
                <View style={styles.reminderCopy}>
                  <Text variant="cardTitle" numberOfLines={1}>
                    {reminder.label}
                  </Text>
                  <Text variant="caption" color={palette.stoneFaint}>
                    {describe(reminder)}
                  </Text>
                </View>

                <Switch
                  value={reminder.enabled}
                  onValueChange={(enabled) => toggle.mutate({ reminder, enabled })}
                  accessibilityLabel={`${reminder.label} enabled`}
                  trackColor={{ false: palette.surfaceDim, true: palette.sage }}
                  thumbColor={palette.white}
                  ios_backgroundColor={palette.surfaceDim}
                />

                <Touchable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${reminder.label}`}
                  haptic={false}
                  onPress={() => confirmDelete(reminder)}
                  style={styles.iconButton}
                >
                  <Trash2 size={18} color={palette.danger} strokeWidth={1.6} />
                </Touchable>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>

      <ComposeSheet
        visible={composing}
        saving={create.isPending}
        error={
          create.error instanceof ApiError || create.error instanceof Error
            ? create.error.message
            : null
        }
        onClose={() => setComposing(false)}
        onSubmit={(input) => create.mutate(input)}
      />
    </SafeAreaView>
  );
}

const pad = (n: number): string => String(n).padStart(2, '0');

function ComposeSheet({
  visible,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: CreateReminderInput) => void;
}) {
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<ReminderKind>('custom');
  const [hour, setHour] = useState(19);
  const [minute, setMinute] = useState(30);
  const [weekdays, setWeekdays] = useState<number[]>([]);

  const valid = label.trim().length > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Touchable
          style={styles.backdropDismiss}
          haptic={false}
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
        />

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <SafeAreaView style={styles.sheet} edges={['bottom']}>
            <View style={styles.handle} />

            <Text variant="heading" style={styles.sheetTitle}>
              New reminder
            </Text>

            <View style={styles.sheetBody}>
              <Input
                label="What should we nudge you about?"
                value={label}
                onChangeText={setLabel}
                placeholder="Drink a glass of water"
                maxLength={80}
                returnKeyType="done"
              />

              <View style={styles.pills}>
                {KINDS.map((value) => (
                  <Chip
                    key={value}
                    label={value.charAt(0).toUpperCase() + value.slice(1)}
                    selected={kind === value}
                    accessibilityLabel={`Reminder kind ${value}`}
                    onPress={() => setKind(value)}
                  />
                ))}
              </View>

              <View style={styles.timeRow}>
                <Text variant="label" color={palette.stoneMuted}>
                  Time
                </Text>

                <View style={styles.stepperRow}>
                  <Stepper
                    label="Hour"
                    value={pad(hour)}
                    onStep={(d) => setHour((h) => (h + d + 24) % 24)}
                  />
                  <Text variant="heading" color={palette.stoneFaint}>
                    :
                  </Text>
                  <Stepper
                    label="Minute"
                    value={pad(minute)}
                    onStep={(d) => setMinute((m) => (m + d * 5 + 60) % 60)}
                  />
                </View>
              </View>

              <View>
                <Text variant="label" color={palette.stoneMuted} style={styles.daysLabel}>
                  Repeat — leave empty for every day
                </Text>

                <View style={styles.pills}>
                  {WEEKDAY_LABELS.map((day, index) => {
                    const selected = weekdays.includes(index);

                    return (
                      <Chip
                        key={`${day}-${index}`}
                        label={day}
                        selected={selected}
                        accessibilityLabel={`Repeat on weekday ${index + 1}`}
                        onPress={() =>
                          setWeekdays((current) =>
                            selected
                              ? current.filter((d) => d !== index)
                              : [...current, index],
                          )
                        }
                      />
                    );
                  })}
                </View>
              </View>

              {error ? (
                <Text variant="caption" color={palette.danger} accessibilityLiveRegion="polite">
                  {error}
                </Text>
              ) : null}

              <Button
                label="Add reminder"
                disabled={!valid}
                loading={saving}
                onPress={() =>
                  onSubmit({
                    kind,
                    label: label.trim(),
                    time: `${pad(hour)}:${pad(minute)}`,
                    weekdays,
                    enabled: true,
                  })
                }
              />
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function Stepper({
  label,
  value,
  onStep,
}: {
  label: string;
  value: string;
  onStep: (delta: number) => void;
}) {
  return (
    <View style={styles.stepper}>
      <Touchable
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label.toLowerCase()}`}
        onPress={() => onStep(-1)}
        style={styles.stepButton}
      >
        <Minus size={16} color={palette.stone} strokeWidth={2} />
      </Touchable>

      <Text
        variant="heading"
        accessibilityRole="text"
        accessibilityLabel={`${label} ${value}`}
        style={styles.stepValue}
      >
        {value}
      </Text>

      <Touchable
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label.toLowerCase()}`}
        onPress={() => onStep(1)}
        style={styles.stepButton}
      >
        <Plus size={16} color={palette.stone} strokeWidth={2} />
      </Touchable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bone },
  content: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    marginBottom: spacing.lg,
  },
  headerCopy: { gap: spacing.xs },
  add: {
    width: MIN_TAP_TARGET + 4,
    height: MIN_TAP_TARGET + 4,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.sage,
  },
  list: { gap: spacing.md },
  reminder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  reminderCopy: { flex: 1, gap: spacing.xs },
  iconButton: {
    width: MIN_TAP_TARGET,
    height: MIN_TAP_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: palette.scrim,
  },
  backdropDismiss: { flex: 1 },
  sheet: {
    backgroundColor: palette.bone,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  handle: {
    alignSelf: 'center',
    width: 96,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: palette.surfaceDim,
  },
  sheetTitle: { marginTop: spacing.lg },
  sheetBody: {
    marginTop: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xl,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  timeRow: { gap: spacing.sm },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: palette.sand,
    borderWidth: 1,
    borderColor: palette.surfaceDim,
  },
  stepButton: {
    width: MIN_TAP_TARGET,
    height: MIN_TAP_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  stepValue: { minWidth: 32, textAlign: 'center' },
  daysLabel: { marginBottom: spacing.sm },
});
