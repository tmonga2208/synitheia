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
  sitting on filled sage controls, and switch thumbs. Must stay near-white in dark, or
  every icon on a sage button disappears.

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
surfaceRaised   a sheet, a menu, anything above a card
border          hairline separators and card edges
textPrimary     body and headings
textMuted       metadata, secondary copy
textFaint       disabled, placeholder
accent          the sage anchor
accentSoft      the sage used for de-emphasised marks
accentWash      tinted fills behind icons
onAccent        anything drawn ON a filled accent control  ← stays near-white in both
danger, warning unchanged in role
```

### The dark surface scale

```
bg             #15171A
surface        #1A1D21
surfaceRaised  #20242A
border         #24282D
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
