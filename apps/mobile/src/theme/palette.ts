/**
 * Raw colour scales — the only place in the app where a colour is written down.
 *
 * NOTHING outside `src/theme/` may import this file; a lint rule enforces it. Components
 * consume the semantic tokens in `theme.ts` instead, because a name like `bone` says what
 * a colour IS and a name like `bg` says what it is FOR, and only the second survives a
 * second theme. The clearest proof is in this app's own history: `palette.bone` appeared
 * 48 times and was a `backgroundColor` every single time, while `palette.white` was almost
 * always a foreground — icon glyphs and check marks on filled sage controls. In dark mode
 * those two have opposite fates, so a mechanical rename of either would have been wrong.
 */

/**
 * Light. Every value here is lifted byte-for-byte from the pre-dark-mode `tokens.ts`;
 * adding a second theme is not a licence to restyle the first one.
 */
export const lightPalette = {
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
 * Dark. Cool charcoal rather than true black: sage reads truest against a neutral ground,
 * and an OLED black would make the surface steps below invisible.
 *
 * The four-step surface scale is where dark mode gets its depth. Light mode leans on soft
 * broad shadows, but a `#5A5A50` shadow at 6% opacity over `#15171A` is literally
 * nothing — so a card reads as raised here by being *lighter* than the ground it sits on.
 */
export const darkPalette = {
  /**
   * Sage lifted so it holds against a dark ground without glowing. Note the consequence:
   * at this lightness white-on-sage measures 2.62:1, so the colour drawn on a filled sage
   * control has to invert. See `onAccent` in theme.ts.
   */
  sage: '#89A889',
  sageDeep: '#7A9A7A',
  /** De-emphasised marks. In dark, "quieter" means closer to the surface, so this is darker. */
  sageSoft: '#5E7460',
  sageWash: '#1F2620',

  bg: '#15171A',
  surface: '#1A1D21',
  surfaceRaised: '#20242A',
  /**
   * The spec's scale proposed `#24282D`, which measures 1.14:1 against `surface` — a
   * hairline that cannot be seen is not a border. Lifted to the nearest neutral that
   * clears the 1.2:1 floor with margin (1.29:1) while still reading as a hairline.
   */
  border: '#2C3138',

  textPrimary: '#E6E9EC',
  textMuted: '#8D949C',
  /**
   * Disabled and placeholder only. The spec's `#666D76` fell to 2.98:1 on `surfaceRaised`;
   * this clears 3:1 on all three surfaces, which is as far as it can go before it stops
   * reading as "faint" next to `textMuted`.
   */
  textFaint: '#6B727C',

  /** Kept for the rare true-white mark. Not the on-accent colour in this theme. */
  white: '#FFFFFF',
  danger: '#C98576',
  warning: '#D2AC72',

  /** A near-black scrim: against charcoal a stone scrim is invisible. */
  scrim: 'rgba(0, 0, 0, 0.55)',
} as const;
