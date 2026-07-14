import base from '@synitheia/config/eslint.base.mjs';

export default [
  ...base,
  {
    languageOptions: {
      globals: { console: 'readonly', fetch: 'readonly', FormData: 'readonly', setTimeout: 'readonly' },
    },
  },
];
