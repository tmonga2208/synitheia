# Dark Mode — implementation run notes

Companion to `../specs/2026-08-02-dark-mode-design.md` and
`../plans/2026-08-02-dark-mode.md`.

Dark mode shipped in 32 commits across nine tasks: a semantic theme layer, all 45
colour-bearing files converted, a Light/Dark/System control, `Appearance.setColorScheme()`
so the native layer follows the app, and a lint guard that makes the conversion permanent.

This file records what still needs a human, what was knowingly left undone, and the
decisions a reader of the diff could not reconstruct.

---

## 1. The device pass — nothing here has been rendered

Every check during implementation was typecheck, lint and code reading. This repo has no
React Native component test infrastructure and the plan deliberately did not add one, so
the automated suite cannot tell you the app looks right.

**Before anything else: run `npx expo prebuild --clean`.**

`apps/mobile/ios/` is gitignored output generated before `app.json` flipped to
`"userInterfaceStyle": "automatic"`, and the stale `Info.plist` still contains
`UIUserInterfaceStyle: Light`. Building from it force-locks the app to light — dark mode
will appear completely broken, and the whole session will be a false negative. A fresh
prebuild also rewrites that key to `Automatic`, because a configured dark splash sets it.

### Walk every screen in both appearances

Toggle the simulator with `Cmd+Shift+A` on: Today, Trackers, Profile, History, a day
screen, Habits, a habit detail, New Habit, Expenses, an expense detail, New Expense, Owed,
Subscriptions, Nutrition, New Food, Food Photo, Water, Body, Targets, Reminders, Insights,
Privacy, Setup, Onboarding, Sign in, Sign up.

For each: no bone-white flash, text legible, cards separable from the ground, icons on
filled controls visible.

### The specific things most likely to be wrong

- **The splash screen on a cold start in dark.** Newly fixed and only observable this way.
- **The iOS keyboard.** No `keyboardAppearance` is set on any `TextInput`. The theory is
  that `Appearance.setColorScheme()` makes it follow, but the keyboard renders in its own
  window which may not be in `scene.windows`. If it stays light, the fix is
  `keyboardAppearance={t.name === 'dark' ? 'dark' : 'light'}` on the `Input` primitive.
- **Alerts, action sheets and the status bar** following an in-app override.
- **An OFF switch in dark.** The thumb-against-track ratio is at parity with light
  (1.3713 vs 1.3980), but light gets its separation from an iOS drop shadow that is
  invisible on charcoal. Privacy has three switches on one screen — the best place to
  judge it. If it reads badly, note that `onAccent` is a questionable *role* for a switch
  thumb anyway, since the OFF thumb does not sit on an accent.
- **`EmptyState` icon circles.** Near-black glyph on `accentSoft` at 3.5430 — better than
  light's 2.0820, but the lowest-contrast glyph pairing in the app in either theme.
  Visible on Habits, Insights, Reminders, Expenses and Today.
- **The `MonthGrid` "today" ring**, `accentSoft` on `surface` at 3.3367, dropping to
  3.0753 on a band-0 cell. Does it still read as a ring on a filled cell?
- **The eight habit accents on Habits** — still eight distinguishable colours, or eight
  near-greys? Measured ΔE2000 says distinguishable; confirm by eye.
- **The History grid's three cell states** — out-of-month blank, hollow, tinted.
- **A crash in dark mode.** Force one and confirm the *themed* inner fallback renders, not
  the bone-white static one. Then check the status bar: `ThemedShell`'s `StatusBar`
  unmounts with the provider, so a provider-level crash in dark shows the light fallback
  with light status-bar glyphs.
- **Switching Light → System on a light phone, mid-session.** The most intricate path in
  the feature — it depends on the iOS trait-change notification round trip completing, not
  on the React render.
- **Android cold start with a stored non-`system` preference.** `AppCompatDelegate`
  `setDefaultNightMode` can recreate the activity at launch; `androidx` is not vendored, so
  this cannot be settled from source.
- **The tab bar in both themes**, including its background and inactive items.

---

## 2. Known limits

**The splash follows the OS, never the in-app override.** It renders before any JS runs,
so nothing can read a preference stored in AsyncStorage. Pin Dark on a light phone and the
splash is still light. No configuration fixes this.

**The lint guard catches every module-loading route to raw palette written with a
statically analysable specifier** — static import, `import type`, `require()`, dynamic
`import()`, string or expression-free template literal, and namespace imports. Three things
it does not catch, recorded in full in `apps/mobile/eslint.config.mjs`:

1. A specifier whose identifying substring straddles an interpolation or is assembled by
   concatenation. Inherent — no lint rule can resolve these.
2. An aliased `require` (`const r = require; r(...)`). Addressable in principle, declined
   deliberately: the guard defends against habit and bundler workarounds, not against
   someone deliberately evading a lint rule.
3. **Raw colour literals, the largest practical gap.** They never import anything, so an
   import-based rule cannot see them. `Timeline.tsx`'s `DOMAIN_COLOR` and the
   server-supplied category colours in the expense screens are live examples.

**Light-mode changes.** Exactly two, both deliberate, both recorded in the spec and at
their call sites: `MonthGrid.tsx`'s future-day numeral and `history.tsx`'s disabled
month-stepper chevrons, each moving `#DBDAD7` → `#A3A3A0` (1.3303 → 2.4065 on bone).
`textFaint` is the documented role for a disabled control, and `t.border` would have
rendered them at 1.3713 in dark — invisible.

**Accessibility debt inherited from light mode**, now asserted in
`theme.contrast.test.ts` rather than merely known: `onAccent` on `accentSoft` at 2.0820,
`onAccent` on the habit bases at 2.8633–3.3441, `accent` on `accentWash` at 2.8202, plus
`warning` at 2.4771 and `danger` at 3.7499. Every one is a light-mode figure that dark
improves on. None was introduced by this work.

---

## 3. Follow-ups

1. `Timeline.tsx`'s `DOMAIN_COLOR` renders raw light-mode hexes in both themes. They gain
   contrast on charcoal (5.06–6.69 versus 2.41–3.18 on bone), so this is a consistency
   problem rather than a legibility one — the same hexes go through `accentFor(hex, t)`
   everywhere else in the app.
2. The light-mode accessibility debt above deserves its own pass. It was deliberately not
   fixed inside a dark-mode change, where no reviewer would expect a light-mode restyle.
3. `useThemePreference()` returns `resolved`, which nothing consumes. Dead surface on the
   hook a future appearance feature reaches for first — and comparing against `resolved`
   instead of `preference` is precisely the bug the Appearance control was praised for
   avoiding.
4. `eslint.config.mjs`'s guard globs cover only `.ts`/`.tsx`. A `.js`/`.mjs` file added
   under `app/` or `src/` would be unguarded.

---

## 4. Decisions worth knowing

**`onAccent` inverts between themes, and that is correct.** Dark mode lifts sage to
`#89A889` so it reads as an accent on charcoal; white on that is 2.62:1 and vanishes, while
near-black is 6.86:1. The alternative — a sage dark enough for white text — sits at roughly
2.5:1 against the surface and stops reading as an accent at all. Never "fix" it back.

**`Appearance.setColorScheme()` is what makes the override mean anything.** Before it, a
user who set the app to Dark on a light phone got a dark app with a light keyboard and
light alerts. It is keyed on the raw *preference*, not the resolved theme — `'system'`
resets to `null`, so the app keeps following later OS changes rather than pinning itself.

**Two error boundaries, deliberately.** The outer one is above the provider and uses static
light colours; the inner one is inside it and is themed. This exists because converting the
primitives made `Text` and `Button` call `useTheme()` unconditionally — which throws
outside the provider. With a single outer boundary, *any* crash would have thrown again
from inside the boundary's own render and unmounted the tree to a blank screen. The
`themed` prop defaults to the safe path, so a third boundary added carelessly gets static
colours rather than the trap.

**Depth comes from a surface scale, not shadows.** On `#15171A` a `#5A5A50` shadow at 0.06
opacity is invisible, so `shadow` resolves to `shadow.none` in dark and cards read as
raised by being lighter than the ground.

**Sheets use `surface`, not `surfaceRaised`.** A sheet reads as raised against the scrim,
which is also how the light app already behaves. `surfaceRaised` is for small inset
controls — chips, inputs, secondary buttons.

---

## 5. Process notes

The conversion itself was mechanical; the value was almost entirely in review. Three
findings would each have shipped a visible defect and none was reachable by any test:

- Converting the primitives silently broke the error boundary, because it renders outside
  the provider. Found by a later implementer noticing the transitive consequence of an
  already-approved change.
- The lint guard needed three rounds. Each round proved the guard fired; each subsequent
  review asked instead whether it could be *bypassed*, and found it could —
  `require()`, then template literals, then templates with interpolation outside the
  identifying substring. "The guard works" and "the guard cannot be defeated" are different
  claims. Hardening was stopped deliberately at the point where every plausible accident is
  caught and the remaining gaps are documented.
- The splash screen was still bone-white — the spec's own problem statement surviving into
  the finished feature, on screen for the entire startup.

Two habits earned their keep. **Measuring instead of recalling**: three contrast figures
were wrong at some point in this run, each because someone reasoned about a number instead
of running `contrastRatio()` — and one of those was relayed by the coordinator. **Checking
a claim before relaying it**: a reviewer's true-but-over-general finding was passed along
unverified and turned a correct report into an incorrect one.

The thing most worth carrying forward is about durability, not correctness. Rulings that
the code depends on kept being written into task reports that get deleted, while the code
retained pointers to them. When a report contains a ruling the code relies on, the ruling
belongs in the code or in `docs/` before the task is called done.
