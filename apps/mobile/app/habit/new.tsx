import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Minus, Plus } from 'lucide-react-native';
import {
  HABIT_COLORS,
  HABIT_MEASURES,
  createHabitSchema,
  type Habit,
  type HabitFrequency,
  type HabitMeasure,
} from '@synitheia/shared';
import {
  Button,
  Card,
  Chip,
  Input,
  Text,
  Touchable,
} from '../../src/components/primitives.js';
import { DEFAULT_ICON, IconPicker, iconFor } from '../../src/components/IconPicker.js';
import { ApiError, api } from '../../src/api/client.js';
import { MIN_TAP_TARGET, radius, spacing } from '../../src/theme/theme.js';
import { useTheme, useThemedStyles } from '../../src/theme/ThemeProvider.js';
import { accentFor, type Theme } from '../../src/theme/theme.js';

const BASE_CATEGORIES = ['Mindfulness', 'Health'] as const;

interface TimeOfDay {
  /** 1–12, as displayed. */
  hour: number;
  minute: number;
  period: 'AM' | 'PM';
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** The domain stores reminders as 24-hour HH:mm; the UI shows a 12-hour clock. */
function to24h({ hour, minute, period }: TimeOfDay): string {
  const h = period === 'AM' ? hour % 12 : (hour % 12) + 12;
  return `${pad(h)}:${pad(minute)}`;
}

/**
 * The notification is scheduled locally rather than pushed from the server. A gentle
 * reminder must fire on time even when the device is offline, and it needs no network
 * round-trip to be trustworthy.
 */
async function scheduleReminder(habit: Habit, time: TimeOfDay): Promise<void> {
  const existing = await Notifications.getPermissionsAsync();
  const granted =
    existing.granted ||
    (await Notifications.requestPermissionsAsync()).granted;

  if (!granted) return;

  const [hour, minute] = to24h(time).split(':').map(Number) as [number, number];

  await Notifications.scheduleNotificationAsync({
    content: {
      title: habit.name,
      body: 'A gentle nudge — your ritual is waiting.',
      data: { habitId: habit.id },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
    },
  });
}

export default function NewHabit() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [icon, setIcon] = useState(DEFAULT_ICON);
  const [color, setColor] = useState<string>(HABIT_COLORS[0]);
  const [categories, setCategories] = useState<string[]>([...BASE_CATEGORIES]);
  const [category, setCategory] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState<string | null>(null);

  const [frequency, setFrequency] = useState<HabitFrequency>('daily');
  const [measure, setMeasure] = useState<HabitMeasure>('check');
  const [targetCount, setTargetCount] = useState(1);
  const [unit, setUnit] = useState<string | null>(null);

  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [time, setTime] = useState<TimeOfDay>({ hour: 7, minute: 30, period: 'PM' });

  const [iconSheet, setIconSheet] = useState(false);
  const [colorSheet, setColorSheet] = useState(false);

  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const accent = accentFor(color, t);
  const SelectedIcon = iconFor(icon).Icon;
  const periodLabel = frequency === 'daily' ? 'Daily' : 'Weekly';

  const spec = HABIT_MEASURES[measure];

  /**
   * Changing the measure resets the target to that measure's default.
   *
   * Carrying the old number across is worse than it sounds: switch from "3 times" to Steps
   * and you would be left with a goal of 3 steps, which is both silly and, at the schema's
   * minimum of 500, rejected on save.
   */
  function pickMeasure(next: HabitMeasure) {
    const nextSpec = HABIT_MEASURES[next];
    setMeasure(next);
    setTargetCount(nextSpec.defaultTarget);
    setUnit(nextSpec.unit);
  }

  function shiftTarget(delta: number) {
    setTargetCount((n) =>
      Math.min(spec.maxTarget, Math.max(spec.minTarget, n + delta * spec.step)),
    );
  }

  function commitNewCategory() {
    const trimmed = (newCategory ?? '').trim();
    if (trimmed.length === 0) {
      setNewCategory(null);
      return;
    }

    setCategories((all) => (all.includes(trimmed) ? all : [...all, trimmed]));
    setCategory(trimmed);
    setNewCategory(null);
  }

  async function submit() {
    setNameError(null);
    setFormError(null);

    const parsed = createHabitSchema.safeParse({
      name: name.trim(),
      icon,
      color,
      category,
      frequency,
      measure,
      targetCount,
      unit: measure === 'check' ? null : (unit?.trim() || spec.unit),
      reminderTime: reminderEnabled ? to24h(time) : null,
    });

    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors;
      setNameError(fields.name?.[0] ?? null);
      if (!fields.name) setFormError('Please check the details and try again.');
      return;
    }

    setSaving(true);

    try {
      const { habit } = await api.post<{ habit: Habit }>('/habits', parsed.data);

      if (reminderEnabled) {
        // A failed reminder must not fail the habit — it already exists on the server.
        await scheduleReminder(habit, time).catch(() => undefined);
      }

      /**
       * The lists are cached. Without this, going back lands on a Habits screen that does
       * not contain the habit you just created — it exists on the server, it is simply not
       * in the cache, so it only appears after a pull-to-refresh. It reads as a failed save.
       */
      await queryClient.invalidateQueries({ queryKey: ['habits'] });
      await queryClient.invalidateQueries({ queryKey: ['today'] });

      router.back();
    } catch (error) {
      setFormError(
        error instanceof ApiError || error instanceof Error
          ? error.message
          : 'Could not create this habit. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
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
              style={styles.iconButton}
              accessibilityRole="button"
              accessibilityLabel="Choose habit colour"
              onPress={() => setColorSheet(true)}
            >
              <View style={[styles.swatch, { backgroundColor: accent.base }]} />
            </Touchable>
          </View>

          <Text variant="title">New Habit</Text>
          <Text variant="body" color={t.textMuted} style={styles.subtitle}>
            Design a habit that nourishes your daily life.
          </Text>

          {/* ─── Name ─────────────────────────────────────────────────────── */}
          <Card style={styles.card}>
            <Text variant="section">Name</Text>

            <View style={styles.nameRow}>
              <Touchable
                accessibilityRole="button"
                accessibilityLabel={`Habit icon: ${iconFor(icon).label}. Tap to change.`}
                onPress={() => setIconSheet(true)}
                style={[styles.iconChip, { backgroundColor: accent.wash }]}
              >
                <SelectedIcon size={22} color={accent.text} strokeWidth={1.5} />
              </Touchable>

              <View style={styles.flex}>
                <Input
                  value={name}
                  onChangeText={setName}
                  error={nameError}
                  placeholder="Morning meditation"
                  accessibilityLabel="Habit name"
                  maxLength={60}
                  returnKeyType="done"
                />
              </View>
            </View>

            <View style={styles.pills}>
              {categories.map((c) => (
                <Chip
                  key={c}
                  label={c}
                  accent={accent.base}
                  selected={category === c}
                  accessibilityLabel={`Category ${c}`}
                  onPress={() => setCategory((prev) => (prev === c ? null : c))}
                />
              ))}

              <Chip
                label="+ New"
                accessibilityLabel="Add a new category"
                onPress={() => setNewCategory('')}
              />
            </View>

            {newCategory !== null ? (
              <View style={styles.newCategory}>
                <Input
                  value={newCategory}
                  onChangeText={setNewCategory}
                  placeholder="Category name"
                  accessibilityLabel="New category name"
                  autoFocus
                  maxLength={40}
                  returnKeyType="done"
                  onSubmitEditing={commitNewCategory}
                  onBlur={commitNewCategory}
                />
              </View>
            ) : null}
          </Card>

          {/* ─── Frequency ────────────────────────────────────────────────── */}
          <Card style={styles.card}>
            <Text variant="section">Frequency</Text>

            <View style={styles.segments} accessibilityRole="tablist">
              {(['daily', 'weekly'] as const).map((value) => {
                const active = frequency === value;
                const label = value === 'daily' ? 'Daily' : 'Weekly';

                return (
                  <Touchable
                    key={value}
                    accessibilityRole="tab"
                    accessibilityLabel={label}
                    accessibilityState={{ selected: active }}
                    onPress={() => setFrequency(value)}
                    style={[
                      styles.segment,
                      ...(active ? [{ backgroundColor: t.accent }] : []),
                    ]}
                  >
                    <Text
                      variant="heading"
                      color={active ? t.onAccent : t.textMuted}
                    >
                      {label}
                    </Text>
                  </Touchable>
                );
              })}
            </View>

            {/* What the habit actually measures — a tick, a count, minutes, or steps. */}
            <View style={styles.measures}>
              {(Object.keys(HABIT_MEASURES) as HabitMeasure[]).map((key) => (
                <Chip
                  key={key}
                  label={HABIT_MEASURES[key].label}
                  selected={measure === key}
                  onPress={() => pickMeasure(key)}
                  accessibilityLabel={`Measure by ${HABIT_MEASURES[key].label}`}
                />
              ))}
            </View>

            {/* A tick has no goal to set — 'done' is the only target it can have. */}
            {measure === 'check' ? null : (
              <View style={styles.goalRow}>
                <Text variant="section" color={t.textMuted}>
                  Goal:{' '}
                  <Text variant="section" color={t.textPrimary}>
                    {`${targetCount.toLocaleString()} ${unit ?? spec.unit ?? ''} ${periodLabel.toLowerCase()}`}
                  </Text>
                </Text>

                <View style={styles.stepper}>
                  <Touchable
                    accessibilityRole="button"
                    accessibilityLabel="Decrease goal"
                    disabled={targetCount <= spec.minTarget}
                    onPress={() => shiftTarget(-1)}
                    style={styles.stepButton}
                  >
                    <Minus size={18} color={t.onAccent} />
                  </Touchable>

                  <Touchable
                    accessibilityRole="button"
                    accessibilityLabel="Increase goal"
                    disabled={targetCount >= spec.maxTarget}
                    onPress={() => shiftTarget(1)}
                    style={styles.stepButton}
                  >
                    <Plus size={18} color={t.onAccent} />
                  </Touchable>
                </View>
              </View>
            )}

            {/* Only a count is worth naming — "20 min" and "8,000 steps" name themselves. */}
            {spec.customUnit ? (
              <Input
                label="Unit"
                value={unit ?? ''}
                onChangeText={setUnit}
                placeholder={spec.unit ?? 'times'}
                maxLength={16}
                accessibilityLabel="Unit, for example glasses or pages"
              />
            ) : null}
          </Card>

          {/* ─── Gentle Reminder ──────────────────────────────────────────── */}
          <Card style={styles.card}>
            <Text variant="section">Gentle Reminder</Text>

            <View style={styles.clock}>
              <TimeField
                value={pad(time.hour)}
                label="Hour"
                onStep={(d) =>
                  setTime((t) => ({ ...t, hour: ((t.hour - 1 + d + 12) % 12) + 1 }))
                }
              />
              <Text variant="heading" color={t.textFaint}>
                :
              </Text>
              <TimeField
                value={pad(time.minute)}
                label="Minute"
                onStep={(d) =>
                  setTime((t) => ({ ...t, minute: (t.minute + d * 5 + 60) % 60 }))
                }
              />
              <TimeField
                value={time.period}
                label="AM or PM"
                onStep={() =>
                  setTime((t) => ({ ...t, period: t.period === 'AM' ? 'PM' : 'AM' }))
                }
              />
            </View>

            <View style={styles.toggleRow}>
              <Text variant="label" color={t.textMuted}>
                Notification Enabled
              </Text>
              <Switch
                value={reminderEnabled}
                onValueChange={setReminderEnabled}
                accessibilityLabel="Notification enabled"
                trackColor={{ false: t.border, true: t.accent }}
                thumbColor={t.onAccent}
                ios_backgroundColor={t.border}
              />
            </View>
          </Card>

          {formError ? (
            <View style={styles.formError} accessibilityLiveRegion="polite">
              <Text variant="label" color={t.danger}>
                {formError}
              </Text>
            </View>
          ) : null}

          <Button
            label="Create Habit"
            loading={saving}
            style={styles.cta}
            onPress={() => void submit()}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <IconPicker
        visible={iconSheet}
        selectedIcon={icon}
        accent={color}
        onSelect={setIcon}
        onClose={() => setIconSheet(false)}
      />

      <ColorPicker
        visible={colorSheet}
        selected={color}
        onSelect={setColor}
        onClose={() => setColorSheet(false)}
      />
    </SafeAreaView>
  );
}

/**
 * Tap steps the field forward; VoiceOver users get proper increment/decrement actions.
 * A wheel picker would be more familiar, but it cannot be styled to the design language
 * on both platforms, and this reads as the flip-clock tiles in the reference.
 */
function TimeField({
  value,
  label,
  onStep,
}: {
  value: string;
  label: string;
  onStep: (delta: number) => void;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <Touchable
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) =>
        onStep(event.nativeEvent.actionName === 'decrement' ? -1 : 1)
      }
      onPress={() => onStep(1)}
      style={styles.timeTile}
    >
      <Text variant="heading" color={t.onAccent}>
        {value}
      </Text>
    </Touchable>
  );
}

function ColorPicker({
  visible,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selected: string;
  onSelect: (color: string) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Touchable
          style={styles.flex}
          haptic={false}
          accessibilityRole="button"
          accessibilityLabel="Close colour picker"
          onPress={onClose}
        />

        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.handle} />

          <Text variant="heading" style={styles.sheetTitle}>
            Accent
          </Text>

          <View style={styles.swatches}>
            {HABIT_COLORS.map((value) => {
              const isSelected = value === selected;

              return (
                <Touchable
                  key={value}
                  accessibilityRole="button"
                  accessibilityLabel={`Accent colour ${value}`}
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => {
                    onSelect(value);
                    onClose();
                  }}
                  style={[
                    styles.swatchOption,
                    { backgroundColor: value },
                    ...(isSelected ? [{ borderColor: t.textPrimary }] : []),
                  ]}
                />
              );
            })}
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    flex: { flex: 1 },
    content: {
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing['3xl'],
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
    swatch: {
      width: 36,
      height: 36,
      borderRadius: radius.sm,
    },
    subtitle: { marginTop: spacing.xs },
    card: { marginTop: spacing.xl, gap: spacing.base },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    iconChip: {
      width: 52,
      height: 52,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pills: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    newCategory: { marginTop: spacing.xs },
    measures: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    segments: {
      flexDirection: 'row',
      padding: spacing.xs,
      borderRadius: radius.md,
      backgroundColor: t.surfaceRaised,
      borderWidth: 1,
      borderColor: t.border,
    },
    segment: {
      flex: 1,
      minHeight: MIN_TAP_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
    },
    goalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    stepper: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    stepButton: {
      width: MIN_TAP_TARGET,
      height: MIN_TAP_TARGET,
      borderRadius: radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.accentSoft,
    },
    clock: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    timeTile: {
      minWidth: MIN_TAP_TARGET,
      minHeight: MIN_TAP_TARGET,
      paddingHorizontal: spacing.md,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.accent,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderTopWidth: 1,
      borderTopColor: t.border,
      paddingTop: spacing.md,
    },
    formError: {
      marginTop: spacing.lg,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: t.surfaceRaised,
      borderWidth: 1,
      borderColor: t.danger,
    },
    cta: { marginTop: spacing.xl },
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: t.scrim,
    },
    // A real bottom sheet: transparent Modal, slides up over the scrim.
    sheet: {
      backgroundColor: t.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      paddingBottom: spacing.xl,
    },
    handle: {
      alignSelf: 'center',
      width: 96,
      height: 6,
      borderRadius: radius.full,
      backgroundColor: t.border,
    },
    sheetTitle: { marginTop: spacing.lg },
    swatches: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.md,
      marginTop: spacing.lg,
    },
    swatchOption: {
      width: 56,
      height: 56,
      borderRadius: radius.md,
      borderWidth: 3,
      borderColor: 'transparent',
    },
  });
