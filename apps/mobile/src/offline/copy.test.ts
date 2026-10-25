import { describe, expect, it } from 'vitest';
import { signOutMessage } from './copy.js';

describe('signOutMessage', () => {
  it('warns that waiting changes go with the sign-out', () => {
    expect(signOutMessage(3)).toBe(
      '3 changes made offline haven’t synced yet. Signing out now deletes them.',
    );
  });

  it('speaks of one change as one', () => {
    expect(signOutMessage(1)).toBe(
      '1 change made offline hasn’t synced yet. Signing out now deletes it.',
    );
  });

  it('says the usual thing when nothing is waiting', () => {
    expect(signOutMessage(0)).toBe('You will need to sign in again on this device.');
  });
});
