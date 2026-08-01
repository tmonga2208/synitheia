/**
 * Synítheia design tokens.
 *
 * Derived from design.md and the reference screens. The whole visual language is
 * "warm minimalism" — paper-like surfaces, one sage anchor, depth from soft broad
 * shadows rather than borders or gradients. Every value below is a decision, not a
 * default; components import from here and never hardcode a colour or a radius.
 */

export const palette = {
  /** The signature. Primary actions, completion, progress. */
  sage: '#7D927D',
  sageDeep: '#67806A',
  sageSoft: '#A8B8A8',
  sageWash: '#E8EDE8',

  /** Warm, paper-like. The app is never pure white — that reads as clinical. */
  bone: '#FBF9F6',
  sand: '#EFECEA',
  surfaceDim: '#DBDAD7',

  stone: '#2D2D2D',
  stoneMuted: '#6B6B68',
  stoneFaint: '#A3A3A0',

  white: '#FFFFFF',
  danger: '#B0705F',
  warning: '#C29A5B',

  /** Behind bottom sheets. Stone at low opacity — a black scrim reads harsh against bone. */
  scrim: 'rgba(45, 45, 45, 0.35)',
} as const;

/**
 * Per-habit accents. In the reference, each habit card is individually tinted —
 * border, icon chip, metadata text, and the completion affordance all pick up its
 * colour. It is the single most distinctive thing in the design, so it lives in the
 * domain (shared/habit.ts) and is mirrored here with its derived tints.
 */
export const habitAccents = {
  '#7D927D': { base: '#7D927D', wash: '#E8EDE8', text: '#5E7260' }, // sage
  '#7D8FA9': { base: '#7D8FA9', wash: '#E5E9EF', text: '#5E7189' }, // indigo
  '#C08A7D': { base: '#C08A7D', wash: '#F4E9E6', text: '#9B6A5E' }, // clay
  '#B0917D': { base: '#B0917D', wash: '#F1EAE4', text: '#8C7160' }, // sand
  '#8A9AA9': { base: '#8A9AA9', wash: '#E9EDF0', text: '#6C7C8A' }, // slate
  '#A98DA9': { base: '#A98DA9', wash: '#F0E9F0', text: '#856B85' }, // mauve
  '#7DA095': { base: '#7DA095', wash: '#E6EFEC', text: '#5E8076' }, // teal
  '#B08A8A': { base: '#B08A8A', wash: '#F2E8E8', text: '#8C6A6A' }, // rose
} as const;

export type HabitAccent = keyof typeof habitAccents;

export function accentFor(color: string) {
  return habitAccents[color as HabitAccent] ?? habitAccents['#7D927D'];
}

/**
 * A day's flow percentage as a calendar cell fill.
 *
 * Five steps rather than a continuous ramp: a smooth gradient across 31 cells is
 * impossible to read comparatively, and the eye only needs "was this a strong day"
 * at a glance. Text flips to white only on the solid top step (>= 85%), where the
 * app's existing button convention already pairs white text with sage. At all other
 * steps, stone text maintains contrast against the lighter fills.
 *
 * The lowest step is sand, NOT transparent. A day logged at 0% and a day with
 * nothing logged at all are different statements; the grid draws the latter as a
 * hollow outline and must never reuse this fill for it.
 */
export function flowTint(percent: number): { background: string; text: string } {
  const clamped = Math.min(100, Math.max(0, percent));

  if (clamped >= 85) return { background: palette.sage, text: palette.white };
  if (clamped >= 65) return { background: 'rgba(125, 146, 125, 0.74)', text: palette.stone };
  if (clamped >= 40) return { background: 'rgba(125, 146, 125, 0.46)', text: palette.stone };
  if (clamped >= 15) return { background: 'rgba(125, 146, 125, 0.24)', text: palette.stone };
  return { background: palette.sand, text: palette.stoneMuted };
}

/** A 4pt base scale. Generous — low cognitive load depends on whitespace. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  '3xl': 40,
  '4xl': 56,
} as const;

/** 32 for large cards, 16 for small elements — straight from design.md. */
export const radius = {
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  full: 999,
} as const;

/**
 * Broad, low-opacity, never harsh. design.md specifies blur 30 / y 10; on iOS that
 * maps to shadowRadius ~15 (RN's radius is roughly half a CSS blur).
 */
export const shadow = {
  card: {
    shadowColor: '#5A5A50',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 15,
    elevation: 3,
  },
  raised: {
    shadowColor: '#5A5A50',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 6,
  },
  /** CTAs in the reference sit on a deeper shadow than cards do. */
  button: {
    shadowColor: '#4A5A4A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },
  none: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
} as const;

export const font = {
  regular: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semibold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
} as const;

/**
 * The type scale, read off the reference screens.
 *
 * `display` is the number inside the ring — oversized on purpose; it is the emotional
 * summary of the day and everything else is subordinate to it. `overline` is the
 * uppercase wide-tracked date label.
 */
export const type = {
  display: { fontFamily: font.bold, fontSize: 64, lineHeight: 68, letterSpacing: -2 },
  title: { fontFamily: font.bold, fontSize: 32, lineHeight: 40, letterSpacing: -0.8 },
  heading: { fontFamily: font.semibold, fontSize: 22, lineHeight: 28, letterSpacing: -0.4 },
  section: { fontFamily: font.semibold, fontSize: 20, lineHeight: 26, letterSpacing: -0.3 },
  cardTitle: { fontFamily: font.semibold, fontSize: 18, lineHeight: 24, letterSpacing: -0.2 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 23 },
  bodyMedium: { fontFamily: font.medium, fontSize: 15, lineHeight: 23 },
  label: { fontFamily: font.medium, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: font.medium, fontSize: 12, lineHeight: 16 },
  overline: {
    fontFamily: font.semibold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.4,
    textTransform: 'uppercase' as const,
  },
} as const;

/** Gentle. Nothing in this app should snap. */
export const motion = {
  press: { scale: 0.97, duration: 120 },
  spring: { damping: 18, stiffness: 180, mass: 0.6 },
  ring: { duration: 900 },
} as const;

/** Below this, a touch target fails accessibility guidance on both platforms. */
export const MIN_TAP_TARGET = 44;

export const theme = {
  palette,
  habitAccents,
  spacing,
  radius,
  shadow,
  font,
  type,
  motion,
} as const;

export type Theme = typeof theme;
