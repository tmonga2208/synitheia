import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { BodyMetrics } from '@synitheia/shared';
import { Card, Text, Touchable } from '../components/primitives.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { MIN_TAP_TARGET, spacing } from '../theme/theme.js';
import { bodyProvenance, bodyRows } from './bodyCopy.js';
import { BodyDetailsForm } from './BodyDetailsForm.js';
import { healthSourceName, storeHoldsIdentity } from './healthStore.js';

/**
 * The measurements behind every number on the Body screen, and the way to correct them.
 *
 * The screen used to show only what it derived — a BMI, a resting-energy figure — and
 * never the inputs. So a wrong input was invisible as well as uneditable: the user saw a
 * calorie target and had no way to learn it came from a mistyped birth year.
 */
export function BodyDetails({ body }: { body: BodyMetrics }) {
  const t = useTheme();
  const [editing, setEditing] = useState(false);

  const rows = bodyRows(body);
  if (rows.length === 0) return null;

  if (editing) {
    return <BodyDetailsForm mode="edit" stored={body} onDone={() => setEditing(false)} />;
  }

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text variant="cardTitle">Your details</Text>
        <Touchable
          onPress={() => setEditing(true)}
          haptic={false}
          style={styles.edit}
          accessibilityRole="button"
          accessibilityLabel="Edit your details"
        >
          <Text variant="bodyMedium" color={t.accent}>
            Edit
          </Text>
        </Touchable>
      </View>

      {rows.map((row) => (
        <View key={row.label} style={styles.line}>
          <Text variant="bodyMedium">{row.label}</Text>
          <Text variant="bodyMedium" color={t.textMuted}>
            {row.value}
          </Text>
        </View>
      ))}

      <Text variant="caption" color={t.textFaint}>
        {bodyProvenance(healthSourceName(), storeHoldsIdentity())}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, marginTop: spacing.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  edit: {
    minWidth: MIN_TAP_TARGET,
    minHeight: MIN_TAP_TARGET,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
