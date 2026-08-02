import { useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Apple,
  Banana,
  Bath,
  Bike,
  Book,
  BookOpen,
  Brain,
  Carrot,
  Coffee,
  Droplets,
  Dumbbell,
  Feather,
  Flower2,
  Footprints,
  GraduationCap,
  HeartPulse,
  Laptop,
  Leaf,
  Library,
  ListChecks,
  Moon,
  Mountain,
  Newspaper,
  PenLine,
  Pill,
  Salad,
  Search,
  Sparkles,
  Stethoscope,
  Target,
  Timer,
  Utensils,
  Waves,
  Wind,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import { Chip, Input, Text, Touchable } from './primitives.js';
import { MIN_TAP_TARGET, radius, spacing } from '../theme/tokens.js';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider.js';
import { accentFor, type Theme } from '../theme/theme.js';

/**
 * The curated set.
 *
 * Deliberately small. A habit icon is a glance-level identifier, not a decoration — an
 * exhaustive 1,500-icon grid makes the choice slower and the resulting habit list less
 * legible, because nothing is visually distinct from anything else.
 */
export interface IconOption {
  /** The lucide component name. This exact string is what `habit.icon` stores. */
  name: string;
  label: string;
  Icon: LucideIcon;
}

export interface IconGroup {
  category: string;
  icons: IconOption[];
}

function option(name: string, label: string, Icon: LucideIcon): IconOption {
  return { name, label, Icon };
}

export const ICON_GROUPS: readonly IconGroup[] = [
  {
    category: 'Mindfulness',
    icons: [
      option('Sparkles', 'Star', Sparkles),
      option('Brain', 'Mind', Brain),
      option('Flower2', 'Bloom', Flower2),
      option('Moon', 'Rest', Moon),
      option('Wind', 'Breathe', Wind),
      option('Leaf', 'Calm', Leaf),
    ],
  },
  {
    category: 'Health',
    icons: [
      option('HeartPulse', 'Heart', HeartPulse),
      option('Pill', 'Medication', Pill),
      option('Droplets', 'Water', Droplets),
      option('Stethoscope', 'Checkup', Stethoscope),
      option('Bath', 'Bath', Bath),
    ],
  },
  {
    category: 'Reading',
    icons: [
      option('BookOpen', 'Read', BookOpen),
      option('Book', 'Book', Book),
      option('Newspaper', 'News', Newspaper),
      option('Library', 'Study', Library),
      option('GraduationCap', 'Learn', GraduationCap),
      option('Feather', 'Write', Feather),
    ],
  },
  {
    category: 'Eating',
    icons: [
      option('Apple', 'Fruit', Apple),
      option('Carrot', 'Veggies', Carrot),
      option('Salad', 'Salad', Salad),
      option('Banana', 'Snack', Banana),
      option('Utensils', 'Meal', Utensils),
      option('Coffee', 'Coffee', Coffee),
    ],
  },
  {
    category: 'Fitness',
    icons: [
      option('Dumbbell', 'Strength', Dumbbell),
      option('Bike', 'Cycle', Bike),
      option('Footprints', 'Walk', Footprints),
      option('Waves', 'Swim', Waves),
      option('Mountain', 'Hike', Mountain),
    ],
  },
  {
    category: 'Focus',
    icons: [
      option('Target', 'Focus', Target),
      option('Timer', 'Deep Work', Timer),
      option('Laptop', 'Work', Laptop),
      option('PenLine', 'Journal', PenLine),
      option('ListChecks', 'Tasks', ListChecks),
    ],
  },
] as const;

const ICONS_BY_NAME: ReadonlyMap<string, IconOption> = new Map(
  ICON_GROUPS.flatMap((group) => group.icons).map((icon) => [icon.name, icon]),
);

export const DEFAULT_ICON = 'Sparkles';

/**
 * Resolve a stored `habit.icon` string back to its component. Never throws.
 *
 * Tolerates kebab-case ("book-open") as well as the component name ("BookOpen"). Rows
 * written before the picker existed use the kebab form, and silently falling back to a
 * default star for all of them would look like the icons simply do not work.
 */
export function iconFor(name: string): IconOption {
  const direct = ICONS_BY_NAME.get(name);
  if (direct) return direct;

  const pascal = name
    .split(/[-_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

  return ICONS_BY_NAME.get(pascal) ?? ICONS_BY_NAME.get(DEFAULT_ICON)!;
}

const COLUMNS = 5;

interface IconPickerProps {
  visible: boolean;
  selectedIcon: string;
  /** The habit's accent — the tiles are tinted with it, so the sheet previews the result. */
  accent: string;
  onSelect: (icon: string) => void;
  onClose: () => void;
}

export function IconPicker({
  visible,
  selectedIcon,
  accent,
  onSelect,
  onClose,
}: IconPickerProps) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  const tint = accentFor(accent, t);
  const tileSize =
    (width - spacing.xl * 2 - spacing.md * (COLUMNS - 1)) / COLUMNS;

  const current = iconFor(selectedIcon);
  const CurrentIcon = current.Icon;

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return ICON_GROUPS.map((group) => ({
      category: group.category,
      icons: group.icons.filter(
        (icon) =>
          needle.length === 0 ||
          icon.label.toLowerCase().includes(needle) ||
          icon.name.toLowerCase().includes(needle),
      ),
    })).filter(
      (group) =>
        group.icons.length > 0 && (category === null || group.category === category),
    );
  }, [query, category]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Touchable
          style={styles.backdropDismiss}
          haptic={false}
          accessibilityRole="button"
          accessibilityLabel="Close icon picker"
          onPress={onClose}
        />

        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.handle} />

          <View style={styles.titleRow}>
            <Text variant="title">Choose Icon</Text>
            <Touchable
              style={styles.close}
              accessibilityRole="button"
              accessibilityLabel="Close"
              haptic={false}
              onPress={onClose}
            >
              <X size={20} color={t.textMuted} />
            </Touchable>
          </View>

          <View style={styles.preview}>
            <View style={[styles.previewTile, { backgroundColor: tint.wash }]}>
              <CurrentIcon size={32} color={tint.base} strokeWidth={1.5} />
            </View>
            <View style={styles.previewMeta}>
              <Text variant="bodyMedium" color={t.textMuted}>
                Current Selection
              </Text>
              <Text variant="heading">{current.label}</Text>
            </View>
          </View>

          <View style={styles.search}>
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder="Search..."
              accessibilityLabel="Search icons"
              autoCapitalize="none"
              autoCorrect={false}
              leading={<Search size={18} color={t.textFaint} />}
            />
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pills}
            style={styles.pillsRow}
          >
            <Chip
              label="All"
              selected={category === null}
              onPress={() => setCategory(null)}
            />
            {ICON_GROUPS.map((group) => (
              <Chip
                key={group.category}
                label={group.category}
                accent={tint.base}
                selected={category === group.category}
                onPress={() => setCategory(group.category)}
              />
            ))}
          </ScrollView>

          <ScrollView
            contentContainerStyle={styles.grid}
            showsVerticalScrollIndicator={false}
          >
            {groups.map((group) => (
              <View key={group.category} style={styles.group}>
                <Text variant="section" style={styles.groupTitle}>
                  {group.category}
                </Text>

                <View style={styles.tiles}>
                  {group.icons.map(({ name, label, Icon }) => {
                    const isSelected = name === selectedIcon;

                    return (
                      <Touchable
                        key={name}
                        accessibilityRole="button"
                        accessibilityLabel={`${label} icon`}
                        accessibilityState={{ selected: isSelected }}
                        onPress={() => {
                          onSelect(name);
                          onClose();
                        }}
                        style={[
                          styles.tile,
                          {
                            width: tileSize,
                            height: tileSize,
                            backgroundColor: tint.wash,
                          },
                          ...(isSelected ? [{ borderColor: tint.base }] : []),
                        ]}
                      >
                        <Icon size={24} color={tint.text} strokeWidth={1.5} />
                      </Touchable>
                    );
                  })}
                </View>
              </View>
            ))}

            {groups.length === 0 ? (
              <Text variant="body" color={t.textMuted} center>
                No icons match “{query.trim()}”.
              </Text>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: t.scrim,
  },
  backdropDismiss: { flex: 1 },
  // A bottom sheet: t.surface, not t.surfaceRaised.
  sheet: {
    maxHeight: '88%',
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
  close: {
    width: MIN_TAP_TARGET,
    height: MIN_TAP_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
    marginTop: spacing.lg,
  },
  previewTile: {
    width: 80,
    height: 80,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewMeta: { gap: spacing.xs },
  search: { marginTop: spacing.lg },
  pillsRow: { marginTop: spacing.base, flexGrow: 0 },
  pills: { gap: spacing.sm, paddingVertical: spacing.sm },
  grid: { paddingTop: spacing.base, paddingBottom: spacing['2xl'] },
  group: { marginBottom: spacing.xl },
  groupTitle: { marginBottom: spacing.md },
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  tile: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
});
