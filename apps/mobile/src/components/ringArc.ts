/**
 * How much of the ring's circle to draw for a 0–1 progress.
 *
 * Rounded ends reach half the stroke past each end of the drawn line. Left alone, that makes
 * a 30% arc bulge past 12 o'clock at its start and run past 30% at its end. Shortening the
 * line by one stroke width (half for each end), with the ring turned by half a cap, puts both
 * rounded ends exactly on the true start and end.
 *
 * Except at 100%. There the shortened line's two rounded ends met head to head at the top,
 * and two half-circles touching at one point leave a pinched notch above and below where
 * they meet: the ring read as having sides rather than as a circle. A full ring is drawn
 * as the whole circumference instead, so its ends lie on top of each other and vanish into
 * the stroke.
 */
export function ringArc(
  progress: number,
  circumference: number,
  strokeWidth: number,
): { offset: number; visible: boolean } {
  'worklet';
  const p = Math.min(1, Math.max(0, progress));
  if (p >= 1) return { offset: 0, visible: true };
  const length = Math.max(0, p * circumference - strokeWidth);
  return { offset: circumference - length, visible: p > 0.0005 };
}

/**
 * Where the arc's leading rounded end sits, and how strongly it casts its shadow.
 *
 * As in the Fitness rings, the tip of a closed ring laps over its own start and casts a
 * soft shadow onto it, which is what makes 100% read as a ring that went all the way
 * round rather than a plain circle. The shadow only fades in over the last stretch, as
 * the tip comes within `reach` of the start; before that it would fall on the empty track.
 *
 * `angle` is in radians, in the ring's turned frame where the line starts at 0. It is the
 * centre of the rounded end, which is where ringArc's shortened line stops — at 100% that
 * is half a cap before 12 o'clock, so the cap's front edge lands exactly on 12.
 */
export function ringTip(
  progress: number,
  circumference: number,
  strokeWidth: number,
  reach: number,
): { angle: number; shadow: number } {
  'worklet';
  const p = Math.min(1, Math.max(0, progress));
  const radius = circumference / (2 * Math.PI);
  const length = Math.max(0, p * circumference - strokeWidth);
  const gap = (1 - p) * circumference;
  const shadow = reach > 0 ? Math.min(1, Math.max(0, 1 - gap / reach)) : p >= 1 ? 1 : 0;
  return { angle: length / radius, shadow };
}
