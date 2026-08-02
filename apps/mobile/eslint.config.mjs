import base from '@synitheia/config/eslint.base.mjs';

export default [
  ...base,
  {
    languageOptions: {
      globals: { console: 'readonly', fetch: 'readonly', FormData: 'readonly', setTimeout: 'readonly' },
    },
  },
  {
    // Raw colour scales are for the theme layer only. A component that reaches past
    // the semantic tokens is a component that will still be bone-white at midnight —
    // this rule turns that from a bug someone finds into a build failure.
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    ignores: ['src/theme/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/theme/palette', '**/theme/palette.js'],
              message:
                'Import semantic tokens via useTheme() from theme/ThemeProvider instead of raw palette values.',
            },
            {
              // `theme.ts` is NOT off-limits — it is where `spacing`, `radius`, `type`,
              // `motion`, `font` and the `Theme` type come from, and a file that uses no
              // colour should import them directly and skip the hook entirely. But four of
              // its exports are pre-resolved COLOUR, and blocking `palette` while leaving
              // them open left the guard trivially walk-around-able:
              //
              //   import { shadow } from '../theme/theme.js'   ← linted clean, and paints
              //                                                  light shadows in dark,
              //                                                  because dark resolves
              //                                                  every shadow to none via
              //                                                  `t.shadow`, not this.
              //   import { lightTheme } from '../theme/theme.js'  ← a whole light theme
              //   import { themes } from '../theme/theme.js'      ← both, by name
              //
              // All four must come through `useTheme()`/`useThemedStyles()` so they follow
              // the live appearance. Named imports only: `import * as theme from` still
              // slips past, for the same no-binding-resolution reason as the aliased
              // `require` in note 2 below, and is left on the same grounds.
              group: ['**/theme/theme', '**/theme/theme.js'],
              importNames: ['shadow', 'lightTheme', 'darkTheme', 'themes'],
              message:
                'These resolve to one theme’s colours at import time. Use useTheme()/useThemedStyles() so they follow the live appearance (t.shadow, not the static shadow export).',
            },
          ],
        },
      ],
      // `no-restricted-imports` only sees static `import` declarations. `require()` and
      // dynamic `import()` reach the same module through a CallExpression/ImportExpression
      // and are invisible to it — closing that gap here so neither becomes the back door
      // this rule exists to close.
      //
      // Each construct needs TWO selectors: a string-literal argument has its text on
      // `.value`, but a template literal is a different node shape entirely — there is no
      // `.value` on the literal as a whole, only on each `quasis[n]` chunk between the
      // `${...}` interpolations. The identifying substring only has to sit fully inside ONE
      // chunk to be provable statically — `` `../theme/palette${''}.js` `` has an
      // interpolation, but "theme/palette" is intact in `quasis[0]`, so this matches on
      // *any* quasi containing it rather than requiring the whole literal to be
      // interpolation-free. That is deliberately looser than "no interpolation anywhere" and
      // deliberately narrower than "any template literal": `` `../theme/${dir}/palette.js` ``
      // splits the substring itself across the interpolation, so no single quasi contains
      // it and neither selector fires — that case is genuinely unknowable, not a gap in the
      // selector.
      //
      // ── What this guard does NOT catch ──────────────────────────────────────────────
      // Three limits, and they are three structurally different kinds of thing. Read them
      // as such: only the third is worth anyone's time to close.
      //
      // 1. GENUINELY INHERENT. A specifier whose identifying substring straddles an
      //    interpolation — `` import(`../theme/${dir}/palette.js`) `` — or is assembled by
      //    concatenation (`'../theme/pal' + 'ette.js'`). "theme/palette" exists in no
      //    single static chunk, so there is nothing for a selector to match. No lint rule
      //    can resolve these; it would need to evaluate the expression. Not a gap to close.
      //
      // 2. ADDRESSABLE, BUT DECLINED. An aliased `require` —
      //    `const r = require; r('../theme/palette.js')` — evades every selector above,
      //    because `no-restricted-syntax` matches AST shape and has no binding resolution:
      //    it cannot know `r` IS `require`. A type-aware rule could. Deliberately not
      //    chased. This guard defends against habit (reaching for `palette` because that
      //    is what the file used to import) and against bundler workarounds, not against
      //    someone deliberately evading a lint rule. Anyone writing that line has already
      //    decided to defeat the check, and a reviewer catches it in one read.
      //
      // 3. THE LARGEST PRACTICAL GAP, and the one to remember. Raw colour LITERALS import
      //    nothing at all — `backgroundColor: '#FBF9F6'` written directly into a
      //    stylesheet is invisible to an import-based rule by construction, no matter how
      //    many selectors it grows. This is not hypothetical: `src/components/Timeline.tsx`
      //    holds `DOMAIN_COLOR` as literal hexes, and the expense screens render category
      //    colours supplied by the SERVER, which no static rule could ever see. Those are
      //    the live examples. Closing this needs a different tool — a no-hex-literal rule
      //    scoped to style objects — not a better version of this one.
      // ────────────────────────────────────────────────────────────────────────────────
      'no-restricted-syntax': [
        'error',
        {
          selector: "ImportExpression[source.value=/theme\\/palette/]",
          message:
            'Import semantic tokens via useTheme() from theme/ThemeProvider instead of raw palette values.',
        },
        {
          selector: "ImportExpression > TemplateLiteral > TemplateElement[value.raw=/theme\\/palette/]",
          message:
            'Import semantic tokens via useTheme() from theme/ThemeProvider instead of raw palette values.',
        },
        {
          selector:
            "CallExpression[callee.name='require'][arguments.0.value=/theme\\/palette/]",
          message:
            'Import semantic tokens via useTheme() from theme/ThemeProvider instead of raw palette values.',
        },
        {
          selector:
            "CallExpression[callee.name='require'] > TemplateLiteral > TemplateElement[value.raw=/theme\\/palette/]",
          message:
            'Import semantic tokens via useTheme() from theme/ThemeProvider instead of raw palette values.',
        },
      ],
    },
  },
];
