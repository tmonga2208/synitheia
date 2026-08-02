import { describe, expect, it } from 'vitest';
import { composite, contrastRatio } from './contrast.js';
import { darkTheme, flowTint, lightTheme, type Theme } from './theme.js';

/**
 * Flatten a fill that may be an `rgba()` string over the surface it is drawn on.
 *
 * The light flow ramp's middle bands are alpha tints, and a contrast ratio can only be
 * computed against an opaque colour. `contrastRatio` not accepting `rgba()` is not a reason
 * to leave those bands unmeasured — it is the reason `composite` exists.
 */
function flatten(fill: string, surface: string): string {
  const m = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/.exec(fill);
  if (!m) return fill;

  const hex = `#${[1, 2, 3]
    .map((i) => Number(m[i]).toString(16).padStart(2, '0'))
    .join('')}`;
  return composite(hex, Number(m[4]), surface);
}

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
  //
  // These two rows record the WORST of the eight, which is what an exception floor means.
  // They deliberately do not hold the other seven — `HABIT_RATIOS` below pins every accent
  // individually, because a group floor on its own would let sage `text` fall from 4.9319
  // to 4.08 without a single test noticing.
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

/**
 * What each habit accent measures against its own theme's `surface`, per habit rather than
 * per group.
 *
 * The group floors in `EXCEPTIONS` record the worst of the eight, which is the right shape
 * for an exception but the wrong shape for a guard: with only those, seven of the eight
 * light accents could drift by up to 0.85 and still pass. The light set is ratified to ship
 * exactly as it is, and nothing else in the repo pins it — `tokens.test.ts` covers only
 * `flowTint`, and it is deleted in Task 9 with the rest of the shim. So each accent is held
 * to its own number here.
 *
 * Dark is pinned on the same terms. Its floors are the real 3.0 / 4.5, so without this an
 * accent could silently slide from the 3.15 / 5.0 the derivation targeted down to the bare
 * minimum and still be "passing".
 */
const HABIT_RATIOS: Record<string, Record<string, { base: number; wash: number; text: number }>> = {
  light: {
    '#7D927D': { base: 3.1821, wash: 1.1283, text: 4.9319 }, // sage
    '#7D8FA9': { base: 3.1351, wash: 1.1595, text: 4.7587 }, // indigo
    '#C08A7D': { base: 2.7859, wash: 1.1325, text: 4.3282 }, // clay
    '#B0917D': { base: 2.7784, wash: 1.1335, text: 4.3011 }, // sand
    '#8A9AA9': { base: 2.7465, wash: 1.1203, text: 4.0884 }, // slate
    '#A98DA9': { base: 2.8265, wash: 1.1342, text: 4.5016 }, // mauve
    '#7DA095': { base: 2.7246, wash: 1.115, text: 4.1414 }, // teal
    '#B08A8A': { base: 2.9179, wash: 1.143, text: 4.5573 }, // rose
  },
  dark: {
    '#7D927D': { base: 3.1661, wash: 1.187, text: 5.013 }, // sage
    '#7D8FA9': { base: 3.1536, wash: 1.1855, text: 5.0469 }, // indigo
    '#C08A7D': { base: 3.1656, wash: 1.175, text: 5.0326 }, // clay
    '#B0917D': { base: 3.1582, wash: 1.1791, text: 5.0614 }, // sand
    '#8A9AA9': { base: 3.1532, wash: 1.1841, text: 5.0333 }, // slate
    '#A98DA9': { base: 3.1601, wash: 1.1892, text: 5.0231 }, // mauve
    '#7DA095': { base: 3.1857, wash: 1.1849, text: 5.0235 }, // teal
    '#B08A8A': { base: 3.1619, wash: 1.1831, text: 5.0218 }, // rose
  },
};

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

  it('holds every habit accent individually where it ships', () => {
    // The guard the group floors above cannot provide. Tolerance is 0.005 — tight enough
    // that no perceptible colour change survives it.
    const pinned = HABIT_RATIOS[name] as Record<string, Record<string, number>>;

    for (const [color, accent] of Object.entries(t.habitAccents)) {
      const expected = pinned[color] as Record<string, number>;

      for (const field of ['base', 'wash', 'text'] as const) {
        const actual = contrastRatio(accent[field], t.surface);
        const was = expected[field] as number;
        const direction = actual > was ? 'UP' : 'DOWN';

        expect(
          Math.abs(actual - was),
          `${name} habit ${color} .${field} moved ${direction}: ${was} → ${actual.toFixed(4)} ` +
            `(now ${accent[field]}). These colours are ratified to ship exactly as they are; ` +
            `if the change is intended, update HABIT_RATIOS and say so in the commit.`,
        ).toBeLessThan(0.005);
      }
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

/**
 * The History calendar's heat-map, both themes.
 *
 * The light ramp used to be covered only by `tokens.test.ts`, which imports the `tokens.js`
 * shim and is therefore deleted in Task 9 — leaving the light heat-map with no coverage at
 * all, in the one feature where this repo has already shipped a WCAG defect. These are the
 * assertions ported across so that does not happen.
 */
const BANDS: [label: string, sample: number][] = [
  ['0–14', 0],
  ['15–39', 20],
  ['40–64', 50],
  ['65–84', 70],
  ['85–100', 95],
];

describe.each(THEMES)('%s flowTint ramp', (name, t) => {
  // The light ramp's middle bands are alpha over the page; `composite` exists precisely so
  // they can still be measured. Measuring a tint against its own base rather than its
  // composite would report a number the user never sees.
  const fills = BANDS.map(([, percent]) => flatten(flowTint(percent, t).background, t.surface));

  it('keeps every band’s numeral legible on its own fill', () => {
    // MonthGrid renders date numerals at `type.caption` (12px), which WCAG 1.4.3 counts as
    // NORMAL text at 4.5:1, not the 3:1 large-text floor. That is the rule that was got
    // wrong here once, from memory rather than measurement.
    BANDS.forEach(([label, percent], i) => {
      const step = flowTint(percent, t);
      // Only the solid top band is excepted, and only in light — where that band IS the
      // `onAccent`-on-`accentDeep` pairing already recorded above, so it reuses that floor
      // rather than adding a second entry for one colour pair. Dark's top band is
      // `onAccent` on `accent` and is held to the full 4.5.
      const floor = i === BANDS.length - 1 ? floorFor('onAccent/accentDeep', name) : 4.5;

      expect(
        contrastRatio(step.text, fills[i] as string),
        `${name} ${label}% — numeral ${step.text} on ${fills[i]}`,
      ).toBeGreaterThanOrEqual(floor);
    });
  });

  it('is monotonic — a better day is never a weaker fill', () => {
    // The two ramps travel in opposite directions (light darkens away from bone, dark
    // lightens away from charcoal), so the shared property is distance from `surface`
    // rather than luminance. Either way: more colour = better day.
    const distances = fills.map((f) => contrastRatio(f, t.surface));

    for (let i = 1; i < distances.length; i += 1) {
      expect(
        distances[i] as number,
        `${name} band ${BANDS[i]?.[0]}% is no further from surface than ${BANDS[i - 1]?.[0]}%`,
      ).toBeGreaterThan(distances[i - 1] as number);
    }
  });

  it('puts the band boundaries exactly where they are specified', () => {
    // The thresholds are the contract and are identical in both themes.
    for (const [lastOfBand, firstOfNext] of [
      [14, 15],
      [39, 40],
      [64, 65],
      [84, 85],
    ]) {
      expect(flowTint(lastOfBand as number, t), `${lastOfBand}% must stay in its band`).not.toEqual(
        flowTint(firstOfNext as number, t),
      );
    }
    // ...and nothing inside a band moves.
    expect(flowTint(15, t)).toEqual(flowTint(39, t));
    expect(flowTint(40, t)).toEqual(flowTint(64, t));
    expect(flowTint(65, t)).toEqual(flowTint(84, t));
    expect(flowTint(85, t)).toEqual(flowTint(100, t));
  });

  it('gives a logged-but-zero day a visible fill, distinct from an empty cell', () => {
    // A day logged at 0% and a day with nothing logged at all are different statements.
    // The grid draws the latter as a hollow outline and must never reuse this fill for it.
    const zero = flowTint(0, t);
    expect(zero.background).not.toBe('transparent');
    expect(contrastRatio(fills[0] as string, t.surface)).toBeGreaterThan(1.05);
  });

  it('clamps out-of-range input rather than throwing', () => {
    expect(flowTint(-10, t)).toEqual(flowTint(0, t));
    expect(flowTint(999, t)).toEqual(flowTint(100, t));
  });
});

describe('the light flowTint ramp ships the exact fills it always has', () => {
  it('pins every band, including the rgba strings', () => {
    // `tokens.test.ts` pins these today and goes away with the shim in Task 9. Pinned as
    // literals rather than as ratios because the alpha values themselves are the contract —
    // MonthGrid draws these straight into a style.
    expect(lightTheme.flowRamp).toEqual([
      { background: '#EFECEA', text: '#6B6B68' },
      { background: 'rgba(125, 146, 125, 0.24)', text: '#2D2D2D' },
      { background: 'rgba(125, 146, 125, 0.46)', text: '#2D2D2D' },
      { background: 'rgba(125, 146, 125, 0.74)', text: '#2D2D2D' },
      { background: '#67806A', text: '#FFFFFF' },
    ]);
  });

  it('keeps the top band on sageDeep rather than sage', () => {
    // sageDeep measures 4.3099 against white; sage measures 3.3441 and fails outright. A
    // future "simplification" back to sage is a regression, not a tidy-up.
    expect(lightTheme.flowRamp[4].background).toBe(lightTheme.accentDeep);
    expect(contrastRatio(lightTheme.onAccent, lightTheme.accentDeep)).toBeGreaterThan(
      contrastRatio(lightTheme.onAccent, lightTheme.accent),
    );
  });
});

describe('the habit accents ship the exact colours they were ratified at', () => {
  // `HABIT_RATIOS` pins what each accent measures; this pins what each accent IS. Both are
  // needed: a hue change that happened to preserve its contrast ratio would pass the first
  // and still repaint eight habit cards.
  it('light', () => {
    expect(lightTheme.habitAccents).toEqual({
      '#7D927D': { base: '#7D927D', wash: '#E8EDE8', text: '#5E7260' },
      '#7D8FA9': { base: '#7D8FA9', wash: '#E5E9EF', text: '#5E7189' },
      '#C08A7D': { base: '#C08A7D', wash: '#F4E9E6', text: '#9B6A5E' },
      '#B0917D': { base: '#B0917D', wash: '#F1EAE4', text: '#8C7160' },
      '#8A9AA9': { base: '#8A9AA9', wash: '#E9EDF0', text: '#6C7C8A' },
      '#A98DA9': { base: '#A98DA9', wash: '#F0E9F0', text: '#856B85' },
      '#7DA095': { base: '#7DA095', wash: '#E6EFEC', text: '#5E8076' },
      '#B08A8A': { base: '#B08A8A', wash: '#F2E8E8', text: '#8C6A6A' },
    });
  });

  it('dark', () => {
    expect(darkTheme.habitAccents).toEqual({
      '#7D927D': { base: '#597159', wash: '#252c2b', text: '#779377' },
      '#7D8FA9': { base: '#536c90', wash: '#242b35', text: '#768eb0' },
      '#C08A7D': { base: '#a6533f', wash: '#332726', text: '#c57865' },
      '#B0917D': { base: '#8a6248', wash: '#2e2928', text: '#b08366' },
      '#8A9AA9': { base: '#576d82', wash: '#252b32', text: '#778fa4' },
      '#A98DA9': { base: '#865d86', wash: '#2d2933', text: '#a77fa7' },
      '#7DA095': { base: '#4c7367', wash: '#232c2e', text: '#639686' },
      '#B08A8A': { base: '#975a5a', wash: '#31282b', text: '#b27f7f' },
    });
  });
});
