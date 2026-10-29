import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CalorieGoal, GoalPace, WeightPoint } from '@synitheia/shared';
import { Button, Card, Input, Text } from '../components/primitives.js';
import { api } from '../api/client.js';
import { spacing } from '../theme/theme.js';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider.js';
import type { Theme } from '../theme/theme.js';
import { changeLine, formatKg, paceLine, retargetLine } from './weightCopy.js';

interface Props {
  weightKg: number | null;
  entries: WeightPoint[];
  weeklyChangeKg: number | null;
  pace: GoalPace | null;
  goal: CalorieGoal | null;
  calorieTarget: number;
  accent: string;
  /** The Body screen's query key, refreshed after a check-in. */
  queryKey: readonly unknown[];
}

const SPARK_W = 300;
const SPARK_H = 56;

/** The last eight weeks as a line. Drawn only with two or more weigh-ins. */
function Sparkline({ entries, color }: { entries: WeightPoint[]; color: string }) {
  if (entries.length < 2) return null;
  const first = Date.parse(entries[0]!.localDate);
  const span = Math.max(1, Date.parse(entries[entries.length - 1]!.localDate) - first);
  const kgs = entries.map((e) => e.weightKg);
  const lo = Math.min(...kgs);
  const range = Math.max(0.5, Math.max(...kgs) - lo);
  const points = entries.map((e) => ({
    x: 4 + ((Date.parse(e.localDate) - first) / span) * (SPARK_W - 8),
    y: 4 + (1 - (e.weightKg - lo) / range) * (SPARK_H - 8),
  }));
  const last = points[points.length - 1]!;

  return (
    <Svg
      width="100%"
      height={SPARK_H}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      accessibilityLabel={`Weight over the last ${entries.length} weigh-ins`}
    >
      <Polyline
        points={points.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Circle cx={last.x} cy={last.y} r={3.5} fill={color} />
    </Svg>
  );
}

/**
 * Weight check-ins: the reason to come back to the Body screen. Shows where the weight is
 * heading against the goal, and takes a new weigh-in in place.
 */
export function WeightCard(props: Props) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [moved, setMoved] = useState<string | null>(null);

  const kg = Number(draft.replace(',', '.'));
  const valid = draft.trim() !== '' && Number.isFinite(kg) && kg >= 20 && kg <= 500;

  const log = useMutation({
    meta: { failed: 'Couldn’t save your weight' },
    mutationFn: () =>
      api.post<{ currentCalorieTarget: number }>('/health/weight', { weightKg: kg }),
    onSuccess: (report) => {
      setMoved(props.goal ? retargetLine(props.calorieTarget, report.currentCalorieTarget) : null);
      setOpen(false);
      setDraft('');
      void queryClient.invalidateQueries({ queryKey: props.queryKey });
      // Food and Today measure meals against the target this may have moved.
      void queryClient.invalidateQueries({ queryKey: ['today'] });
    },
  });

  return (
    <Card style={styles.card} accent={props.accent}>
      <Text variant="overline" color={t.textMuted}>
        Weight
      </Text>

      {props.weightKg !== null ? (
        <>
          <Text variant="title">{formatKg(props.weightKg)}</Text>
          <Text variant="body" color={t.textMuted}>
            {changeLine(props.weeklyChangeKg)}
          </Text>
        </>
      ) : (
        <Text variant="body" color={t.textMuted}>
          Log your weight now and then to see where it is heading.
        </Text>
      )}

      <Sparkline entries={props.entries} color={props.accent} />

      {props.goal && props.pace ? (
        <Text variant="bodyMedium">{paceLine(props.goal, props.pace)}</Text>
      ) : null}

      {moved ? (
        <Text variant="caption" color={t.textMuted}>
          {moved}
        </Text>
      ) : null}

      {open ? (
        <View style={styles.form}>
          <Input
            label="Today’s weight (kg)"
            value={draft}
            onChangeText={setDraft}
            keyboardType="decimal-pad"
            placeholder={props.weightKg !== null ? props.weightKg.toFixed(1) : '70.0'}
            autoFocus
            accessibilityLabel="Today’s weight in kilograms"
          />
          <Button
            label="Save weight"
            loading={log.isPending}
            disabled={!valid}
            onPress={() => log.mutate()}
          />
        </View>
      ) : (
        <Button
          label="Log weight"
          variant="secondary"
          onPress={() => {
            setMoved(null);
            setOpen(true);
          }}
        />
      )}
    </Card>
  );
}

const makeStyles = (_t: Theme) =>
  StyleSheet.create({
    card: { gap: spacing.sm, marginTop: spacing.lg },
    form: { gap: spacing.sm },
  });
