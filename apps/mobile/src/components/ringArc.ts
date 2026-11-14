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
