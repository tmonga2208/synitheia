import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBackOrHome } from '../../src/navigation/goBackOrHome.js';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, ChevronUp, Minus, Plus } from 'lucide-react-native';
import {
  HABIT_COLORS,
  HABIT_MEASURES,
  createHabitSchema,
  type Habit,
  type HabitFrequency,
  type HabitMeasure,
} from '@synitheia/shared';
import { Button, Card, Chip, Input, Text, Touchable } from '../../src/components/primitives.js';
import { DEFAULT_ICON, IconPicker, iconFor } from '../../src/components/IconPicker.js';
import { api } from '../../src/api/client.js';
import { errorLine } from '../../src/api/errorCopy.js';
import { askForNotifications, type NotificationAccess } from '../../src/reminders/permission.js';
import { MIN_TAP_TARGET, radius, spacing } from '../../src/theme/theme.js';
import { useTheme, useThemedStyles } from '../../src/theme/ThemeProvider.js';
import { accentFor, type Theme } from '../../src/theme/theme.js';

const BASE_CATEGORIES = ['Mindfulness', 'Health'] as const;

/** A word under each way of tracking, so the choice explains itself. */
const MEASURE_HINT: Record<HabitMeasure, string> = {
  check: 'Tick it off',
  count: 'Glasses, pages…',
  duration: 'Minutes',
  steps: 'From your phone',
};

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

/*
 * The habit's reminder is not scheduled here: it is planned with every other one
 * (src/reminders) from the habit's reminder time, which the server keeps, so it also comes
 * back on a new phone. This screen only asks for permission, the one moment it makes sense.
 */

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
      unit: measure === 'check' ? null : unit?.trim() || spec.unit,
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
      // Before saving: the save re-plans reminders, and it should know the answer.
      const access: NotificationAccess | null = reminderEnabled
        ? await askForNotifications().catch(() => null)
        : null;

      await api.post<{ habit: Habit }>('/habits', parsed.data);

      if (access === 'blocked') {
        // The habit is fine; its reminder is what cannot arrive. Say so, with the way out.
        Alert.alert(
          'Notifications are off',
          "The habit is saved, but notifications are off for Synítheia, so its reminder won't appear. You can turn them on in Settings.",
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open Settings', onPress: () => void Linking.openSettings() },
          ],
        );
      }

      /**
       * The lists are cached. Without this, going back lands on a Habits screen that does
       * not contain the habit you just created — it exists on the server, it is simply not
       * in the cache, so it only appears after a pull-to-refresh. It reads as a failed save.
       */
      await queryClient.invalidateQueries({ queryKey: ['habits'] });
      await queryClient.invalidateQueries({ queryKey: ['today'] });

      goBackOrHome(router);
    } catch (error) {
      setFormError(errorLine(error, 'Couldn’t create this habit'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
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
              onPress={() => goBackOrHome(router)}
            >
              <ArrowLeft size={22} color={t.textPrimary} />
            </Touchable>
          </View>

          <Text variant="title">New habit</Text>
          <Text variant="body" color={t.textMuted} style={styles.subtitle}>
            Something small you want to do regularly.
          </Text>

          {/* ─── Name, icon, colour, category ─────────────────────────────── */}
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

            {/* On the screen, not behind an unlabelled square in the corner. */}
            <Text variant="label" color={t.textMuted}>
              Colour
            </Text>
            <View style={styles.colours} accessibilityRole="radiogroup">
              {HABIT_COLORS.map((value) => {
                const isSelected = value === color;
                return (
                  <Touchable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityLabel={`Colour ${value}`}
                    accessibilityState={{ selected: isSelected }}
                    haptic={false}
                    onPress={() => setColor(value)}
                    style={[
                      styles.colour,
                      { backgroundColor: value },
                      isSelected && { borderColor: t.textPrimary },
                    ]}
                  />
                );
              })}
            </View>

            <Text variant="label" color={t.textMuted}>
              Category (optional)
            </Text>
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

          {/* ─── How often ────────────────────────────────────────────────── */}
          <Card style={styles.card}>
            <Text variant="section">How often</Text>

            <View style={styles.segments} accessibilityRole="tablist">
              {(['daily', 'weekly'] as const).map((value) => {
                const active = frequency === value;
                const label = value === 'daily' ? 'Every day' : 'Every week';

                return (
                  <Touchable
                    key={value}
                    accessibilityRole="tab"
                    accessibilityLabel={label}
                    accessibilityState={{ selected: active }}
                    onPress={() => setFrequency(value)}
                    style={[styles.segment, active && { backgroundColor: t.accent }]}
                  >
                    <Text variant="bodyMedium" color={active ? t.onAccent : t.textMuted}>
                      {label}
                    </Text>
                  </Touchable>
                );
              })}
            </View>
          </Card>

          {/* ─── How you'll track it ──────────────────────────────────────── */}
          {/* Separate from how often: they were one box, and "Steps" wrapped onto a line alone. */}
          <Card style={styles.card}>
            <Text variant="section">How you’ll track it</Text>

            <View style={styles.measureGrid}>
              {(Object.keys(HABIT_MEASURES) as HabitMeasure[]).map((key) => {
                const active = measure === key;
                return (
                  <Touchable
                    key={key}
                    accessibilityRole="radio"
                    accessibilityLabel={`Track by ${HABIT_MEASURES[key].label}`}
                    accessibilityState={{ selected: active }}
                    onPress={() => pickMeasure(key)}
                    style={[
                      styles.measure,
                      active && { borderColor: accent.base, backgroundColor: accent.wash },
                    ]}
                  >
                    <Text variant="bodyMedium" color={active ? accent.text : t.textPrimary}>
                      {HABIT_MEASURES[key].label}
                    </Text>
                    <Text variant="caption" color={t.textMuted}>
                      {MEASURE_HINT[key]}
                    </Text>
                  </Touchable>
                );
              })}
            </View>

            {/* A tick has no goal to set — 'done' is the only target it can have. */}
            {measure === 'check' ? null : (
              <View style={styles.goalRow}>
                <Text variant="body" color={t.textMuted}>
                  Goal{'  '}
                  <Text variant="bodyMedium" color={t.textPrimary}>
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

          {/* ─── Reminder ─────────────────────────────────────────────────── */}
          <Card style={styles.card}>
            <View style={styles.toggleRow}>
              <Text variant="section">Remind me</Text>
              <Switch
                value={reminderEnabled}
                onValueChange={setReminderEnabled}
                accessibilityLabel="Remind me"
                trackColor={{ false: t.border, true: t.accent }}
                thumbColor={t.onAccent}
                ios_backgroundColor={t.border}
              />
            </View>

            {reminderEnabled ? (
              <View style={styles.clock}>
                <TimeField
                  value={pad(time.hour)}
                  label="Hour"
                  onStep={(d) => setTime((t) => ({ ...t, hour: ((t.hour - 1 + d + 12) % 12) + 1 }))}
                />
                <Text variant="heading" color={t.textFaint}>
                  :
                </Text>
                <TimeField
                  value={pad(time.minute)}
                  label="Minute"
                  onStep={(d) => setTime((t) => ({ ...t, minute: (t.minute + d * 5 + 60) % 60 }))}
                />
                <TimeField
                  value={time.period}
                  label="AM or PM"
                  onStep={() => setTime((t) => ({ ...t, period: t.period === 'AM' ? 'PM' : 'AM' }))}
                />
              </View>
            ) : null}
          </Card>

          {formError ? (
            <View style={styles.formError} accessibilityLiveRegion="polite">
              <Text variant="label" color={t.danger}>
                {formError}
              </Text>
            </View>
          ) : null}

          <Button
            label="Create habit"
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
    </SafeAreaView>
  );
}

/**
 * One part of the reminder time, with an arrow above to step up and one below to step
 * down. It used to only step forward on a tap, so 7:30 PM to 8:00 AM took dozens of taps.
 * VoiceOver users get increment and decrement actions on the tile itself.
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
    <View style={styles.timeColumn}>
      <Touchable
        accessibilityRole="button"
        accessibilityLabel={`${label} up`}
        haptic={false}
        onPress={() => onStep(1)}
        style={styles.timeArrow}
      >
        <ChevronUp size={20} color={t.textMuted} />
      </Touchable>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: value }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) =>
          onStep(event.nativeEvent.actionName === 'decrement' ? -1 : 1)
        }
        style={styles.timeTile}
      >
        <Text variant="heading" color={t.onAccent}>
          {value}
        </Text>
      </View>
      <Touchable
        accessibilityRole="button"
        accessibilityLabel={`${label} down`}
        haptic={false}
        onPress={() => onStep(-1)}
        style={styles.timeArrow}
      >
        <ChevronDown size={20} color={t.textMuted} />
      </Touchable>
    </View>
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
    colours: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    colour: {
      width: 32,
      height: 32,
      borderRadius: radius.full,
      borderWidth: 2,
      borderColor: 'transparent',
    },
    measureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    measure: {
      flexBasis: '47%',
      flexGrow: 1,
      gap: 2,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surfaceRaised,
    },
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
    timeColumn: { alignItems: 'center' },
    timeArrow: {
      width: MIN_TAP_TARGET,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
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
  });
