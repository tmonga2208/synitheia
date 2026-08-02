/**
 * Synítheia's semantic theme.
 *
 * This is the file to read before converting a component. It has two halves:
 *
 *   1. **Theme-dependent colour.** Reached through `useTheme()` and a per-file
 *      `makeStyles(t)`. Never through a module-level `StyleSheet.create` — a static
 *      stylesheet is captured once at import and cannot follow an appearance change.
 *   2. **Invariant dimensions** — `spacing`, `radius`, `type`, `motion`, `font`,
 *      `MIN_TAP_TARGET`. A 16pt gutter is 16pt in the dark. These are plain exports, so a
 *      file that uses no colour needs no hook and no `makeStyles` at all.
 *
 * The semantic names are the whole point. `palette.bone` says what a colour IS; `t.surface`
 * says what it is FOR, and only the second survives a second theme. Concretely: `bone`
 * appeared 48 times in this app and was a `backgroundColor` every single time, while
 * `white` was nearly always a foreground — glyphs and checks on filled sage controls. In
 * dark those two invert relative to each other, which is why `surface` and `onAccent` are
 * separate tokens and why a find-and-replace conversion would have produced a broken app.
 *
 *   Converting a file? Classify each reference by the ROLE it plays:
 *
 *     palette.bone        → t.bg (a screen) or t.surface (a card, a sheet)
 *     palette.sand        → t.surfaceRaised
 *     palette.surfaceDim  → t.border
 *     palette.stone       → t.textPrimary
 *     palette.stoneMuted  → t.textMuted
 *     palette.stoneFaint  → t.textFaint
 *     palette.sage        → t.accent
 *     palette.sageDeep    → t.accentDeep
 *     palette.sageSoft    → t.accentSoft
 *     palette.sageWash    → t.accentWash
 *     palette.white       → t.onAccent  (when it sits on a filled accent/danger control)
 *     palette.danger / warning / scrim → the same names
 *
 *   The one mapping that trips people up — RULED 2026-08-02, do not re-decide it:
 *
 *     a bottom sheet, a modal, a menu        → t.surface        NOT t.surfaceRaised
 *     a chip, an input, a secondary button   → t.surfaceRaised
 *
 *   "Raised" here means a small inset control that has to separate from the surface it
 *   sits on, not "high in the z-order". A sheet already reads as raised because it sits
 *   over `scrim` at 55% black, and mapping it to `surface` is also what keeps light mode
 *   byte-identical — sheets are `bone` today, the same as the page behind them.
 *
 * If a call site's role cannot be settled from its immediate context, flag it rather than
 * guess — a wrong guess here is invisible in light mode and glaring at night.
 */

import { composite } from './contrast.js';
import { darkPalette, lightPalette } from './palette.js';

/* ────────────────────────────── invariant scales ─────────────────────────────── */

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

export interface ShadowStyle {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

export interface ShadowScale {
  card: ShadowStyle;
  raised: ShadowStyle;
  button: ShadowStyle;
  none: ShadowStyle;
}

/**
 * Broad, low-opacity, never harsh. design.md specifies blur 30 / y 10; on iOS that maps to
 * shadowRadius ~15 (RN's radius is roughly half a CSS blur).
 *
 * These are the LIGHT shadows and are unchanged. Reach for `t.shadow` rather than this
 * export in any themed component: in dark every elevation resolves to `none`, because a
 * `#5A5A50` shadow at 6% opacity over `#15171A` renders as nothing at all. Dark buys its
 * depth from the `bg` → `surface` → `surfaceRaised` lightness steps instead.
 */
export const shadow: ShadowScale = {
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
};

/** Every elevation flattened. What `t.shadow` resolves to in dark. */
const flatShadow: ShadowScale = {
  card: shadow.none,
  raised: shadow.none,
  button: shadow.none,
  none: shadow.none,
};

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
 * summary of the day and everything else is subordinate to it. `overline` is the uppercase
 * wide-tracked date label.
 *
 * Worth knowing while picking colours: `caption` is 12px, which WCAG 1.4.3 counts as
 * NORMAL text. It holds to 4.5:1, not the 3:1 large-text floor — the rule this codebase
 * got wrong once already, in the History grid.
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

/* ──────────────────────────────── habit accents ──────────────────────────────── */

/**
 * A habit's three colours. `base` is the visible per-habit colour — card border, icon chip
 * fill, the completion ring. `wash` is the tinted ground behind it. `text` carries the
 * habit's metadata line and its icon glyph, so it alone is held to a text contrast floor.
 */
export interface AccentTriple {
  base: string;
  wash: string;
  text: string;
}

/**
 * Light habit accents, unchanged from the pre-dark-mode `tokens.ts`.
 *
 * Each habit card is individually tinted — border, icon chip, metadata text and the
 * completion affordance all pick up its colour. It is the single most distinctive thing in
 * the design, which is why the dark set below is derived rather than flattened to grey.
 */
const lightHabitAccents = {
  '#7D927D': { base: '#7D927D', wash: '#E8EDE8', text: '#5E7260' }, // sage
  '#7D8FA9': { base: '#7D8FA9', wash: '#E5E9EF', text: '#5E7189' }, // indigo
  '#C08A7D': { base: '#C08A7D', wash: '#F4E9E6', text: '#9B6A5E' }, // clay
  '#B0917D': { base: '#B0917D', wash: '#F1EAE4', text: '#8C7160' }, // sand
  '#8A9AA9': { base: '#8A9AA9', wash: '#E9EDF0', text: '#6C7C8A' }, // slate
  '#A98DA9': { base: '#A98DA9', wash: '#F0E9F0', text: '#856B85' }, // mauve
  '#7DA095': { base: '#7DA095', wash: '#E6EFEC', text: '#5E8076' }, // teal
  '#B08A8A': { base: '#B08A8A', wash: '#F2E8E8', text: '#8C6A6A' }, // rose
} as const;

export type HabitAccent = keyof typeof lightHabitAccents;

/**
 * Dark habit accents, derived from the light `base` by a stated rule rather than by taste.
 * Each one keeps its hue exactly; lightness is raised to the smallest value that clears its
 * floor against `surface` (#1A1D21); saturation is scaled by 1.3, because equal HSL
 * saturation at low lightness yields visibly less chroma and the eight would otherwise
 * converge on the same charcoal-grey.
 *
 *   base  — the minimum lightness clearing 3:1. Borders and filled affordances, not text.
 *   text  — the minimum lightness clearing 5:1, comfortably above the 4.5:1 body floor.
 *   wash  — `base` at 18% alpha composited over `surface`. A solid pastel that reads as
 *           "tinted" on bone reads as "washed-out grey" on charcoal, so the dark wash is a
 *           tint of the habit's own colour instead. Composited at authoring time so the
 *           value can be measured; it lands at ~1.18:1 off surface, matching the light
 *           washes' own 1.11–1.16:1 subtlety.
 *
 * Measured separation: the closest pair of dark bases is 14.59 in RGB distance, against
 * 14.76 for the light set — the eight stay as distinguishable as they have always been.
 * `theme.contrast.test.ts` holds all of it.
 */
/** Dark sage at `alpha`, flattened over the dark `surface` so the result can be measured. */
const tintOverSurface = (alpha: number): string =>
  composite(darkPalette.sage, alpha, darkPalette.surface);

const darkHabitAccents: Record<HabitAccent, AccentTriple> = {
  '#7D927D': { base: '#597159', wash: '#252c2b', text: '#779377' }, // sage
  '#7D8FA9': { base: '#536c90', wash: '#242b35', text: '#768eb0' }, // indigo
  '#C08A7D': { base: '#a6533f', wash: '#332726', text: '#c57865' }, // clay
  '#B0917D': { base: '#8a6248', wash: '#2e2928', text: '#b08366' }, // sand
  '#8A9AA9': { base: '#576d82', wash: '#252b32', text: '#778fa4' }, // slate
  '#A98DA9': { base: '#865d86', wash: '#2d2933', text: '#a77fa7' }, // mauve
  '#7DA095': { base: '#4c7367', wash: '#232c2e', text: '#639686' }, // teal
  '#B08A8A': { base: '#975a5a', wash: '#31282b', text: '#b27f7f' }, // rose
};

/* ─────────────────────────────────── the theme ───────────────────────────────── */

export type ThemeName = 'light' | 'dark';

/** One step of the flow ramp: a fill and the colour a date numeral takes on it. */
export interface FlowStep {
  background: string;
  text: string;
}

export interface Theme {
  name: ThemeName;

  /** The screen behind everything. */
  bg: string;
  /** A card, a sheet — anything sitting on `bg`. */
  surface: string;
  /**
   * A small inset control that has to separate from the surface it sits on: chips, inputs,
   * secondary buttons.
   *
   * NOT a sheet or a menu, despite the name — those take `surface`. "Raised" is about
   * needing its own fill, not about z-order; a sheet already reads as raised because it
   * sits over `scrim`. Ruled 2026-08-02, and it is also what keeps light mode
   * byte-identical, since sheets are `bone` today.
   */
  surfaceRaised: string;
  /** Hairline separators and card edges. Never a text colour. */
  border: string;

  /** Body copy and headings. */
  textPrimary: string;
  /** Metadata and secondary copy. Still held to 4.5:1. */
  textMuted: string;
  /** Disabled controls and placeholders ONLY. Exempt from 4.5:1 under WCAG 1.4.3, which
   *  means it is illegible by design — never use it for content a user must read. */
  textFaint: string;

  /** The sage anchor: primary fills, completion, progress. */
  accent: string;
  /** A step deeper than `accent`. Pressed states, and the top band of the flow ramp. */
  accentDeep: string;
  /** Sage for de-emphasised marks — skeletons, inactive ticks. */
  accentSoft: string;
  /** A tinted ground behind an accent icon. */
  accentWash: string;
  /**
   * Anything drawn ON a filled accent control: glyphs, check marks, switch thumbs, button
   * labels.
   *
   * ┌─ THIS TOKEN DELIBERATELY INVERTS BETWEEN THEMES. DO NOT "FIX" IT BACK TO WHITE. ─┐
   *
   * `onAccent` is `#FFFFFF` in light and `#15171A` — near-black — in dark. That is not an
   * oversight, and it is the reason the token exists at all. Measured:
   *
   *     light   white   #FFFFFF  on  accent #7D927D   3.3441:1   (the app's long-standing
   *                                                               primary-button look;
   *                                                               recorded as a documented
   *                                                               exception in
   *                                                               theme.contrast.test.ts)
   *     dark    white   #FFFFFF  on  accent #89A889   2.6165:1   ✗ fails 4.5:1 AND 3:1
   *     dark    ink     #15171A  on  accent #89A889   6.8635:1   ✓
   *
   * Dark `accent` has to be lifted to `#89A889` to hold against the charcoal ground, and at
   * that lightness white on it is 2.62:1 — every glyph and check mark on a filled sage
   * control would effectively disappear. Near-black on the same fill is 6.86:1.
   *
   * The obvious alternative — keep `onAccent` white and darken dark-mode sage until white
   * works — does not survive: white needs its ground at luminance ≤ 0.18, which puts sage
   * around `#5E7460`, and that measures only ~2.5:1 against `surface` #1A1D21. The accent
   * would stop reading as an accent. There is no value of sage where white-on-accent and
   * accent-on-surface both clear their floors, so the foreground is what has to move.
   *
   * The token's MEANING is unchanged in both themes and is the thing to hold on to:
   * "whatever stays legible on a filled accent". Only its value moves. This is also what
   * iOS and Material do — a lightened accent in dark takes a dark on-colour.
   *
   * Note the earlier design spec said `onAccent` "stays near-white in both". That sentence
   * was wrong and has been corrected; the measurements above are the ruling.
   *
   * └───────────────────────────────────────────────────────────────────────────────────┘
   */
  onAccent: string;

  danger: string;
  warning: string;
  /** Behind bottom sheets. */
  scrim: string;

  /** Per-habit `base`/`wash`/`text` triples, keyed by the habit's stored colour. */
  habitAccents: Record<HabitAccent, AccentTriple>;

  /**
   * The five-step flow ramp, lowest band first. Read it through `flowTint()` rather than
   * indexing it — the band thresholds are part of the contract.
   */
  flowRamp: readonly [FlowStep, FlowStep, FlowStep, FlowStep, FlowStep];

  /** Elevation. Every entry is `shadow.none` in dark. */
  shadow: ShadowScale;
}

export const lightTheme: Theme = {
  name: 'light',

  bg: lightPalette.bone,
  // Cards and screens are both bone: light mode separates them with a soft shadow rather
  // than a lightness step, and that is exactly what dark mode cannot do.
  surface: lightPalette.bone,
  surfaceRaised: lightPalette.sand,
  border: lightPalette.surfaceDim,

  textPrimary: lightPalette.stone,
  textMuted: lightPalette.stoneMuted,
  textFaint: lightPalette.stoneFaint,

  accent: lightPalette.sage,
  accentDeep: lightPalette.sageDeep,
  accentSoft: lightPalette.sageSoft,
  accentWash: lightPalette.sageWash,
  onAccent: lightPalette.white,

  danger: lightPalette.danger,
  warning: lightPalette.warning,
  scrim: lightPalette.scrim,

  habitAccents: lightHabitAccents,

  /**
   * Unchanged. The three middle bands are sage at rising alpha over bone, the lowest is a
   * solid sand, and the top is `sageDeep` rather than `sage` so the white numeral gets the
   * best ratio this ramp can offer (4.31:1 — short of AA, recorded in `tokens.test.ts`).
   */
  flowRamp: [
    { background: lightPalette.sand, text: lightPalette.stoneMuted },
    { background: 'rgba(125, 146, 125, 0.24)', text: lightPalette.stone },
    { background: 'rgba(125, 146, 125, 0.46)', text: lightPalette.stone },
    { background: 'rgba(125, 146, 125, 0.74)', text: lightPalette.stone },
    { background: lightPalette.sageDeep, text: lightPalette.white },
  ],

  shadow,
};

export const darkTheme: Theme = {
  name: 'dark',

  bg: darkPalette.bg,
  surface: darkPalette.surface,
  surfaceRaised: darkPalette.surfaceRaised,
  border: darkPalette.border,

  textPrimary: darkPalette.textPrimary,
  textMuted: darkPalette.textMuted,
  textFaint: darkPalette.textFaint,

  accent: darkPalette.sage,
  accentDeep: darkPalette.sageDeep,
  accentSoft: darkPalette.sageSoft,
  accentWash: darkPalette.sageWash,
  // Near-black, not white. See the doc on `Theme['onAccent']` — this is the deliberate
  // inversion, and it is what keeps a check mark visible on a filled sage control.
  onAccent: darkPalette.bg,

  danger: darkPalette.danger,
  warning: darkPalette.warning,
  scrim: darkPalette.scrim,

  habitAccents: darkHabitAccents,

  /**
   * The dark ramp inverts the direction of travel. Sage over bone at 24% alpha is invisible
   * on charcoal, so instead of darkening from the page toward sage, this brightens from the
   * surface toward it: the lowest band sits a hair above `surface` and the top band is
   * solid sage. "More colour = better day" is preserved, and each fill stands further off
   * `surface` than the one below it (1.09 → 1.36 → 1.88 → 2.72 → 6.46).
   *
   * Fills are pre-composited over `surface` rather than left as alpha, so the numeral's
   * real contrast can be measured — which matters here more than anywhere, since these are
   * `type.caption` and the History grid is where this codebase's one shipped WCAG mistake
   * was. Every band clears 4.5:1.
   */
  flowRamp: [
    { background: darkPalette.surfaceRaised, text: darkPalette.textMuted },
    { background: tintOverSurface(0.18), text: darkPalette.textPrimary },
    { background: tintOverSurface(0.34), text: darkPalette.textPrimary },
    { background: tintOverSurface(0.52), text: darkPalette.textPrimary },
    { background: darkPalette.sage, text: darkPalette.bg },
  ],

  shadow: flatShadow,
};

export const themes: Record<ThemeName, Theme> = {
  light: lightTheme,
  dark: darkTheme,
};

/* ─────────────────────────────────── functions ───────────────────────────────── */

/**
 * The triple for a habit's stored colour, falling back to sage for an unrecognised one —
 * a habit created before a palette change must still render.
 */
export function accentFor(color: string, t: Theme): AccentTriple {
  return t.habitAccents[color as HabitAccent] ?? t.habitAccents['#7D927D'];
}

/**
 * A day's flow percentage as a calendar cell fill.
 *
 * Five steps rather than a continuous ramp: a smooth gradient across 31 cells is impossible
 * to read comparatively, and the eye only needs "was this a strong day" at a glance. The
 * thresholds are the contract and are identical in both themes; only the colours differ.
 *
 * The lowest step is a solid fill, NOT transparent. A day logged at 0% and a day with
 * nothing logged at all are different statements; the grid draws the latter as a hollow
 * outline and must never reuse this fill for it.
 */
export function flowTint(percent: number, t: Theme): FlowStep {
  const clamped = Math.min(100, Math.max(0, percent));

  if (clamped >= 85) return t.flowRamp[4];
  if (clamped >= 65) return t.flowRamp[3];
  if (clamped >= 40) return t.flowRamp[2];
  if (clamped >= 15) return t.flowRamp[1];
  return t.flowRamp[0];
}
