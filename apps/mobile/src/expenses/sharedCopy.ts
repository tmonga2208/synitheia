import type { SharedContent } from './sharedContent.js';

/**
 * The words on the card that says something was shared into the app.
 *
 * Kept as a function so it can be tested: the card is the only thing standing between "I
 * shared a screenshot to this app" and "that screenshot was uploaded and read by a model",
 * and it has to say so before the button is pressed, not after.
 */

export interface SharedArrivalCopy {
  title: string;
  /** A shared message, shown back so the user can see it is the right one. */
  preview: string | null;
  body: string;
  /** Null when there is nothing to read. */
  action: string | null;
  dismiss: string;
}

const PREVIEW_LENGTH = 160;

const WHAT_READING_DOES =
  'Reading it means it is sent to the server and read by an AI model, which turns it into a draft. Nothing is saved until you confirm the draft.';

function onOneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH)}…` : flat;
}

export function sharedArrivalCopy(shared: SharedContent): SharedArrivalCopy {
  switch (shared.kind) {
    case 'image':
      return {
        title: 'A screenshot arrived',
        preview: null,
        body: WHAT_READING_DOES,
        action: 'Read it',
        dismiss: 'Not now',
      };
    case 'text':
      return {
        title: 'A message arrived',
        preview: onOneLine(shared.text),
        body: WHAT_READING_DOES,
        action: 'Read it',
        dismiss: 'Not now',
      };
    case 'unreadable':
      return {
        title: 'That could not be opened',
        preview: null,
        body: 'It may be too large, or a kind of file this cannot read. Use “Scan a screenshot” below to pick it from your photos instead.',
        action: null,
        dismiss: 'OK',
      };
  }
}
