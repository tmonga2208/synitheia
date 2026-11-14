import { describe, expect, it } from 'vitest';
import { sheetBottomPadding } from './sheetPadding.js';

describe('sheetBottomPadding', () => {
  it('adds the inset to the padding the sheet asks for', () => {
    expect(sheetBottomPadding({ paddingBottom: 24 }, 34)).toBe(58);
  });

  it('reads the most specific padding, as React Native does', () => {
    expect(sheetBottomPadding({ padding: 8, paddingVertical: 16, paddingBottom: 24 }, 0)).toBe(24);
    expect(sheetBottomPadding({ padding: 8, paddingVertical: 16 }, 0)).toBe(16);
    expect(sheetBottomPadding({ padding: 8 }, 0)).toBe(8);
  });

  it('is the inset alone for a sheet with no padding, or none it can add to', () => {
    expect(sheetBottomPadding(undefined, 34)).toBe(34);
    expect(sheetBottomPadding({}, 34)).toBe(34);
    expect(sheetBottomPadding({ paddingBottom: '5%' }, 34)).toBe(34);
  });

  it('keeps a sheet with no home indicator on its own padding', () => {
    expect(sheetBottomPadding({ paddingBottom: 24 }, 0)).toBe(24);
  });
});
