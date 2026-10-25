/** Mirrors the server's policy (auth/routes.ts) and sign-up: length over composition rules. */
export const MIN_PASSWORD_LENGTH = 10;

/** What is wrong with a reset form before it is sent, field by field. Empty when nothing is. */
export function resetFormErrors(input: {
  code: string;
  password: string;
}): Partial<Record<'code' | 'password', string>> {
  const errors: Partial<Record<'code' | 'password', string>> = {};
  if (!/^\d{6}$/.test(input.code.trim())) errors.code = 'Enter the six-digit code from the email';
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  return errors;
}
