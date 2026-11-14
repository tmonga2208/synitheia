import { describe, expect, it } from 'vitest';
import { suggestionCopy } from './suggestionCopy.js';

describe('suggestionCopy', () => {
  it('offers to add a meal or a payment it thinks it saw', () => {
    expect(suggestionCopy('food')).toEqual({
      tag: 'Suggestion',
      confirm: 'Add it',
      reject: 'No thanks',
    });
    expect(suggestionCopy('expense').confirm).toBe('Add it');
  });

  it('offers to mark a habit done', () => {
    expect(suggestionCopy('habit').confirm).toBe('Mark done');
    expect(suggestionCopy('habit').reject).toBe('No thanks');
  });

  it('asks nothing of something it only noticed: there is nothing to confirm', () => {
    expect(suggestionCopy('observation')).toEqual({
      tag: 'Noticed today',
      confirm: 'Got it',
      reject: 'Not helpful',
    });
  });
});
