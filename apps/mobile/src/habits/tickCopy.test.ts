import { describe, expect, it } from 'vitest';
import { tickMessage } from './tickCopy.js';

const reading = { name: 'Reading', measure: 'check' as const, targetCount: 1, unit: null };
const walk = { name: 'Walk', measure: 'steps' as const, targetCount: 8000, unit: null };

describe('tickMessage', () => {
  it('says a habit is done when the tap finishes it', () => {
    expect(tickMessage(reading, 1)).toBe('Reading done');
    expect(tickMessage(walk, 8000)).toBe('Walk done');
  });

  it('says how far a counted habit has got when it is not done yet', () => {
    expect(tickMessage(walk, 3500)).toBe('Walk: 3,500 / 8,000 steps');
  });
});
