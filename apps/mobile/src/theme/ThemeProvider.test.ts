import { describe, expect, it } from 'vitest';
import { resolveTheme } from './ThemeProvider.js';

describe('resolveTheme', () => {
  it('follows the system when the preference is system', () => {
    expect(resolveTheme('system', 'dark')).toBe('dark');
    expect(resolveTheme('system', 'light')).toBe('light');
  });

  it('lets an explicit preference win over the system', () => {
    expect(resolveTheme('light', 'dark')).toBe('light');
    expect(resolveTheme('dark', 'light')).toBe('dark');
  });

  it('falls back to light when the system reports nothing', () => {
    // useColorScheme() returns null before the OS answers, and on some Android builds.
    // Defaulting to dark there would flash a dark screen at a light-mode user.
    expect(resolveTheme('system', null)).toBe('light');
  });

  it('still honours an explicit preference when the system reports nothing', () => {
    expect(resolveTheme('dark', null)).toBe('dark');
  });
});
