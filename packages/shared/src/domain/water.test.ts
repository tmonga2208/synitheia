import { describe, expect, it } from 'vitest';
import { formatVolume } from './water.js';

/**
 * Water appeared as "1250", "2,500 ml" and "1.2 L" on different screens. One formatter
 * means the ring, the reminders and the insights all write the same amount the same way.
 */
describe('formatVolume', () => {
  it('writes amounts under a litre in millilitres', () => {
    expect(formatVolume(0)).toBe('0 ml');
    expect(formatVolume(750)).toBe('750 ml');
    expect(formatVolume(999)).toBe('999 ml');
  });

  it('writes a litre or more in litres, dropping trailing zeros', () => {
    expect(formatVolume(1000)).toBe('1 L');
    expect(formatVolume(1250)).toBe('1.25 L');
    expect(formatVolume(2500)).toBe('2.5 L');
  });

  it('keeps at most two decimals', () => {
    expect(formatVolume(1333)).toBe('1.33 L');
  });
});
