import { describe, expect, it } from 'vitest';
import { shouldRegister } from './registration.js';

const prefs = (p: Partial<{ health: boolean; calendar: boolean; background: boolean }>) => ({
  health: false,
  calendar: false,
  background: true,
  ...p,
});

describe('shouldRegister', () => {
  it('registers when signed in with a connected source and the switch on', () => {
    expect(shouldRegister({ signedIn: true, prefs: prefs({ health: true }) })).toBe(true);
    expect(shouldRegister({ signedIn: true, prefs: prefs({ calendar: true }) })).toBe(true);
  });

  it('does not register when signed out', () => {
    expect(shouldRegister({ signedIn: false, prefs: prefs({ health: true }) })).toBe(false);
  });

  it('does not register with nothing connected', () => {
    expect(shouldRegister({ signedIn: true, prefs: prefs({}) })).toBe(false);
  });

  it('does not register when the user has switched background sync off', () => {
    expect(
      shouldRegister({ signedIn: true, prefs: prefs({ health: true, background: false }) }),
    ).toBe(false);
  });
});
