/**
 * WCAG 2.1 contrast maths.
 *
 * This module exists because a threshold recalled from memory shipped a real
 * accessibility defect in this app once already. Every colour decision in the theme is
 * measured here rather than argued about.
 */

function parseHex(hex: string): [r: number, g: number, b: number] {
  const raw = hex.replace('#', '').trim();
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;

  // Length alone is not validation: `Number.parseInt('zz', 16)` is `NaN`, and NaN
  // propagates silently all the way to a contrast ratio of NaN, which compares false
  // against every floor. A colour test that reports "not greater than 4.5" for a typo is
  // indistinguishable from one reporting a real regression, so reject the input here.
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new RangeError(`Not a hex colour: "${hex}"`);

  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

function toChannel(value: number): number {
  const s = value / 255;
  // The sRGB transfer function. The 0.03928 knee is part of the spec, not a fudge.
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * toChannel(r) + 0.7152 * toChannel(g) + 0.0722 * toChannel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

function pad(n: number): string {
  return n.toString(16).padStart(2, '0');
}

/**
 * Flatten a translucent colour over an opaque one.
 *
 * Needed because several of this app's fills are alpha tints — a habit's `wash`, the
 * History grid's tint ramp — and a contrast ratio can only be computed against an
 * opaque colour. Measuring the tint against its own base rather than its composite
 * would report a number the user never sees.
 */
export function composite(fg: string, alpha: number, bg: string): string {
  const [fr, fg_, fb] = parseHex(fg);
  const [br, bg_, bb] = parseHex(bg);

  // Clamp rather than trust. An alpha outside 0–1 makes `f * a + b * (1 - a)` extrapolate
  // past both endpoints, and the channel value then overflows two hex digits — `pad()`
  // would emit a 3-character chunk and silently produce a malformed 7+ digit colour, or a
  // negative one. NaN is clamped to 0 too, since every comparison against it is false and
  // `Math.min/max` alone would let it through. Every current call site passes a literal
  // inside `src/theme/`, so this has no live exposure — but this module is what every
  // colour decision in the app is gated on, and a wrong answer here is invisible
  // downstream rather than loud.
  const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0;

  const mix = (f: number, b: number) => Math.round(f * a + b * (1 - a));
  return `#${pad(mix(fr, br))}${pad(mix(fg_, bg_))}${pad(mix(fb, bb))}`;
}
