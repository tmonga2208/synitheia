/**
 * TEMPORARY during the dark-mode conversion.
 *
 * Re-exports the light theme under the old names so the 43 files that have not been
 * converted yet keep compiling. Each task converts a slice of them to `useTheme()` and
 * `makeStyles(t)`; this file is deleted in the final task, at which point the lint rule
 * forbidding `src/theme/palette` imports from outside `src/theme/` takes over.
 *
 * Do not add anything here, and do not import it from a file you are converting.
 */

import { accentFor as themedAccentFor, flowTint as themedFlowTint, lightTheme } from './theme.js';
import type { AccentTriple, FlowStep } from './theme.js';

export { spacing, radius, shadow, font, type, motion, MIN_TAP_TARGET } from './theme.js';
export type { HabitAccent } from './theme.js';
export { lightPalette as palette } from './palette.js';

/**
 * Light-bound shims. Both functions gained a `Theme` parameter, so their old call sites
 * would not compile against the new signatures. Deleted in Task 9 with the rest of this
 * file.
 */
export function accentFor(color: string): AccentTriple {
  return themedAccentFor(color, lightTheme);
}

export function flowTint(percent: number): FlowStep {
  return themedFlowTint(percent, lightTheme);
}

/** The light triples, kept under the old name for any straggler that imports them. */
export const habitAccents = lightTheme.habitAccents;
