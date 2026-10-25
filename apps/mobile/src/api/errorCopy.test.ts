import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'afterFirstUnlockThisDeviceOnly',
}));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

const { ApiError, NetworkError } = await import('./client.js');
const { describeError } = await import('./errorCopy.js');

const body = (code: string, message: string) => ({ error: { code, message, requestId: 'r' } });

describe('describeError', () => {
  it('says when the phone is offline, and what to do', () => {
    expect(describeError(new NetworkError('offline'))).toEqual({
      title: 'You’re offline',
      message: 'Check your connection, then try again.',
    });
  });

  it('says when the server did not answer in time', () => {
    expect(describeError(new NetworkError('timeout'))).toEqual({
      title: 'No answer from Synítheia',
      message: 'The connection is slow or down. Try again in a moment.',
    });
  });

  it('owns a server failure, and says the data is safe', () => {
    expect(describeError(new ApiError(502, null, 'Request failed with 502'))).toEqual({
      title: 'Synítheia isn’t answering',
      message: 'Our server is having trouble. Your data is safe; try again in a minute.',
    });
  });

  it('asks for a pause after too many tries', () => {
    expect(describeError(new ApiError(429, body('rate_limited', 'Too many requests'), ''))).toEqual({
      title: 'Slow down a little',
      message: 'Too many tries in a row. Wait a minute, then try again.',
    });
  });

  it('passes on the server’s reason for refusing input, unless it is the generic one', () => {
    expect(
      describeError(new ApiError(422, body('validation_failed', 'Request validation failed'), '')),
    ).toEqual({ title: 'That wasn’t accepted', message: 'Check what you entered and try again.' });

    expect(
      describeError(new ApiError(422, body('validation_failed', 'Amount must be positive'), '')),
    ).toEqual({ title: 'That wasn’t accepted', message: 'Amount must be positive' });
  });

  it('passes on what the server said for any other refusal', () => {
    expect(
      describeError(new ApiError(400, body('bad_request', 'Cannot log a habit for a future date'), '')),
    ).toEqual({ title: 'Couldn’t do that', message: 'Cannot log a habit for a future date' });
  });

  it('keeps a message the app wrote for the user', () => {
    expect(describeError(new Error('Calendar access was not granted.'))).toEqual({
      title: 'Couldn’t do that',
      message: 'Calendar access was not granted.',
    });
  });

  it('never shows a programming error’s text', () => {
    expect(describeError(new TypeError('undefined is not a function'), 'Could not save this.')).toEqual({
      title: 'Couldn’t do that',
      message: 'Could not save this.',
    });
    expect(describeError('boom')).toEqual({ title: 'Couldn’t do that', message: 'Try again.' });
  });
});
