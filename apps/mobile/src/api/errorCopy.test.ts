import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'afterFirstUnlockThisDeviceOnly',
}));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-crypto', () => ({
  getRandomBytes: (count: number) => webcrypto.getRandomValues(new Uint8Array(count)),
  randomUUID: () => webcrypto.randomUUID(),
}));

const { ApiError, NetworkError } = await import('./client.js');
const { describeError, errorLine } = await import('./errorCopy.js');

const body = (code: string, message: string) => ({ error: { code, message, requestId: 'r' } });

describe('describeError', () => {
  it('says when the phone is offline, and what to do', () => {
    expect(describeError(new NetworkError('offline'))).toMatchObject({
      title: 'You’re offline',
      message: 'Check your connection, then try again.',
    });
  });

  it('says when the server did not answer in time', () => {
    expect(describeError(new NetworkError('timeout'))).toMatchObject({
      title: 'No answer from Synítheia',
      message: 'The connection is slow or down. Try again in a moment.',
    });
  });

  it('owns a server failure, and says the data is safe', () => {
    expect(describeError(new ApiError(502, null, 'Request failed with 502'))).toMatchObject({
      title: 'Synítheia isn’t answering',
      message: 'Our server is having trouble. Your data is safe; try again in a minute.',
    });
  });

  it('asks for a pause after too many tries', () => {
    expect(describeError(new ApiError(429, body('rate_limited', 'Too many requests'), ''))).toMatchObject({
      title: 'Slow down a little',
      message: 'Too many tries in a row. Wait a minute, then try again.',
    });
  });

  it('passes on the server’s reason for refusing input, unless it is the generic one', () => {
    expect(
      describeError(new ApiError(422, body('validation_failed', 'Request validation failed'), '')),
    ).toMatchObject({ title: 'That wasn’t accepted', message: 'Check what you entered and try again.' });

    expect(
      describeError(new ApiError(422, body('validation_failed', 'Amount must be positive'), '')),
    ).toMatchObject({ title: 'That wasn’t accepted', message: 'Amount must be positive' });
  });

  it('passes on what the server said for any other refusal', () => {
    expect(
      describeError(new ApiError(400, body('bad_request', 'Cannot log a habit for a future date'), '')),
    ).toMatchObject({ title: 'Couldn’t do that', message: 'Cannot log a habit for a future date' });
  });

  it('keeps a message the app wrote for the user', () => {
    expect(describeError(new Error('Calendar access was not granted.'))).toMatchObject({
      title: 'Couldn’t do that',
      message: 'Calendar access was not granted.',
    });
  });

  it('never shows a programming error’s text', () => {
    expect(describeError(new TypeError('undefined is not a function'), 'Could not save this.')).toMatchObject({
      title: 'Couldn’t do that',
      message: 'Could not save this.',
    });
    expect(describeError('boom')).toMatchObject({ title: 'Couldn’t do that', message: 'Try again.' });
  });

  it('names the cause, so a screen can head it right', () => {
    const causes = [
      new NetworkError('offline'),
      new NetworkError('timeout'),
      new ApiError(503, null, ''),
      new ApiError(429, body('rate_limited', 'Too many requests'), ''),
      new ApiError(422, body('validation_failed', 'No'), ''),
      new ApiError(401, body('unauthorized', 'No'), ''),
      new ApiError(404, body('not_found', 'Expense not found'), ''),
      new Error('Calendar access was not granted.'),
    ].map((error) => describeError(error).cause);

    expect(causes).toEqual(['offline', 'timeout', 'server', 'rate', 'input', 'auth', 'refused', 'other']);
  });
});

describe('errorLine', () => {
  it('says what failed, then what to do', () => {
    expect(errorLine(new NetworkError('offline'), 'Couldn’t log water')).toBe(
      'Couldn’t log water. Check your connection, then try again.',
    );
    expect(
      errorLine(
        new ApiError(400, body('bad_request', 'Cannot log a habit for a future date'), ''),
        'Couldn’t log that habit',
      ),
    ).toBe('Couldn’t log that habit. Cannot log a habit for a future date');
    expect(errorLine('weird', 'Couldn’t log water')).toBe('Couldn’t log water. Try again.');
  });

  it('passes on why a sign-in was refused', () => {
    expect(
      errorLine(
        new ApiError(401, body('unauthorized', 'Incorrect email or password'), ''),
        'Couldn’t sign in',
      ),
    ).toBe('Couldn’t sign in. Incorrect email or password');
  });

  it('without knowing what failed, leads with the cause', () => {
    expect(errorLine(new NetworkError('offline'))).toBe(
      'You’re offline. Check your connection, then try again.',
    );
  });
});
