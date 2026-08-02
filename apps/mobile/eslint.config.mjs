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
      // selector. See the blind-spot note for what remains out of reach on principle.
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
