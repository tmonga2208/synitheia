import { View } from 'react-native';
import { Text } from '../components/primitives.js';
import { composite } from '../theme/contrast.js';
import { useTheme } from '../theme/ThemeProvider.js';

interface Props {
  name: string;
  /** A category colour to tint with, or null for the plain neutral circle. */
  color: string | null;
  size: number;
}

/** The first letter of a payee in a soft circle: a picture where a row used to have words. */
export function Avatar({ name, color, size }: Props) {
  const t = useTheme();
  const letter = name.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? '•';

  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: color ? composite(color, 0.24, t.surface) : t.surfaceRaised,
      }}
    >
      <Text variant={size >= 40 ? 'bodyMedium' : 'label'} color={color ?? t.textMuted}>
        {letter}
      </Text>
    </View>
  );
}
