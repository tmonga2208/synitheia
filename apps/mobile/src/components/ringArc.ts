/**
 * How much of the ring's circle to draw for a 0–1 progress.
 *
 * Rounded ends reach half the stroke past each end of the drawn line. Left alone, that makes
 * a 30% arc bulge past 12 o'clock at its start and run past 30% at its end. Shortening the
 * line by one stroke width (half for each end), with the ring turned by half a cap, puts both
 * rounded ends exactly on the true start and end. At 100% the two ends meet and close the
 * circle.
 */
export function ringArc(
  progress: number,
  circumference: number,
  strokeWidth: number,
): { offset: number; visible: boolean } {
  'worklet';
  const p = Math.min(1, Math.max(0, progress));
  const length = Math.max(0, p * circumference - strokeWidth);
  return { offset: circumference - length, visible: p > 0.0005 };
}
