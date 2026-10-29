import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { ChevronDown } from 'lucide-react-native';
import {
  EVENT_TYPE_LABEL,
  asMinor,
  formatMoney,
  type EventMetadata,
  type PersonalEvent,
  formatVolume,
} from '@synitheia/shared';
import { Card, Text, Touchable } from './primitives.js';
import { motion, radius, spacing } from '../theme/theme.js';
import { useTheme } from '../theme/ThemeProvider.js';

interface TimelineProps {
  events: PersonalEvent[];
  /** The user's IANA zone. Never the device's — history stays anchored to the user. */
  timezone: string;
}

/**
 * `isoInstantSchema` is `z.coerce.date()`, so the *type* is Date — but the value that
 * actually crosses the wire is an ISO string, and nothing re-parses it on the client.
 * Accepting both is the honest signature.
 */
function toInstant(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function roundedInt(n: number): number {
  return Math.round(n);
}

function durationText(minutes: number): string {
  const total = roundedInt(minutes);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) return `${mins} min`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/** A timeline line: what happened, and its number, which sits on the right. */
interface Line {
  text: string;
  value?: string;
}

/**
 * A PersonalEvent as a short line: the thing on the left, its amount on the right.
 *
 * Kept short on purpose. A day reads as a list of names with their numbers lined up,
 * not as a column of sentences — "Metro card ₹489" scans, "₹489 spent at Metro card ·
 * Transport" has to be read.
 *
 * Exhaustive over the discriminated union so a new event type is a type error here, not a
 * silent fallback in production; EVENT_TYPE_LABEL only ever covers a genuinely unknown
 * payload.
 */
function describe(metadata: EventMetadata, numbers: Intl.NumberFormat): Line {
  switch (metadata.type) {
    case 'expense.created':
      return {
        text: metadata.merchant || metadata.categoryName,
        value: formatMoney(asMinor(metadata.amountMinor), metadata.currency),
      };
    case 'expense.detected':
      return {
        text: metadata.merchant || 'A charge',
        value: formatMoney(asMinor(metadata.amountMinor), metadata.currency),
      };
    case 'habit.completed':
      return { text: metadata.habitName, value: 'Done' };
    case 'habit.missed':
      return { text: metadata.habitName, value: 'Missed' };
    case 'food.logged':
      return {
        text: metadata.foodName,
        value: `${numbers.format(roundedInt(metadata.calories))} kcal`,
      };
    case 'water.logged':
      return { text: 'Water', value: formatVolume(metadata.amountMl) };
    case 'workout.detected':
      return { text: metadata.activity, value: durationText(metadata.durationMin) };
    case 'steps.recorded':
      return { text: 'Steps', value: numbers.format(metadata.steps) };
    case 'sleep.detected':
      return { text: 'Sleep', value: durationText(metadata.durationMin) };
    case 'location.arrived':
      return {
        text: metadata.placeLabel
          ? `Arrived at ${metadata.placeLabel}`
          : 'Arrived somewhere new',
      };
    case 'location.departed':
      return {
        text: metadata.placeLabel ? `Left ${metadata.placeLabel}` : 'Left',
        value: durationText(metadata.dwellMin),
      };
    case 'calendar.started':
      return {
        text: metadata.title,
        value: metadata.isAllDay ? 'All day' : durationText(metadata.durationMin),
      };
    case 'calendar.completed':
      return { text: `${metadata.title} ended` };
    case 'reminder.completed':
      return { text: metadata.label, value: 'Done' };
    case 'weather.observed': {
      const condition = metadata.conditionCode.replace(/[_-]/g, ' ');
      return {
        text: condition.charAt(0).toUpperCase() + condition.slice(1),
        value: `${roundedInt(metadata.tempC)}°C`,
      };
    }
    case 'weight.logged':
      return { text: 'Weighed', value: `${metadata.weightKg.toFixed(1)} kg` };
  }
}

/**
 * Which part of life an event belongs to.
 *
 * The old rail painted every dot the same green — food, money, steps and habits all looked
 * identical, so the timeline was throwing away information it already had. Colour is the
 * cheapest possible way to make a day scannable rather than merely readable.
 */
type Domain = 'money' | 'food' | 'habit' | 'body' | 'water' | 'other';

const DOMAIN_COLOR: Record<Domain, string> = {
  money: '#C08A7D',
  food: '#B0917D',
  habit: '#7D927D',
  body: '#8A9AA9',
  water: '#8A9AA9',
  other: '#A3A3A0',
};

function domainOf(type: PersonalEvent['type']): Domain {
  if (type.startsWith('expense')) return 'money';
  if (type.startsWith('habit')) return 'habit';
  if (type === 'food.logged') return 'food';
  if (type === 'water.logged') return 'water';
  if (
    type === 'steps.recorded' ||
    type === 'sleep.detected' ||
    type === 'workout.detected' ||
    type === 'weight.logged'
  ) {
    return 'body';
  }
  return 'other';
}

// ─── Parts of the day ────────────────────────────────────────────────────────

interface Part {
  key: string;
  label: string;
  /** Local hour this part opens at. */
  from: number;
  to: number;
}

const PARTS: Part[] = [
  { key: 'morning', label: 'Morning', from: 0, to: 12 },
  { key: 'afternoon', label: 'Afternoon', from: 12, to: 17 },
  { key: 'evening', label: 'Evening', from: 17, to: 24 },
];

interface Bucket {
  part: Part;
  events: PersonalEvent[];
  kcal: number;
  spentMinor: number;
  currency: string;
  habits: number;
  steps: number;
  waterMl: number;
  waterLogs: number;
}

/**
 * The one line that has to earn the whole block.
 *
 * Names what happened, in the units the user thinks in, and ROLLS UP repeats — "4 habits"
 * rather than four identical rows, "1.2 L water" rather than six. Repetition was most of
 * what made the old list long, and none of what made it useful.
 */
function summarize(bucket: Bucket, numbers: Intl.NumberFormat): string {
  const parts: string[] = [];

  if (bucket.habits > 0) {
    parts.push(`${bucket.habits} habit${bucket.habits === 1 ? '' : 's'}`);
  }
  if (bucket.spentMinor > 0) {
    parts.push(formatMoney(asMinor(bucket.spentMinor), bucket.currency));
  }
  if (bucket.kcal > 0) parts.push(`${numbers.format(roundedInt(bucket.kcal))} kcal`);
  if (bucket.steps > 0) parts.push(`${numbers.format(bucket.steps)} steps`);
  if (bucket.waterMl > 0) {
    parts.push(
      bucket.waterMl >= 1000
        ? `${(bucket.waterMl / 1000).toFixed(1)} L water`
        : `${formatVolume(bucket.waterMl)} water`,
    );
  }

  return parts.join(' · ');
}

export function Timeline({ events, timezone }: TimelineProps) {
  const t = useTheme();
  const time = useMemo(
    () =>
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: timezone,
      }),
    [timezone],
  );

  const hourFormat = useMemo(
    () =>
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: timezone,
      }),
    [timezone],
  );

  const numbers = useMemo(() => new Intl.NumberFormat('en-US'), []);

  const buckets = useMemo<Bucket[]>(() => {
    const made: Bucket[] = PARTS.map((part) => ({
      part,
      events: [],
      kcal: 0,
      spentMinor: 0,
      currency: 'INR',
      habits: 0,
      steps: 0,
      waterMl: 0,
      waterLogs: 0,
    }));

    for (const event of events) {
      // The user's hour, not the device's — a trip abroad must not reshuffle their day.
      const hour = Number(hourFormat.format(toInstant(event.timestamp)));
      const bucket =
        made.find((b) => hour >= b.part.from && hour < b.part.to) ?? made[2]!;

      bucket.events.push(event);

      const meta = event.metadata;
      if (meta.type === 'expense.created' || meta.type === 'expense.detected') {
        bucket.spentMinor += meta.amountMinor;
        bucket.currency = meta.currency;
      } else if (meta.type === 'food.logged') {
        bucket.kcal += meta.calories;
      } else if (meta.type === 'habit.completed') {
        bucket.habits += 1;
      } else if (meta.type === 'steps.recorded') {
        bucket.steps = Math.max(bucket.steps, meta.steps);
      } else if (meta.type === 'water.logged') {
        bucket.waterMl += meta.amountMl;
        bucket.waterLogs += 1;
      }
    }

    return made.filter((b) => b.events.length > 0);
  }, [events, hourFormat]);

  /**
   * Open the part of the day the user is actually IN.
   *
   * Everything before now is history they lived; the block that matters is the one still
   * being written. Opening all three would just rebuild the wall of rows this replaced.
   */
  const nowHour = Number(hourFormat.format(new Date()));
  const currentKey =
    PARTS.find((p) => nowHour >= p.from && nowHour < p.to)?.key ?? 'evening';

  const [open, setOpen] = useState<string | null>(currentKey);

  if (events.length === 0) {
    return (
      <Card style={styles.empty}>
        <Text variant="cardTitle" center>
          A quiet day so far
        </Text>
        <Text variant="body" color={t.textMuted} center style={styles.emptyBody}>
          Log a habit, a glass of water, or an expense and your day will start filling in
          here.
        </Text>
      </Card>
    );
  }

  return (
    <View accessibilityRole="list">
      {buckets.map((bucket) => (
        <PartBlock
          key={bucket.part.key}
          bucket={bucket}
          open={open === bucket.part.key}
          onToggle={() =>
            setOpen((current) => (current === bucket.part.key ? null : bucket.part.key))
          }
          time={time}
          numbers={numbers}
        />
      ))}
    </View>
  );
}

function PartBlock({
  bucket,
  open,
  onToggle,
  time,
  numbers,
}: {
  bucket: Bucket;
  open: boolean;
  onToggle: () => void;
  time: Intl.DateTimeFormat;
  numbers: Intl.NumberFormat;
}) {
  const t = useTheme();
  const chevron = useSharedValue(open ? 1 : 0);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevron.value * 180}deg` }],
  }));

  function toggle() {
    chevron.value = withSpring(open ? 0 : 1, motion.spring);
    onToggle();
  }

  const summary = summarize(bucket, numbers);

  /**
   * Water, folded into ONE row.
   *
   * Six "250 ml water" rows is the single biggest source of noise in a real day, and it
   * says nothing that "1.2 L across 6 glasses" does not say better.
   */
  const rows = bucket.events.filter((e) => e.metadata.type !== 'water.logged');
  const dots = [...new Set(bucket.events.map((e) => domainOf(e.type)))];

  return (
    <Card padded={false} style={styles.block}>
      <Touchable
        onPress={toggle}
        haptic={false}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${bucket.part.label}. ${summary}.`}
        accessibilityHint={open ? 'Tap to collapse' : 'Tap to see everything'}
        style={styles.head}
      >
        <View style={styles.dots}>
          {dots.map((d) => (
            <View key={d} style={[styles.dot, { backgroundColor: DOMAIN_COLOR[d] }]} />
          ))}
        </View>

        <View style={styles.headCopy}>
          <Text variant="overline" color={t.textMuted}>
            {bucket.part.label}
          </Text>
          <Text variant="bodyMedium">{summary}</Text>
        </View>

        <Animated.View style={chevronStyle}>
          <ChevronDown size={20} color={t.textFaint} strokeWidth={1.6} />
        </Animated.View>
      </Touchable>

      {open ? (
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)}>
          <View style={styles.rows}>
            {rows.map((event) => {
              // Confidence below 1 means no human asserted it. The user must always be able
              // to tell what they entered from what we guessed.
              const inferred = event.confidence < 1;
              const line = describe(event.metadata, numbers) ?? {
                text: EVENT_TYPE_LABEL[event.type],
              };
              const sentence = line.value ? `${line.text}, ${line.value}` : line.text;
              const color = DOMAIN_COLOR[domainOf(event.type)];

              return (
                <View
                  key={event.id}
                  style={styles.row}
                  accessible
                  accessibilityRole="text"
                  accessibilityLabel={`${time.format(toInstant(event.timestamp))}. ${sentence}.${
                    inferred ? ' Detected automatically.' : ''
                  }`}
                >
                  <Text variant="caption" color={t.textFaint} style={styles.time}>
                    {time.format(toInstant(event.timestamp))}
                  </Text>

                  <View
                    style={[
                      styles.rowDot,
                      inferred
                        ? // Hollow against the Card it sits in (t.surface, not t.bg) — the ring
                          // reads "empty" by matching its surroundings.
                          { borderColor: color, backgroundColor: t.surface }
                        : { backgroundColor: color },
                    ]}
                  />

                  <Text
                    variant="body"
                    color={inferred ? t.textMuted : t.textPrimary}
                    style={styles.sentence}
                    numberOfLines={1}
                  >
                    {line.text}
                  </Text>
                  {line.value ? (
                    <Text variant="label" color={t.textMuted} style={styles.value}>
                      {line.value}
                    </Text>
                  ) : null}
                </View>
              );
            })}

            {bucket.waterLogs > 0 ? (
              <View style={styles.row} accessible accessibilityRole="text">
                <Text variant="caption" color={t.textFaint} style={styles.time}>
                  —
                </Text>
                <View style={[styles.rowDot, { backgroundColor: DOMAIN_COLOR.water }]} />
                <Text variant="body" color={t.textPrimary} style={styles.sentence}>
                  {`Water · ${bucket.waterLogs} glass${bucket.waterLogs === 1 ? '' : 'es'}`}
                </Text>
                <Text variant="label" color={t.textMuted} style={styles.value}>
                  {formatVolume(bucket.waterMl)}
                </Text>
              </View>
            ) : null}
          </View>
        </Animated.View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  block: { marginBottom: spacing.md, overflow: 'hidden' },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    minHeight: 72,
  },
  dots: { flexDirection: 'row', gap: 3, width: 34, flexWrap: 'wrap' },
  dot: { width: 8, height: 8, borderRadius: radius.full },
  headCopy: { flex: 1, gap: spacing.xs },

  rows: {
    paddingLeft: spacing.lg,
    paddingRight: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  value: { fontVariant: ['tabular-nums'] },
  time: { width: 62, textAlign: 'right' },
  rowDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  sentence: { flex: 1 },

  empty: { alignItems: 'center', paddingVertical: spacing.xl },
  emptyBody: { marginTop: spacing.sm, maxWidth: 280 },
});
