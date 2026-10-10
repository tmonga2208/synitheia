import { describe, expect, it } from 'vitest';
import { shouldDeferHydrate } from './launch.js';

describe('shouldDeferHydrate', () => {
  it('defers the session check on a launch the user cannot see', () => {
    expect(shouldDeferHydrate('background')).toBe(true);
  });

  it.each(['active', 'inactive', 'unknown', 'extension', null, undefined])(
    'checks the session straight away when the app state is %j',
    (state) => {
      // Anything but a definite "background" must not delay sign-in: iOS reports
      // 'inactive' or 'unknown' for a moment during an ordinary cold start, and waiting
      // there for an 'active' event that already happened would hold the splash forever.
      expect(shouldDeferHydrate(state)).toBe(false);
    },
  );
});
