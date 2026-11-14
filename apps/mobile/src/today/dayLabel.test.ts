import { describe, expect, it } from 'vitest';
import { splitDayLabel } from './dayLabel.js';

describe('splitDayLabel', () => {
  it('gives the weekday and the date as the two lines of a heading', () => {
    expect(splitDayLabel('Saturday, November 14')).toEqual(['Saturday', 'November 14']);
    expect(splitDayLabel('Wednesday, July 1')).toEqual(['Wednesday', 'July 1']);
  });

  it('keeps a label with no weekday whole, as the heading alone', () => {
    expect(splitDayLabel('November 14')).toEqual([undefined, 'November 14']);
  });
});
