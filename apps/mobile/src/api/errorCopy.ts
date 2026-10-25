import { ApiError, NetworkError } from './client.js';

/**
 * Whose problem it is. 'offline', 'timeout', 'server', 'rate' and 'auth' are about getting
 * an answer at all; 'input' and 'refused' are an answer, saying no; 'other' is anything else.
 */
export type ErrorCause =
  | 'offline'
  | 'timeout'
  | 'server'
  | 'rate'
  | 'auth'
  | 'input'
  | 'refused'
  | 'other';

export interface ErrorCopy {
  title: string;
  message: string;
  cause: ErrorCause;
}

/** What the API says when its schema rejects a body: true, and useless to a person. */
const GENERIC_VALIDATION = 'Request validation failed';

/**
 * Any failure, in words a person can act on: whose problem it is, and what to do next.
 *
 * Screens used to show "Something went wrong" over whatever text the failure carried, which
 * was often the platform's ("Network request failed") or a status code ("Request failed
 * with 502"). Being offline, the server being down, and a refused input now read differently,
 * because each needs a different next step.
 *
 * `fallback` is the message for a failure with nothing better to say.
 */
export function describeError(error: unknown, fallback = 'Try again.'): ErrorCopy {
  if (error instanceof NetworkError) {
    return error.reason === 'offline'
      ? {
          title: 'You’re offline',
          message: 'Check your connection, then try again.',
          cause: 'offline',
        }
      : {
          title: 'No answer from Synítheia',
          message: 'The connection is slow or down. Try again in a moment.',
          cause: 'timeout',
        };
  }

  if (error instanceof ApiError) {
    switch (error.kind) {
      case 'server':
        return {
          title: 'Synítheia isn’t answering',
          message: 'Our server is having trouble. Your data is safe; try again in a minute.',
          cause: 'server',
        };
      case 'rate':
        return {
          title: 'Slow down a little',
          message: 'Too many tries in a row. Wait a minute, then try again.',
          cause: 'rate',
        };
      case 'validation':
        return {
          title: 'That wasn’t accepted',
          message:
            error.message && error.message !== GENERIC_VALIDATION
              ? error.message
              : 'Check what you entered and try again.',
          cause: 'input',
        };
      case 'auth':
        // A wrong password answers 401 too, and its reason ("Incorrect email or password")
        // is exactly what that person needs to read.
        return {
          title: 'Not signed in',
          message: error.message || 'Sign in again to carry on.',
          cause: 'auth',
        };
      case 'app':
        return { title: 'Couldn’t do that', message: error.message || fallback, cause: 'refused' };
    }
  }

  // An Error the app threw on purpose carries words written for the user. A TypeError or
  // anything else is a fault in the app, and its text means nothing to them.
  if (error instanceof Error && error.constructor === Error && error.message) {
    return { title: 'Couldn’t do that', message: error.message, cause: 'other' };
  }

  return { title: 'Couldn’t do that', message: fallback, cause: 'other' };
}

/**
 * One sentence for a toast or an inline error: what failed, then what to do.
 *
 * `failed` names the action ("Couldn’t log water"). Without it, the cause leads.
 */
export function errorLine(error: unknown, failed?: string): string {
  const { title, message } = describeError(error);
  return `${failed ?? title}. ${message}`;
}
