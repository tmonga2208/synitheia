import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBackOrHome } from '../src/navigation/goBackOrHome.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bell, Minus, Plus, Trash2 } from 'lucide-react-native';
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
} from '../src/components/primitives.js';
import { SkeletonList } from '../src/components/Skeleton.js';
import { api } from '../src/api/client.js';
import { describeError, errorLine } from '../src/api/errorCopy.js';
import type { ListResponse, WireReminder } from '../src/api/types.js';
import {
  accessCopy,
  askForNotifications,
  type NotificationAccess,
} from '../src/reminders/permission.js';
import { requestReminderRefresh } from '../src/reminders/schedule.js';
import { useNotificationAccess } from '../src/reminders/useNotificationAccess.js';
import { MIN_TAP_TARGET, radius, spacing } from '../src/theme/theme.js';
import { useTheme, useThemedStyles } from '../src/theme/ThemeProvider.js';
import type { Theme } from '../src/theme/theme.js';

const REMINDERS_KEY = ['reminders'] as const;

/** 0 = Monday … 6 = Sunday, matching the domain. Empty selection means every day. */
const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

const KINDS: readonly ReminderKind[] = ['habit', 'water', 'food', 'expense', 'custom'];

/*
 * Reminders fire on the device, so they arrive on a plane or with the backend down. They
 * are not scheduled here: every change goes through the API, and every successful write
 * re-plans all of them (src/reminders), worded from how the day is going.
 */

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
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const queryClient = useQueryClient();
  const [composing, setComposing] = useState(false);
  const [access, setAccess] = useNotificationAccess();

  /**
   * Ask, or send to Settings once asking no longer works. Allowed now means the reminders
   * can be put on the phone, so they are re-planned straight away.
   */
  function unblock(action: 'ask' | 'settings') {
    if (action === 'settings') {
      void Linking.openSettings();
      return;
    }
    void askForNotifications()
      .then((next: NotificationAccess) => {
        setAccess(next);
        if (next === 'granted') requestReminderRefresh();
      })
      .catch(() => undefined);
  }

  const query = useQuery({
    queryKey: REMINDERS_KEY,
    queryFn: () => api.get<ListResponse<WireReminder>>('/reminders'),
  });

  const toggle = useMutation({
    meta: { reportsOwnError: true },
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

    // No scheduling here: the reminders are re-planned after the server accepts the
    // change, so a reminder never fires for a state the server rejected.

    onError: (error: unknown, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(REMINDERS_KEY, context.previous);
      Alert.alert('Couldn’t update this reminder', describeError(error).message);
    },

    onSettled: () => queryClient.invalidateQueries({ queryKey: REMINDERS_KEY }),
  });

  const remove = useMutation({
    meta: { reportsOwnError: true },
    mutationFn: (reminder: WireReminder) => api.delete<void>(`/reminders/${reminder._id}`),

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: REMINDERS_KEY });
    },

    onError: (error: unknown) => {
      Alert.alert('Couldn’t delete this reminder', describeError(error).message);
    },
  });

  const create = useMutation({
    meta: { reportsOwnError: true },
    mutationFn: (input: CreateReminderInput) =>
      api.post<{ reminder: WireReminder }>('/reminders', input),

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: REMINDERS_KEY });
      setComposing(false);
      // The moment someone sets a reminder is the moment to ask if it may reach them.
      unblock('ask');
    },
  });

  function confirmDelete(reminder: WireReminder) {
    Alert.alert(`Delete “${reminder.label}”?`, 'This reminder will stop firing on this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(reminder) },
    ]);
  }

  const back = (
    <Touchable
      onPress={() => goBackOrHome(router)}
      style={styles.back}
      haptic={false}
      accessibilityRole="button"
      accessibilityLabel="Go back"
    >
      <ArrowLeft size={22} color={t.textPrimary} strokeWidth={1.8} />
    </Touchable>
  );

  const header = (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <Text variant="overline" color={t.textFaint}>
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
          {back}
          {header}
          <ErrorState
            error={query.error}
            message="We could not load your reminders."
            onRetry={() => void query.refetch()}
          />
        </View>
      </SafeAreaView>
    );
  }

  const reminders = query.data?.items ?? [];
  // Only worth saying once there is a reminder that would have arrived.
  const blocked = access && reminders.some((r) => r.enabled) ? accessCopy(access) : null;

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
        {back}
        {header}

        {blocked ? (
          <Card style={styles.blocked} accessibilityLiveRegion="polite">
            <Text variant="cardTitle">{blocked.title}</Text>
            <Text variant="body" color={t.textMuted}>
              {blocked.body}
            </Text>
            <Button
              label={blocked.actionLabel}
              variant="secondary"
              onPress={() => unblock(blocked.action)}
              style={styles.blockedAction}
            />
          </Card>
        ) : null}

        {reminders.length === 0 ? (
          <EmptyState
            icon={<Bell size={30} color={t.onAccent} strokeWidth={1.5} />}
            title="No reminders yet"
            body="Pick a time, and Synítheia reminds you with how your day is going: water so far, habits still to do. They arrive even when you're offline."
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
                  <Text variant="caption" color={t.textFaint}>
                    {describe(reminder)}
                  </Text>
                </View>

                <Switch
                  value={reminder.enabled}
                  onValueChange={(enabled) => toggle.mutate({ reminder, enabled })}
                  accessibilityLabel={`${reminder.label} enabled`}
                  trackColor={{ false: t.border, true: t.accent }}
                  thumbColor={t.onAccent}
                  ios_backgroundColor={t.border}
                />

                <Touchable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${reminder.label}`}
                  haptic={false}
                  onPress={() => confirmDelete(reminder)}
                  style={styles.iconButton}
                >
                  <Trash2 size={18} color={t.danger} strokeWidth={1.6} />
                </Touchable>
              </Card>
            ))}

            <Text variant="caption" color={t.textFaint} style={styles.footnote}>
              Planned two weeks ahead, and refreshed whenever you open Synítheia.
            </Text>
          </View>
        )}
      </ScrollView>

      <ComposeSheet
        visible={composing}
        saving={create.isPending}
        error={create.error ? errorLine(create.error, 'Couldn’t save this reminder') : null}
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
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
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

        <KeyboardAvoidingView behavior="padding">
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
                <Text variant="label" color={t.textMuted}>
                  Time
                </Text>

                <View style={styles.stepperRow}>
                  <Stepper
                    label="Hour"
                    value={pad(hour)}
                    onStep={(d) => setHour((h) => (h + d + 24) % 24)}
                  />
                  <Text variant="heading" color={t.textFaint}>
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
                <Text variant="label" color={t.textMuted} style={styles.daysLabel}>
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
                <Text variant="caption" color={t.danger} accessibilityLiveRegion="polite">
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
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.stepper}>
      <Touchable
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label.toLowerCase()}`}
        onPress={() => onStep(-1)}
        style={styles.stepButton}
      >
        <Minus size={16} color={t.textPrimary} strokeWidth={2} />
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
        <Plus size={16} color={t.textPrimary} strokeWidth={2} />
      </Touchable>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    content: {
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.xl,
    },
    back: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: -spacing.md,
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
      backgroundColor: t.accent,
    },
    list: { gap: spacing.md },
    blocked: { gap: spacing.sm, marginBottom: spacing.base },
    blockedAction: { marginTop: spacing.sm, alignSelf: 'flex-start' },
    footnote: { marginTop: spacing.sm, textAlign: 'center' },
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
      backgroundColor: t.scrim,
    },
    backdropDismiss: { flex: 1 },
    // A real bottom sheet: transparent Modal, slides up over the scrim.
    sheet: {
      backgroundColor: t.surface,
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
      backgroundColor: t.border,
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
      backgroundColor: t.surfaceRaised,
      borderWidth: 1,
      borderColor: t.border,
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
