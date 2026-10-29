/**
 * The launch logo as geometry, measured from assets/splash-icon.png (1024 × 1024): three
 * concentric arcs with rounded ends. Angles are clockwise from 3 o'clock and describe the
 * line itself; the rounded ends add half a stroke beyond each end, as in the image.
 */
export interface SplashArc {
  radius: number;
  width: number;
  startDeg: number;
  sweepDeg: number;
  color: string;
}

/** Innermost first: that is the order they spin in. */
export const SPLASH_ARCS: readonly SplashArc[] = [
  { radius: 80, width: 54, startDeg: 59.8, sweepDeg: 224.4, color: '#67806A' },
  { radius: 153, width: 54, startDeg: 95.1, sweepDeg: 249.3, color: '#7D927D' },
  { radius: 225.5, width: 54, startDeg: 125.4, sweepDeg: 269.7, color: '#A8B8A8' },
];

/** The native splash's backgrounds, from app.json. */
export const SPLASH_BACKGROUND = { light: '#FBF9F6', dark: '#15171A' } as const;

/** A dash pattern that draws `sweepDeg` of the circle and leaves the rest empty. */
export function arcDash(radius: number, sweepDeg: number): string {
  const circumference = 2 * Math.PI * radius;
  const drawn = (sweepDeg / 360) * circumference;
  return `${drawn} ${circumference - drawn}`;
}
