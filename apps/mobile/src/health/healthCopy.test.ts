import { describe, expect, it } from 'vitest';
import { nothingAllowedAlert } from './healthCopy.js';

describe('nothingAllowedAlert', () => {
  it('states what happened without blaming anyone for it', () => {
    // Nothing allowed has causes the app cannot tell apart — including the user tapping
    // the sheet's own "privacy policy" link, which closes the sheet. None of them is a
    // failure, and none is Health Connect withholding something.
    const { title, message } = nothingAllowedAlert('Health Connect');

    expect(`${title} ${message}`).not.toMatch(/didn.t give|denied|refused|failed|could not/i);
    expect(message).toContain('Nothing was allowed');
  });

  it('says how to go on, and where to change it later', () => {
    const { message } = nothingAllowedAlert('Health Connect');

    expect(message).toContain('Turn this on again');
    expect(message).toContain('Health Connect app');
  });
});
