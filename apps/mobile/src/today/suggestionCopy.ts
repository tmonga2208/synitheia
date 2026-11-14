import type { ProposedPayload } from '@synitheia/shared';

export interface SuggestionCopy {
  /** The small label over the card. */
  tag: string;
  confirm: string;
  reject: string;
}

/**
 * What a suggestion card calls itself and its two answers.
 *
 * Every card used to be tagged "detected" and answered with Confirm or Dismiss. That fits
 * a meal the app thinks it saw. It does not fit "You've spent more than usual for a
 * Saturday": there is nothing there to confirm, and Confirm left the user guessing what
 * they had just agreed to.
 *
 * Both answers are still sent for something only noticed. "Not helpful" is what tells a
 * rule it is wrong for this person.
 */
export function suggestionCopy(kind: ProposedPayload['kind']): SuggestionCopy {
  switch (kind) {
    case 'observation':
      return { tag: 'Noticed today', confirm: 'Got it', reject: 'Not helpful' };
    case 'habit':
      return { tag: 'Suggestion', confirm: 'Mark done', reject: 'No thanks' };
    case 'food':
    case 'expense':
      return { tag: 'Suggestion', confirm: 'Add it', reject: 'No thanks' };
  }
}
