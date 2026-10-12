import { describe, expect, it } from 'vitest';
import { sharedArrivalCopy } from './sharedCopy.js';

describe('sharedArrivalCopy', () => {
  it('offers to read a shared screenshot, and says where it goes if you do', () => {
    const copy = sharedArrivalCopy({
      kind: 'image',
      uri: 'file:///x.png',
      mimeType: 'image/png',
      name: 'shared.png',
    });

    expect(copy.title).toBe('A screenshot arrived');
    expect(copy.action).toBe('Read it');
    expect(copy.dismiss).toBe('Not now');
    expect(copy.preview).toBeNull();
    // Sharing it into the app is not the same as agreeing to have it uploaded and read by a
    // model. The card has to say what the button does before it is pressed.
    expect(copy.body).toContain('sent to the server');
    expect(copy.body).toContain('AI model');
    expect(copy.body).toContain('Nothing is saved until you confirm');
  });

  it('shows a shared message back, so the right one is being read', () => {
    const copy = sharedArrivalCopy({ kind: 'text', text: 'Paid Rs 320.00 to Green Bowl Cafe' });

    expect(copy.title).toBe('A message arrived');
    expect(copy.preview).toBe('Paid Rs 320.00 to Green Bowl Cafe');
    expect(copy.action).toBe('Read it');
    expect(copy.body).toContain('AI model');
  });

  it('shortens a long message and puts it on one line', () => {
    const copy = sharedArrivalCopy({ kind: 'text', text: `line one\n\nline two ${'x'.repeat(400)}` });

    expect(copy.preview).not.toContain('\n');
    expect(copy.preview!.startsWith('line one line two')).toBe(true);
    expect(copy.preview!.length).toBeLessThanOrEqual(161);
    expect(copy.preview!.endsWith('…')).toBe(true);
  });

  it('explains an item that could not be opened, and offers nothing to read', () => {
    const copy = sharedArrivalCopy({ kind: 'unreadable' });

    expect(copy.title).toBe('That could not be opened');
    expect(copy.action).toBeNull();
    expect(copy.dismiss).toBe('OK');
    expect(copy.body).toContain('Scan a screenshot');
  });
});
