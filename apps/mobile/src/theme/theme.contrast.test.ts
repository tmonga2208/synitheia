import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast.js';
import { darkTheme, flowTint, lightTheme, type Theme } from './theme.js';

const THEMES: [name: string, t: Theme][] = [
  ['light', lightTheme],
  ['dark', darkTheme],
];

/**
 * Every pairing in this app that does NOT meet 4.5:1, with its measured ratio and the
 * decision behind it. An exception that is not written down here is a bug, not a decision.
 *
 * This list is the app's complete accessibility debt, in one place that runs on every
 * commit. Read it as a set of decisions, not as thresholds someone lowered to get green:
 * each floor is the pair's ACTUAL measured ratio, so if a colour is ever changed for the
 * worse the test still fails.
 *
 * Everything below is LIGHT-only and pre-existing — values that were already shipping
 * before dark mode and are unchanged by it. Dark mode introduced no exception of its own;
 * every dark pairing clears its full floor.
 */
const EXCEPTIONS = [
  // ── White on sage. RATIFIED, deferred. ───────────────────────────────────────────────
  // The app's primary buttons have always drawn white on sage, and the History grid's top
  // tint band inherited it. Predates dark mode by a long way. Dark has NO equivalent
  // entry: there `onAccent` inverts to near-black and measures 6.8635:1. See the doc on
  // `Theme['onAccent']` in theme.ts for why that inversion is correct and load-bearing.
  { pair: 'onAccent/accent', themes: ['light'], floor: 3.3 }, // measured 3.3441
  // The same white on the pressed/emphatic fill — the History grid's solid top band,
  // already pinned at this value by tokens.test.ts.
  { pair: 'onAccent/accentDeep', themes: ['light'], floor: 4.3 }, // measured 4.3099

  // ── Disabled and placeholder text. RATIFIED, permanent. ──────────────────────────────
  // WCAG 1.4.3 exempts disabled controls and placeholder text, so `textFaint` is recorded
  // at its measured value rather than held to 4.5:1. This is the one group that is not
  // debt: it is illegible *by design*, which is why nothing a user must read may use it.
  // Light is the existing `stoneFaint`; dark was tuned to clear 3:1 on all three surfaces.
  { pair: 'textFaint/bg', themes: ['light'], floor: 2.4 }, // measured 2.4065
  { pair: 'textFaint/surface', themes: ['light'], floor: 2.4 }, // measured 2.4065
  { pair: 'textFaint/surfaceRaised', themes: ['light'], floor: 2.1 }, // measured 2.1504
  // Dark's own `textFaint` was tuned to clear 3:1 on all three surfaces — the design rule
  // is asserted separately below; these floors, like every other floor here, are the
  // measurement.
  { pair: 'textFaint/bg', themes: ['dark'], floor: 3.69 }, // measured 3.6970
  { pair: 'textFaint/surface', themes: ['dark'], floor: 3.48 }, // measured 3.4818
  { pair: 'textFaint/surfaceRaised', themes: ['dark'], floor: 3.2 }, // measured 3.2090

  // ── The eight light habit accents. RATIFIED, deferred to an accessibility pass. ──────
  // These are the per-habit colours exactly as they ship, lifted from the old tokens.ts
  // unchanged and measured against a floor here for the first time.
  //
  //   six of the eight `base` values measure 2.7246 – 2.9179 against a 3.0 floor
  //   four of the eight `text` values measure 4.0884 – 4.3282 against a 4.5 floor
  //
  // Bringing them up means moving the per-habit colours by up to 21 RGB units, and
  // HabitCard's per-habit tinting is the most distinctive thing in this design. That is a
  // light-mode restyle, which is not a change any reviewer would expect to find inside a
  // dark-mode diff — so it is deliberately deferred to a separate accessibility pass
  // rather than smuggled in here. Decision taken 2026-08-02; see
  // .superpowers/sdd/2026-08-02-dark-mode/task-2-report.md for the derived replacement
  // values, already computed, if that pass ever happens.
  //
  // The DARK accents carry no exception: all eight clear 3.0 / 4.5 outright.
  { pair: 'habitAccent.base/surface', themes: ['light'], floor: 2.72 },
  { pair: 'habitAccent.text/surface', themes: ['light'], floor: 4.08 },

  // ── Status colours. RATIFIED, deferred to the same accessibility pass. ───────────────
  // `danger` and `warning` are both drawn as `type.caption` body text — field errors,
  // destructive labels, the duplicate-expense notice — so 4.5:1 applies and neither has
  // ever met it in light. `warning` at 2.4771 is the worst pairing in the entire app.
  // Pre-existing and unchanged by dark mode; both are clean in dark (danger 5.7184,
  // warning 7.9608 on surface), so this is a light-mode problem only.
  { pair: 'danger/bg', themes: ['light'], floor: 3.7 }, // measured 3.7499
  { pair: 'danger/surface', themes: ['light'], floor: 3.7 }, // measured 3.7499
  { pair: 'danger/surfaceRaised', themes: ['light'], floor: 3.3 }, // measured 3.3508
  { pair: 'warning/bg', themes: ['light'], floor: 2.4 }, // measured 2.4771
  { pair: 'warning/surface', themes: ['light'], floor: 2.4 }, // measured 2.4771
  { pair: 'warning/surfaceRaised', themes: ['light'], floor: 2.2 }, // measured 2.2135
];

function floorFor(pair: string, theme: string, fallback = 4.5): number {
  const e = EXCEPTIONS.find((x) => x.pair === pair && x.themes.includes(theme));
  return e ? e.floor : fallback;
}

/** The floor a pair would face if it were not excepted. */
function defaultFloorFor(pair: string): number {
  return pair === 'habitAccent.base/surface' ? 3 : 4.5;
}

/** The ratio a recorded pair actually measures, so the list can be checked against reality. */
function measure(pair: string, t: Theme): number {
  const colour = (token: string) => (t as unknown as Record<string, string>)[token] as string;

  if (pair.startsWith('habitAccent.')) {
    // The grouped rows stand for eight pairings; the worst of them is what the floor holds.
    const field = pair.slice('habitAccent.'.length).split('/')[0] as 'base' | 'text';
    return Math.min(
      ...Object.values(t.habitAccents).map((a) => contrastRatio(a[field], t.surface)),
    );
  }

  const [fg, bg] = pair.split('/') as [string, string];
  return contrastRatio(colour(fg), colour(bg));
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

  it('onAccent is legible on accentDeep', () => {
    // accentDeep is the pressed fill of the same control and the flow ramp's top band,
    // so whatever sits on `accent` has to survive the press.
    const ratio = contrastRatio(t.onAccent, t.accentDeep);
    expect(ratio).toBeGreaterThanOrEqual(floorFor('onAccent/accentDeep', name));
  });

  // `danger` and `warning` are body text, not decoration — field errors, destructive
  // labels and the duplicate-expense notice all render them at `type.caption`.
  for (const [sName, s] of surfaces) {
    for (const [cName, c] of [
      ['danger', t.danger],
      ['warning', t.warning],
    ] as [string, string][]) {
      it(`${cName} on ${sName} is legible`, () => {
        expect(contrastRatio(c, s)).toBeGreaterThanOrEqual(floorFor(`${cName}/${sName}`, name));
      });
    }
  }

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

describe('dark textFaint', () => {
  it('clears 3:1 on every dark surface', () => {
    // WCAG exempts it, but a disabled control the user cannot locate at all is its own
    // defect. This is the rule the dark value was tuned to; the EXCEPTIONS rows record
    // what it measures, which is a different question.
    for (const s of [darkTheme.bg, darkTheme.surface, darkTheme.surfaceRaised]) {
      expect(contrastRatio(darkTheme.textFaint, s), s).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('the exception list itself', () => {
  const THEME_BY_NAME: Record<string, Theme> = { light: lightTheme, dark: darkTheme };

  it('records no exception that is no longer needed', () => {
    // The mirror of "an exception nobody wrote down is a bug": an exception that outlived
    // the problem is a lie about the app's accessibility. If someone raises `warning` to
    // AA, this fails and tells them to delete the row rather than leaving a permanent
    // note claiming a defect that is fixed.
    for (const e of EXCEPTIONS) {
      for (const themeName of e.themes) {
        const t = THEME_BY_NAME[themeName] as Theme;
        expect(
          measure(e.pair, t),
          `${e.pair} in ${themeName} now clears its real floor — delete this exception`,
        ).toBeLessThan(defaultFloorFor(e.pair));
      }
    }
  });

  it('records every exception at its true measured ratio', () => {
    // The floors are measurements, not slack. Each must sit within 0.1 of what the pair
    // actually measures, so nobody can quiet a regression by nudging a number down.
    for (const e of EXCEPTIONS) {
      for (const themeName of e.themes) {
        const t = THEME_BY_NAME[themeName] as Theme;
        const actual = measure(e.pair, t);
        expect(actual, `${e.pair} in ${themeName}`).toBeGreaterThanOrEqual(e.floor);
        expect(actual - e.floor, `${e.pair} in ${themeName} floor is stale`).toBeLessThan(0.1);
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
