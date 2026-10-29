import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  StyleSheet,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  formatHabitProgress,
  formatHabitTarget,
  HABIT_MEASURES,
  measureOf,
  type TodayResponse,
} from '@synitheia/shared';
import { Button, Chip, Text, Touchable } from '../components/primitives.js';
import { accentFor, radius, spacing, type } from '../theme/theme.js';
import type { Theme } from '../theme/theme.js';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider.js';
import { addAmount, amountScale, parseAmount, quickAmounts, snapAmount } from './logAmount.js';

type TodayHabit = TodayResponse['habits'][number];

interface Props {
  habit: TodayHabit | null;
  onClose: () => void;
  onSave: (habit: TodayHabit, count: number) => void;
}

const THUMB = 28;

/**
 * Logging a measured habit by its real amount: drag to today's total, add a usual amount with
 * one tap, or type it, then save it once. Replaces a "+" that only ever added 5 minutes or 500
 * steps. There is no ceiling: the slider's range grows with the amount after each change.
 */
export function LogAmountSheet({ habit, onClose, onSave }: Props) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [value, setValue] = useState(0);
  // The amount the slider's range is sized around. It moves only between gestures, so the
  // rail never rescales under a finger mid-drag.
  const [rangeFor, setRangeFor] = useState(0);
  const [draft, setDraft] = useState<string | null>(null);
  const width = useRef(0);
  const origin = useRef(0);
  const lastSnap = useRef(0);

  useEffect(() => {
    if (habit) {
      setValue(habit.todayCount);
      setRangeFor(habit.todayCount);
      setDraft(null);
      lastSnap.current = habit.todayCount;
    }
  }, [habit]);

  const scale = useMemo(
    () => (habit ? amountScale({ ...habit, todayCount: Math.max(habit.todayCount, rangeFor) }) : { step: 1, max: 1 }),
    [habit, rangeFor],
  );
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const setFromX = (x: number) => {
    if (width.current <= 0) return;
    const next = snapAmount((x / width.current) * scaleRef.current.max, scaleRef.current);
    if (next !== lastSnap.current) {
      lastSnap.current = next;
      void Haptics.selectionAsync();
    }
    setValue(next);
  };

  // Plain PanResponder: gesture-handler needs its own root inside a Modal on Android.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        // Measured from where the touch began, so a finger drifting off the rail keeps going.
        onPanResponderGrant: (e) => {
          origin.current = e.nativeEvent.pageX - e.nativeEvent.locationX;
          setFromX(e.nativeEvent.locationX);
        },
        onPanResponderMove: (_e, g) => setFromX(g.moveX - origin.current),
        onPanResponderRelease: () => setRangeFor(lastSnap.current),
        onPanResponderTerminate: () => setRangeFor(lastSnap.current),
      }),
    [],
  );

  if (!habit) return null;

  const measure = measureOf(habit);
  const unit = habit.unit ?? HABIT_MEASURES[measure].unit ?? '';
  const accent = accentFor(habit.color, t);
  const fraction = Math.min(1, value / scale.max);

  const setExactly = (next: number) => {
    lastSnap.current = next;
    setValue(next);
    setRangeFor(next);
  };

  const commitDraft = () => {
    if (draft !== null) {
      const typed = parseAmount(draft);
      if (typed !== null) setExactly(typed);
    }
    setDraft(null);
  };
  const targetFraction = Math.min(1, habit.targetCount / scale.max);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
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
          <Text variant="cardTitle" style={styles.title}>
            {habit.name}
          </Text>
          <Text variant="caption" color={t.textMuted}>
            Today
          </Text>

          {/* The count is a field: any amount can be typed, not only what the slider reaches. */}
          <View style={styles.valueRow}>
            <TextInput
              value={draft ?? value.toLocaleString()}
              onFocus={() => setDraft(String(value))}
              onChangeText={setDraft}
              onBlur={commitDraft}
              onSubmitEditing={commitDraft}
              keyboardType="number-pad"
              returnKeyType="done"
              selectTextOnFocus
              selectionColor={accent.base}
              maxLength={7}
              accessibilityLabel={`${habit.name} today, in ${unit || 'count'}`}
              style={[styles.valueInput, { color: t.textPrimary, borderBottomColor: accent.base }]}
            />
            <Text variant="title" color={t.textMuted}>
              {` / ${formatHabitTarget(habit)}`}
            </Text>
          </View>

          <View
            style={styles.track}
            onLayout={(e: LayoutChangeEvent) => (width.current = e.nativeEvent.layout.width)}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={`${habit.name} today`}
            accessibilityValue={{ text: formatHabitProgress(habit, value) }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(e) =>
              setExactly(
                addAmount(value, (e.nativeEvent.actionName === 'increment' ? 1 : -1) * HABIT_MEASURES[measure].step),
              )
            }
            {...pan.panHandlers}
          >
            <View pointerEvents="none" style={styles.rail}>
              <View style={[styles.fill, { width: `${fraction * 100}%`, backgroundColor: accent.base }]} />
            </View>
            <View pointerEvents="none" style={[styles.goal, { left: `${targetFraction * 100}%` }]} />
            <View
              pointerEvents="none"
              style={[styles.thumb, { left: `${fraction * 100}%`, borderColor: accent.base }]}
            />
          </View>

          <View style={styles.chips}>
            {quickAmounts(measure).map((amount) => (
              <Chip
                key={amount}
                label={`+${amount.toLocaleString()} ${unit}`.trim()}
                onPress={() => setExactly(addAmount(value, amount))}
              />
            ))}
            <Chip label="Clear" onPress={() => setExactly(0)} />
          </View>

          <Button
            label="Save"
            style={styles.save}
            disabled={value === habit.todayCount && draft === null}
            onPress={() => {
              const typed = draft === null ? null : parseAmount(draft);
              const count = typed ?? value;
              if (count !== habit.todayCount) onSave(habit, count);
              onClose();
            }}
          />
        </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: t.scrim },
    backdropDismiss: { flex: 1 },
    sheet: {
      backgroundColor: t.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      paddingBottom: spacing.base,
    },
    handle: { alignSelf: 'center', width: 96, height: 6, borderRadius: radius.full, backgroundColor: t.border },
    title: { marginTop: spacing.lg },
    valueRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'center',
      marginTop: spacing.xl,
    },
    // Underlined so it reads as something to tap and type into, not a label.
    valueInput: { ...type.title, minWidth: 48, textAlign: 'center', borderBottomWidth: 2, paddingVertical: 0 },
    // Tall enough to grab anywhere along it, not only on the thumb.
    track: { height: 56, justifyContent: 'center', marginTop: spacing.lg, marginHorizontal: THUMB / 2 },
    rail: { height: 8, borderRadius: radius.full, backgroundColor: t.surfaceRaised, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: radius.full },
    goal: { position: 'absolute', width: 2, height: 18, marginLeft: -1, backgroundColor: t.textMuted, borderRadius: 1 },
    thumb: {
      position: 'absolute',
      width: THUMB,
      height: THUMB,
      marginLeft: -THUMB / 2,
      borderRadius: THUMB / 2,
      borderWidth: 3,
      backgroundColor: t.bg,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
    save: { marginTop: spacing.xl },
  });
