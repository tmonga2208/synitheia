# Dark Mode — Design Spec

Date: 2026-08-02
Status: approved, ready for implementation plan

---

## Problem

Synítheia is pinned to light. `app.json` sets `"userInterfaceStyle": "light"`, `_layout.tsx`
hardcodes `<StatusBar style="dark" />`, and every one of the 45 files that draws
something imports `palette` directly and bakes its colours into a module-level
`StyleSheet.create`. There are 569 such references. Nothing in the app can respond to
the OS appearance, and there is no theming layer to add one to.

A tracking app is opened last thing at night more than at any other time. Right now
that means a full-brightness bone-white screen.

## Solution

A semantic theme layer, and a full conversion of all 45 files to it — plus a lint rule
that makes it impossible to drift back.

---

## Decisions

| Question | Decision | Why |
|---|---|---|
| Coverage | All screens, in one go | A half-dark app is worse than none. One unconverted screen flashing bone-white at night is the bug everyone reports. |
| Mechanism | `useTheme()` + per-file `makeStyles(theme)` | Idiomatic React Native, fully typed, no new dependency, no flash on switch. Costs a few lines in every file; buys no magic. |
| Visual direction | **Cool charcoal** — `#15171A` base | Neutral and modern, and sage reads truest against it. |
| Depth | A three-step surface scale | Light mode gets depth from soft shadows; on `#15171A` a `#5A5A50` shadow at 0.06 opacity is invisible. Cards read as raised by being lighter than the ground. |
| Trigger | Follow the OS, plus a Light/Dark/System override | Most users never touch it; the ones who want to pin it can. |
| Override storage | Device-local, not synced | Appearance is a property of the device in your hand, not of the account. Syncing means your phone goes dark because you toggled a tablet. |

### Explicitly out of scope

- Per-habit theme customisation, or any user-chosen accent.
- An AMOLED "true black" variant. Revisit only if battery complaints appear.
- Theming anything outside `apps/mobile` — the API and shared package have no UI.

---

## The conversion is a semantic audit, not a rename

This is the load-bearing point, and the reason a mechanical find-and-replace produces a
broken app. The two most-used neutrals have **opposite fates**:

- `palette.bone` — 48 uses, every one of them `backgroundColor`. Always a surface.
  Becomes a dark surface.
- `palette.white` — used almost entirely as a **foreground**: icon glyphs and check marks
  sitting on filled sage controls, and switch thumbs. Becomes `onAccent`, whose whole job
  is being readable on `accent` — which is why it is a separate token from `surface`.

**`onAccent` inverts between themes, and that is correct.** Dark mode lifts sage to
`#89A889` so it still reads as an accent on charcoal; white on that measures **2.62:1**
and disappears, while near-black measures **6.86:1**. The alternative — keeping sage dark
enough for white text — puts the accent at roughly 2.5:1 against the surface, where it no
longer reads as an accent at all. Both figures were measured during implementation, not
assumed. A semantic token differing per theme is the point of having semantic tokens.

So each of the 569 references is classified by the **role it plays**, not by the token it
names. Any call site whose role cannot be determined from its immediate context is
flagged in the implementer's report rather than guessed.

## The theme layer

`src/theme/tokens.ts` splits into three files:

| File | Responsibility |
|---|---|
| `src/theme/palette.ts` | Raw colour scales only — a `light` and a `dark` object. Nothing outside `src/theme/` may import it. |
| `src/theme/theme.ts` | The semantic tokens and the `Theme` type, plus the unchanged `spacing` / `radius` / `type` / `motion` scales. |
| `src/theme/ThemeProvider.tsx` | Context, `useColorScheme()`, the persisted override, and the `useTheme()` hook. |

### Semantic tokens

```
bg              the screen behind everything
surface         a card
surfaceRaised   a small inset control: chips, inputs, secondary buttons
                (NOT sheets — a sheet uses `surface` and reads as raised against
                 the scrim, which is also how the light app already behaves)
border          hairline separators and card edges
textPrimary     body and headings
textMuted       metadata, secondary copy
textFaint       disabled, placeholder
accent          the sage anchor
accentSoft      the sage used for de-emphasised marks
accentWash      tinted fills behind icons
onAccent        anything drawn ON a filled accent control  ← inverts between themes
danger, warning unchanged in role
```

### The dark surface scale

```
bg             #15171A
surface        #1A1D21
surfaceRaised  #20242A
border         #2C3138
```

Depth comes from the step in lightness. The `shadow` tokens resolve to `shadow.none` in
dark; light mode keeps its existing shadows byte-for-byte.

### Component shape

```ts
const makeStyles = (t: Theme) => StyleSheet.create({
  card: { backgroundColor: t.surface, borderColor: t.border },
})

function Card() {
  const t = useTheme()
  const styles = useMemo(() => makeStyles(t), [t])
}
```

### Habit accents and flowTint

The eight habit accents are `base` / `wash` / `text` triples tuned against bone. Against
`#1A1D21` the washes go muddy and the text colours lose contrast, so each gains a dark
triple, derived by a stated rule rather than hand-picked per colour:

- **`base`** keeps its hue and saturation, lightened enough to hold 3:1 against
  `surface` — it is used for borders and filled affordances, not for text.
- **`text`** is the same hue lightened until it clears 4.5:1 against `surface`, since it
  carries the habit's metadata line.
- **`wash`** stops being a solid pastel and becomes a low-alpha tint of `base` composited
  over `surface`. A pastel that reads as "tinted" on bone reads as "washed out grey" on
  charcoal.

`flowTint`'s five-step ramp needs a dark equivalent for the same reason — sage over bone
at 24% alpha is invisible on charcoal. The dark ramp inverts the direction of travel:
low percentages sit just above the surface colour and high percentages approach solid
sage, so the scale still reads "more colour = better day".

Every value the rules produce is then **measured** by the contrast test below, not
eyeballed.

## Contrast is verified, not asserted

This codebase has already shipped one WCAG mistake, in the History calendar's tint
scale, because a threshold was cited from memory rather than computed. So the theme
carries a unit test that computes the actual contrast ratio for every text-on-surface
and text-on-accent pair, in **both** themes, and fails below 4.5:1 for body text.

Deliberate exceptions are listed explicitly in the test with their measured ratio and a
reason. An exception that is not written down is a bug.

Note the pre-existing exception this will surface: `onAccent` on `accent` — white on
sage — measures 3.34:1 in light mode, and the History grid's top tint band was already
recorded as shipping at 4.31:1, short of AA. The test must record these rather than
quietly pass them.

## Light-mode changes

The conversion's standing rule is that light mode stays byte-identical, and it does
almost everywhere. There are **exactly two** deliberate exceptions, both the same change,
both verified against the light-mode diff:

| Where | Was | Now | On bone |
|---|---|---|---|
| `src/components/MonthGrid.tsx` — the future-day numeral | `palette.surfaceDim` `#DBDAD7` | `t.textFaint` `#A3A3A0` | 1.3303 → 2.4065 |
| `app/history.tsx` — the two disabled month-stepper chevrons | `palette.surfaceDim` `#DBDAD7` | `t.textFaint` `#A3A3A0` | 1.3303 → 2.4065 |

Both are deliberate and both are recorded at their call sites as well as here, so that
someone diffing light-mode screenshots does not read them as regressions.

The reason is the same in both cases. `#DBDAD7` is a *border* colour being used as a
disabled *foreground*, so the mechanical token swap would have been `t.border` — which
renders at **1.3713 against dark `bg`**, i.e. invisible. `textFaint` is the documented
role for a disabled control (and is WCAG 1.4.3-exempt as such), so the semantic audit
classified these by role rather than by token, which is the whole premise of the
conversion. Light mode gets slightly *more* legible as a side effect.

Nothing else moves. In particular `DateField.tsx` and `SplitWith.tsx` involved
token-choice judgment calls — `t.bg` versus `t.onAccent` — that resolve to the same
literal in light and therefore produce **zero** light-mode change. They are not on this
list, and the count is two, not four.

## The splash screen, and the one thing this feature cannot fix

A cold start used to open with a full-brightness bone flash held for the whole of startup
— this spec's own problem statement surviving into the implementation, since `_layout.tsx`
returns `null` and holds the splash until fonts and theme hydration both resolve. `app.json`
now carries a dark splash variant (`#15171A`, the theme's `bg`). The splash asset is a
transparent-backed sage mark and composites correctly on either ground, so both variants
share it.

**Where that has to be configured, and the trap.** A dark splash must be declared in the
`expo-splash-screen` **config plugin block**, which is what this app.json now uses. Putting
`dark` inside the legacy top-level `"splash"` key looks right and does **nothing** — it is
silently ignored on both platforms. Verified against the installed
`@expo/prebuild-config`, not assumed:

- `getIosSplashConfig`'s `config.splash` branch constructs its return value without a
  `dark` property at all. Only the plugin-props branch and `config.ios.splash` read one.
- `getAndroidDarkSplashConfig` returns `null` unless it finds `props.dark` (the plugin) or
  `config.android.splash.dark`. It never consults `config.splash.dark`.

Resolving the config both ways confirms it: with the plugin, iOS gets
`dark.backgroundColor: '#15171A'` and Android's dark config is populated; without it, iOS
has no `dark` key and Android's is `null`.

The top-level `splash` block is therefore left with its **light values only**. A mirrored
`dark` key there was tried and removed: it changed nothing in the resolved config, and
leaving an inert copy of exactly the trap this section documents — sitting in a JSON file
that cannot carry a comment warning it is inert — is worse than not having it. The plugin
block is the single place a dark splash is declared. The plugin's light values
(`imageWidth: 200`, `enableFullScreenImage_legacy: true`) reproduce exactly what the legacy
top-level path produced: without them the iOS image name and layout mode change and the
Android mark halves from 200 to 100, which would have been a silent light-mode regression
inside a dark-only fix.

One useful side effect: `withIosSplashInfoPlist` sets `UIUserInterfaceStyle = 'Automatic'`
whenever a dark splash is configured, so the next prebuild also clears the stale `Light`
value in `ios/Info.plist` — which was a device-pass blocker in its own right.

`apps/mobile/ios/` is gitignored prebuild output, so this takes effect on the next
`expo prebuild`; an existing local native project keeps the old splash until regenerated.

**The honest limit:** the splash is drawn by the OS before any JavaScript runs, so it can
only follow the **OS** appearance — never the in-app Light/Dark/System override, which
lives in AsyncStorage and is not readable at that point by anything. A user who pins
**Dark** on a **light** phone still gets a light splash for the duration of startup, and
the reverse is true too. This is a property of every splash screen on both platforms, not
a gap in the implementation; there is no configuration that fixes it. Recorded here
rather than left to be rediscovered.

## The lint guard

An ESLint rule forbidding imports of `src/theme/palette` from anywhere outside
`src/theme/`. After the conversion, a file that hardcodes a light colour **fails the
build**.

This is what makes the "all screens" decision hold over time. Without it the app drifts
back to half-dark one pull request at a time, and nobody notices until they open it at
night.

It also catches the three easy-to-miss spots: `_layout.tsx`'s hardcoded
`<StatusBar style="dark" />` and its `contentStyle` background, and `app.json`'s
`"userInterfaceStyle": "light"` → `"automatic"`.

## Conversion order

Theme layer → primitives → remaining components → screens → the override UI.

`src/components/primitives.tsx` is the base that nearly every other file imports, so
converting it early shrinks every downstream diff.

## Testing and verification

- **Contrast test** — as above, both themes, every pair.
- **Theme resolution test** — the override precedence: an explicit Light/Dark choice wins
  over the OS; "System" follows it; the resolved value survives a reload.
- **Typecheck and lint** across all packages, including the new rule.

There is no React Native component test infrastructure in this repo and this spec does
not introduce one. That is a deliberate limit, and it means **the automated suite cannot
tell you the app looks right** — a contrast test proves legibility, not quality.

So the plan ends with a **device pass over every screen in both appearances**, as a real
step rather than a follow-up. The History calendar shipped without ever being rendered,
and two of its visual questions are still open in the run notes. Dark mode is entirely
visual; the same omission would be worse here.
