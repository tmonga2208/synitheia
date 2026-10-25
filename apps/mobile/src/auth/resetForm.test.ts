import { describe, expect, it } from 'vitest';
import { resetFormErrors } from './resetForm.js';

describe('resetFormErrors', () => {
  it('accepts a six-digit code and a long enough password', () => {
    expect(resetFormErrors({ code: ' 042719 ', password: 'new-password-456' })).toEqual({});
  });

  it('asks for the six digits from the email', () => {
    expect(resetFormErrors({ code: '42719', password: 'new-password-456' })).toEqual({
      code: 'Enter the six-digit code from the email',
    });
    expect(resetFormErrors({ code: 'abcdef', password: 'new-password-456' }).code).toBeDefined();
  });

  it('holds the new password to the same length rule as sign-up', () => {
    expect(resetFormErrors({ code: '042719', password: 'short' })).toEqual({
      password: 'Use at least 10 characters',
    });
  });
});
