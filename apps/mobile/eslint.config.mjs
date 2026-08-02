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
      // `.value`, but a template literal with no interpolation (`` `../theme/palette.js` ``)
      // is a different node shape — its text lives on `quasis[0].value.raw`, and `.value`
      // is simply absent, so the string-literal selector silently never matches it.
      // `quasis.length=1` (equivalently, zero expressions) is what confines this to a
      // *statically analysable* template literal; one with a real `${...}` interpolation
      // has more than one quasi and cannot be matched here at all — see the blind-spot note.
      'no-restricted-syntax': [
        'error',
        {
          selector: "ImportExpression[source.value=/theme\\/palette/]",
          message:
            'Import semantic tokens via useTheme() from theme/ThemeProvider instead of raw palette values.',
        },
        {
          selector:
            "ImportExpression[source.type='TemplateLiteral'][source.quasis.length=1][source.quasis.0.value.raw=/theme\\/palette/]",
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
            "CallExpression[callee.name='require'][arguments.0.type='TemplateLiteral'][arguments.0.quasis.length=1][arguments.0.quasis.0.value.raw=/theme\\/palette/]",
          message:
            'Import semantic tokens via useTheme() from theme/ThemeProvider instead of raw palette values.',
        },
      ],
    },
  },
];
