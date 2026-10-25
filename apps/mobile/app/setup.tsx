import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { ArrowLeft, Check } from 'lucide-react-native';
import { STARTER_HABITS, parseMoneyInput, type TrackedDomain } from '@synitheia/shared';
import { Button, Card, Chip, Input, Text, Touchable } from '../src/components/primitives.js';
import { iconFor } from '../src/components/IconPicker.js';
import { ApiError, api } from '../src/api/client.js';
import { useAuth } from '../src/store/auth.js';
import { radius, spacing } from '../src/theme/theme.js';
import { useTheme, useThemedStyles } from '../src/theme/ThemeProvider.js';
import { accentFor, type Theme } from '../src/theme/theme.js';

/**
 * Setup.
 *
 * Every question earns its place by changing what the user sees on their FIRST screen.
 * Nothing is asked to be thorough, and nothing is asked that can be inferred — the
 * timezone comes from the device, the currency from the locale, the greeting from the name
 * they already gave at sign-up.
 *
 * Two questions do almost all the work:
 *
 *   1. WHAT DO YOU TRACK. The Daily Flow ring is scored only against these. Without it, a
 *      habits-only user was permanently capped at 50% by a water tracker they never asked
 *      for — `waterTargetMl` always has a default, so "has a target" was always true.
 *
 *   2. PICK A FEW HABITS. The highest-leverage thing onboarding can do is make sure Today
 *      is NOT empty on day one. An empty ring at 0% is the app failing to demonstrate its
 *      own premise at the exact moment it has to. Picking from a list is one tap; inventing
 *      a habit from a blank field is a decision most people defer forever.
 *
 * Everything else arrives pre-filled with a sane default, so "Continue" is always a valid
 * answer. Targets are a starting point, not an interrogation.
 */

const DOMAINS: { key: TrackedDomain; label: string; blurb: string }[] = [
  { key: 'habits', label: 'Habits', blurb: 'Daily rituals and streaks' },
  { key: 'expenses', label: 'Money', blurb: 'Spending, bills, splits' },
  { key: 'nutrition', label: 'Food', blurb: 'Meals and calories' },
  { key: 'water', label: 'Water', blurb: 'Daily hydration' },
];

const ACCENT_COLOR = '#7D927D';
const TIMES = ['07:00', '08:30', '12:00', '18:00', '21:00'];

export default function Setup() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const ACCENT = accentFor(ACCENT_COLOR, t);
  const user = useAuth((s) => s.user);
  const hydrate = useAuth((s) => s.hydrate);
  const currency = user?.currency ?? 'INR';

  const [step, setStep] = useState(0);
  const [domains, setDomains] = useState<TrackedDomain[]>(['habits']);
  const [habits, setHabits] = useState<string[]>([]);
  const [water, setWater] = useState('2500');
  const [calories, setCalories] = useState('2000');
  const [budget, setBudget] = useState('');
  const [reminder, setReminder] = useState<string | null>('08:30');
  const [error, setError] = useState<string | null>(null);

  const tracks = (d: TrackedDomain) => domains.includes(d);

  /**
   * Only the steps the user's own choices make relevant. Someone who tracks habits alone
   * answers two questions and is done — the money, food, and water screens are not skipped
   * past, they are never built.
   */
  const steps: ('domains' | 'habits' | 'targets' | 'reminder')[] = [
    'domains',
    ...(tracks('habits') ? (['habits'] as const) : []),
    ...(tracks('water') || tracks('nutrition') || tracks('expenses')
      ? (['targets'] as const)
      : []),
    'reminder',
  ];

  const current = steps[Math.min(step, steps.length - 1)]!;
  const isLast = step >= steps.length - 1;

  const finish = useMutation({
    mutationFn: () =>
      api.post<unknown>('/me/onboarded', {
        trackedDomains: domains,
        habits: STARTER_HABITS.filter((h) => habits.includes(h.name)).map((h) => ({
          name: h.name,
          icon: h.icon,
          color: h.color,
        })),
        ...(tracks('water') ? { waterTargetMl: Number(water) || 2500 } : {}),
        ...(tracks('nutrition') ? { calorieTarget: Number(calories) || 2000 } : {}),
        ...(tracks('expenses')
          ? { monthlyBudgetMinor: parseMoneyInput(budget, currency) ?? null }
          : {}),
        reminderTime: reminder,
      }),

    onSuccess: async () => {
      // Re-read the user, or the router keeps sending them back here.
      await hydrate();
      router.replace('/');
    },

    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not save your setup.');
    },
  });

  function toggleDomain(d: TrackedDomain) {
    setDomains((prev) => {
      if (!prev.includes(d)) return [...prev, d];
      // Never let them end up tracking nothing — the app would have nothing to show.
      return prev.length > 1 ? prev.filter((x) => x !== d) : prev;
    });
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1 }}
      >
        <View style={styles.header}>
          {step > 0 ? (
            <Touchable
              onPress={() => setStep((s) => s - 1)}
              style={styles.back}
              haptic={false}
              accessibilityRole="button"
              accessibilityLabel="Go back a step"
            >
              <ArrowLeft size={22} color={t.textPrimary} strokeWidth={1.8} />
            </Touchable>
          ) : (
            <View style={styles.back} />
          )}

          <View style={styles.progress}>
            {steps.map((s, i) => (
              <View
                key={s}
                style={[
                  styles.pip,
                  i === step && [styles.pipActive, { backgroundColor: ACCENT.base }],
                  i < step && { backgroundColor: t.accentSoft },
                ]}
              />
            ))}
          </View>

          <View style={styles.back} />
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View key={current} entering={FadeIn.duration(220)} exiting={FadeOut}>
            {current === 'domains' ? (
              <>
                <Text variant="title">What do you want to track?</Text>
                <Text variant="body" color={t.textMuted} style={styles.sub}>
                  Only what you pick shows up. You can change this later.
                </Text>

                <View style={styles.domains}>
                  {DOMAINS.map((d) => {
                    const on = tracks(d.key);

                    return (
                      <Touchable
                        key={d.key}
                        style={[
                          styles.domain,
                          on && { borderColor: ACCENT.base, backgroundColor: ACCENT.wash },
                        ]}
                        onPress={() => toggleDomain(d.key)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={`${d.label}. ${d.blurb}`}
                      >
                        <View style={{ flex: 1 }}>
                          <Text variant="cardTitle">{d.label}</Text>
                          <Text variant="caption" color={t.textMuted}>
                            {d.blurb}
                          </Text>
                        </View>

                        <View
                          style={[
                            styles.tick,
                            on && { backgroundColor: ACCENT.base, borderColor: ACCENT.base },
                          ]}
                        >
                          {on ? <Check size={14} color={t.onAccent} strokeWidth={3} /> : null}
                        </View>
                      </Touchable>
                    );
                  })}
                </View>
              </>
            ) : null}

            {current === 'habits' ? (
              <>
                <Text variant="title">Pick a couple to start</Text>
                <Text variant="body" color={t.textMuted} style={styles.sub}>
                  Two or three is plenty. You can add your own later.
                </Text>

                <View style={styles.habits}>
                  {STARTER_HABITS.map((h) => {
                    const on = habits.includes(h.name);
                    const accent = accentFor(h.color, t);
                    const { Icon } = iconFor(h.icon);

                    return (
                      <Touchable
                        key={h.name}
                        style={[
                          styles.habit,
                          on && { borderColor: accent.base, backgroundColor: accent.wash },
                        ]}
                        onPress={() =>
                          setHabits((prev) =>
                            prev.includes(h.name)
                              ? prev.filter((x) => x !== h.name)
                              : [...prev, h.name],
                          )
                        }
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={h.name}
                      >
                        <Icon
                          size={20}
                          color={on ? accent.text : t.textMuted}
                          strokeWidth={1.7}
                        />
                        <Text
                          variant="caption"
                          color={on ? accent.text : t.textMuted}
                          center
                        >
                          {h.name}
                        </Text>
                      </Touchable>
                    );
                  })}
                </View>

                {/*
                  Skipping is fine, and it says so. Nagging someone into a habit they did
                  not choose is how a tracker becomes an app you avoid opening.
                */}
                {habits.length === 0 ? (
                  <Text variant="caption" color={t.textFaint} center style={styles.hint}>
                    Skip if you like — you can add habits any time.
                  </Text>
                ) : null}
              </>
            ) : null}

            {current === 'targets' ? (
              <>
                <Text variant="title">A few numbers</Text>
                <Text variant="body" color={t.textMuted} style={styles.sub}>
                  Sensible defaults are filled in. Change them, or carry on.
                </Text>

                <Card style={styles.card}>
                  {tracks('water') ? (
                    <Input
                      label="Water each day (ml)"
                      value={water}
                      onChangeText={setWater}
                      keyboardType="number-pad"
                      accessibilityLabel="Daily water target in millilitres"
                    />
                  ) : null}

                  {tracks('nutrition') ? (
                    <Input
                      label="Calories each day"
                      value={calories}
                      onChangeText={setCalories}
                      keyboardType="number-pad"
                      accessibilityLabel="Daily calorie target"
                    />
                  ) : null}

                  {tracks('expenses') ? (
                    <Input
                      label={`Monthly budget (optional)`}
                      value={budget}
                      onChangeText={setBudget}
                      keyboardType="decimal-pad"
                      placeholder="Leave blank for none"
                      accessibilityLabel="Monthly budget"
                    />
                  ) : null}
                </Card>
              </>
            ) : null}

            {current === 'reminder' ? (
              <>
                <Text variant="title">One nudge a day?</Text>
                <Text variant="body" color={t.textMuted} style={styles.sub}>
                  A single reminder, at a time you choose. Not a stream of them.
                </Text>

                <View style={styles.times}>
                  {TIMES.map((time) => (
                    <Chip
                      key={time}
                      label={time}
                      selected={reminder === time}
                      onPress={() => setReminder(time)}
                      accessibilityLabel={`Remind me at ${time}`}
                    />
                  ))}

                  <Chip
                    label="No thanks"
                    selected={reminder === null}
                    onPress={() => setReminder(null)}
                    accessibilityLabel="No reminders"
                  />
                </View>
              </>
            ) : null}
          </Animated.View>

          {error ? (
            <Text variant="caption" color={t.danger} style={styles.hint}>
              {error}
            </Text>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Button
            label={isLast ? "Let's go" : 'Continue'}
            trailingArrow={!isLast}
            loading={finish.isPending}
            onPress={() => (isLast ? finish.mutate() : setStep((s) => s + 1))}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      minHeight: 56,
    },
    back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    progress: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    pip: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: t.border },
    // Active/done fills use ACCENT, a runtime value — applied inline at the call site.
    pipActive: { width: 26 },

    content: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.xl },
    sub: { marginTop: spacing.sm, marginBottom: spacing.xl },
    hint: { marginTop: spacing.lg },

    domains: { gap: spacing.md },
    domain: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.lg,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface,
    },
    tick: {
      width: 24,
      height: 24,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: t.border,
      alignItems: 'center',
      justifyContent: 'center',
    },

    habits: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
    habit: {
      width: '30%',
      minHeight: 92,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      padding: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface,
    },

    card: { gap: spacing.base },
    times: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    footer: { padding: spacing.lg },
  });
