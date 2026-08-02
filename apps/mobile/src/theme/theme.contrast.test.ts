import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast.js';
import { darkTheme, flowTint, lightTheme, type Theme } from './theme.js';

const THEMES: [name: string, t: Theme][] = [
  ['light', lightTheme],
  ['dark', darkTheme],
];

/**
 * Pairings that do NOT meet 4.5:1, each with a reason and its measured ratio. An
 * exception that is not written down here is a bug, not a decision.
 */
const EXCEPTIONS = [
  // White on sage. Predates dark mode: the app's primary buttons have always used it,
  // and the History grid's top tint band inherited it. Measured, not waived silently.
  // Dark mode has no equivalent entry — see `onAccent` in theme.ts.
  { pair: 'onAccent/accent', themes: ['light'], floor: 3.3 },

  // Disabled and placeholder text. WCAG 1.4.3 exempts disabled controls, so these are
  // recorded at their measured value rather than held to 4.5:1. Light is the existing
  // `stoneFaint`; dark is tuned to clear 3:1 on all three surfaces.
  { pair: 'textFaint/bg', themes: ['light'], floor: 2.4 },
  { pair: 'textFaint/surface', themes: ['light'], floor: 2.4 },
  { pair: 'textFaint/surfaceRaised', themes: ['light'], floor: 2.1 },
  { pair: 'textFaint/bg', themes: ['dark'], floor: 3.0 },
  { pair: 'textFaint/surface', themes: ['dark'], floor: 3.0 },
  { pair: 'textFaint/surfaceRaised', themes: ['dark'], floor: 3.0 },

  // ESCALATION, not a waiver — see .superpowers/sdd/2026-08-02-dark-mode/task-2-report.md.
  // These are the EXISTING light habit accents, lifted from tokens.ts unchanged, and
  // measured against a floor for the first time here. Six of the eight `base` values and
  // four of the eight `text` values have never met theirs. Bringing them up means moving
  // the per-habit colours by up to 21 RGB units — a visible restyle of HabitCard, which
  // this task is explicitly forbidden from doing. So they are RECORDED at their measured
  // worst case, pending a decision. The dark accents below are held to the full floors.
  { pair: 'habitAccent.base/surface', themes: ['light'], floor: 2.72 },
  { pair: 'habitAccent.text/surface', themes: ['light'], floor: 4.08 },
];

function floorFor(pair: string, theme: string, fallback = 4.5): number {
  const e = EXCEPTIONS.find((x) => x.pair === pair && x.themes.includes(theme));
  return e ? e.floor : fallback;
}

describe.each(THEMES)('%s theme contrast', (name, t) => {
  const surfaces: [string, string][] = [
    ['bg', t.bg],
    ['surface', t.surface],
    ['surfaceRaised', t.surfaceRaised],
  ];
  const texts: [string, string][] = [
    ['textPrimary', t.textPrimary],
    ['textMuted', t.textMuted],
    ['textFaint', t.textFaint],
  ];

  for (const [sName, s] of surfaces) {
    for (const [tName, text] of texts) {
      it(`${tName} on ${sName} is legible`, () => {
        const ratio = contrastRatio(text, s);
        expect(ratio).toBeGreaterThanOrEqual(floorFor(`${tName}/${sName}`, name));
      });
    }
  }

  it('onAccent is legible on accent', () => {
    const ratio = contrastRatio(t.onAccent, t.accent);
    expect(ratio).toBeGreaterThanOrEqual(floorFor('onAccent/accent', name));
  });

  it('border is perceptible against surface', () => {
    // Not a WCAG text rule — a hairline that cannot be seen is not a border.
    expect(contrastRatio(t.border, t.surface)).toBeGreaterThan(1.2);
  });

  it('surfaceRaised is perceptible against surface', () => {
    // Dark mode buys its depth with this step instead of with shadows, so if the step
    // disappears a sheet stops reading as "above" the card behind it.
    expect(contrastRatio(t.surfaceRaised, t.surface)).toBeGreaterThan(1.05);
  });

  it('every habit accent’s text is legible on surface', () => {
    const floor = floorFor('habitAccent.text/surface', name);
    for (const [color, accent] of Object.entries(t.habitAccents)) {
      expect(contrastRatio(accent.text, t.surface), `habit accent ${color}`).toBeGreaterThanOrEqual(
        floor,
      );
    }
  });

  it('every habit accent’s base is perceptible on surface', () => {
    const floor = floorFor('habitAccent.base/surface', name, 3);
    for (const [color, accent] of Object.entries(t.habitAccents)) {
      expect(contrastRatio(accent.base, t.surface), `habit accent ${color}`).toBeGreaterThanOrEqual(
        floor,
      );
    }
  });

  it('every habit accent’s wash is perceptible against surface', () => {
    // A wash that matches the surface is not a tint. In dark the wash is a composited
    // alpha tint rather than a pastel, so this is the assertion that catches it going
    // muddy.
    for (const [color, accent] of Object.entries(t.habitAccents)) {
      expect(contrastRatio(accent.wash, t.surface), `habit accent ${color}`).toBeGreaterThan(1.05);
    }
  });

  it('the eight habit accents stay eight distinguishable colours', () => {
    // The failure contrast maths cannot see: eight accents all pushed to the same
    // near-grey still pass every ratio above. HabitCard's per-habit tinting is the most
    // distinctive thing in this design, so the dark set is held to the separation the
    // light set already has — its own closest pair measures 14.76.
    const bases = Object.values(t.habitAccents).map((a) => a.base);
    const rgb = (hex: string) => [
      Number.parseInt(hex.slice(1, 3), 16),
      Number.parseInt(hex.slice(3, 5), 16),
      Number.parseInt(hex.slice(5, 7), 16),
    ];

    for (let i = 0; i < bases.length; i += 1) {
      for (let j = i + 1; j < bases.length; j += 1) {
        const a = rgb(bases[i] as string);
        const b = rgb(bases[j] as string);
        const distance = Math.hypot(
          (a[0] as number) - (b[0] as number),
          (a[1] as number) - (b[1] as number),
          (a[2] as number) - (b[2] as number),
        );
        expect(distance, `${bases[i]} vs ${bases[j]}`).toBeGreaterThan(12);
      }
    }
  });
});

describe('dark flowTint ramp', () => {
  const t = darkTheme;
  // One sample inside each of the five bands.
  const STEPS = [0, 20, 50, 70, 95];

  it('keeps every step’s numeral legible on its own fill', () => {
    // MonthGrid renders date numerals at `type.caption` (12px), which WCAG 1.4.3 counts
    // as NORMAL text at 4.5:1 — the exact rule this codebase got wrong once. The dark
    // ramp returns opaque composited fills, so these are the ratios a user really sees.
    for (const percent of STEPS) {
      const step = flowTint(percent, t);
      expect(contrastRatio(step.text, step.background), `flow ${percent}%`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it('travels upward in colour — more colour means a better day', () => {
    // The inverse of the light ramp's direction: on charcoal a stronger day is a
    // *lighter* cell, so each step must stand further off `surface` than the last.
    const steps = STEPS.map((percent) => contrastRatio(flowTint(percent, t).background, t.surface));

    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i] as number, `step ${STEPS[i]}%`).toBeGreaterThan(steps[i - 1] as number);
    }
  });

  it('gives a logged-but-zero day a visible fill, distinct from an empty cell', () => {
    // Same statement as light mode: a day logged at 0% and a day with nothing logged at
    // all are different things, and the grid draws the latter as a hollow outline.
    const zero = flowTint(0, t);
    expect(zero.background).not.toBe('transparent');
    expect(contrastRatio(zero.background, t.surface)).toBeGreaterThan(1.05);
  });

  it('clamps out-of-range input rather than throwing', () => {
    expect(flowTint(-10, t)).toEqual(flowTint(0, t));
    expect(flowTint(999, t)).toEqual(flowTint(100, t));
  });
});
