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
    },
  },
];
