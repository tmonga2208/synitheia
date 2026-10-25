import * as Crypto from 'expo-crypto';

/**
 * An id for something made on this phone, in the server's own format (a MongoDB ObjectId):
 * four bytes of time, then eight random ones.
 *
 * Made offline, a habit or an expense needs its final id at once, so it can be ticked or
 * edited before it reaches the server; the server keeps the id it is given
 * (apps/api/src/core/clientId.ts). Eight random bytes per second make a clash with any
 * other id vanishingly unlikely, and the server refuses one rather than overwrite.
 */
export function newObjectId(now: Date = new Date()): string {
  const seconds = Math.floor(now.getTime() / 1000).toString(16).padStart(8, '0');
  const random = Array.from(Crypto.getRandomBytes(8), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return seconds + random;
}

/** A key that marks one change, so the server can tell a resend from a new one. */
export function newKey(): string {
  return Crypto.randomUUID();
}
