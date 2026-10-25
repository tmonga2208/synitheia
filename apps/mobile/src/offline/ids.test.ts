import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({
  getRandomBytes: (count: number) => webcrypto.getRandomValues(new Uint8Array(count)),
  randomUUID: () => webcrypto.randomUUID(),
}));

const { newKey, newObjectId } = await import('./ids.js');

describe('newObjectId', () => {
  it('is a 24-character lowercase hex id, like the server’s', () => {
    expect(newObjectId()).toMatch(/^[0-9a-f]{24}$/);
  });

  it('starts with the time, so ids made in order sort in order', () => {
    expect(newObjectId(new Date(Date.UTC(2026, 9, 26, 9, 0, 0)))).toMatch(/^6adf1690/);
  });

  it('is different every time', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newObjectId()));
    expect(ids.size).toBe(200);
  });
});

describe('newKey', () => {
  it('is long enough for the server and different every time', () => {
    const key = newKey();
    expect(key.length).toBeGreaterThanOrEqual(8);
    expect(key.length).toBeLessThanOrEqual(64);
    expect(newKey()).not.toBe(key);
  });
});
