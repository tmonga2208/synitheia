import { describe, expect, it } from 'vitest';
import {
  inferenceTypeSchema,
  rankSuggestions,
  syncResultSchema,
  syncSuggestionSchema,
} from './inference.js';

describe('inference contract', () => {
  it('accepts low_activity as a suggestion type', () => {
    expect(inferenceTypeSchema.parse('low_activity')).toBe('low_activity');
  });

  it('parses a sync suggestion', () => {
    const parsed = syncSuggestionSchema.parse({
      id: '6a7025c8d36b5e0013390202',
      type: 'possible_habit_completion',
      title: 'Mark Morning run done?',
      actionable: true,
    });
    expect(parsed.actionable).toBe(true);
  });

  it('defaults suggestions to [] so an older API response still parses', () => {
    const parsed = syncResultSchema.parse({ days: 7, stepsApplied: 0 });
    expect(parsed.suggestions).toEqual([]);
  });
});

describe('rankSuggestions', () => {
  const s = (id: string, kind: string, confidence: number) => ({
    id,
    confidence,
    proposed: { kind },
  });

  it('puts actionable suggestions ahead of observations, whatever their confidence', () => {
    const ranked = rankSuggestions([
      s('obs-high', 'observation', 0.9),
      s('habit-low', 'habit', 0.65),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['habit-low', 'obs-high']);
  });

  it('orders by confidence within each group', () => {
    const ranked = rankSuggestions([
      s('obs-a', 'observation', 0.6),
      s('food', 'food', 0.62),
      s('obs-b', 'observation', 0.8),
      s('habit', 'habit', 0.8),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['habit', 'food', 'obs-b', 'obs-a']);
  });

  it('does not mutate its input', () => {
    const input = [s('a', 'observation', 0.6), s('b', 'habit', 0.7)];
    rankSuggestions(input);
    expect(input.map((r) => r.id)).toEqual(['a', 'b']);
  });
});
