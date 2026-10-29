import { describe, expect, it } from 'vitest';
import { dayLine } from './dayLine.js';

const habit = (todayComplete: boolean) => ({ todayComplete }) as never;
const day = (
  habits: boolean[],
  spent: { totalMinor: number; count: number } = { totalMinor: 0, count: 0 },
  totalMl = 0,
) =>
  ({
    habits: habits.map(habit),
    expenses: { ...spent, budgetRemainingMinor: null },
    water: { totalMl, targetMl: 2500 },
  }) as never;

describe('dayLine', () => {
  it('says what the day holds, in facts', () => {
    expect(dayLine(day([true, true, false], { totalMinor: 60600, count: 3 }, 1250), 'INR')).toBe(
      '2 of 3 habits done · ₹606 spent · 1.25 L water',
    );
  });

  it('counts habits still to do, and says when they are all done', () => {
    expect(dayLine(day([false, false]), 'INR')).toBe('2 habits to do');
    expect(dayLine(day([false]), 'INR')).toBe('1 habit to do');
    expect(dayLine(day([true, true, true]), 'INR')).toBe('All 3 habits done');
    expect(dayLine(day([true]), 'INR')).toBe('Habit done');
  });

  it('leaves out what has nothing in it', () => {
    expect(dayLine(day([], { totalMinor: 35900, count: 1 }), 'INR')).toBe('₹359 spent');
  });

  it('says so plainly when nothing is logged', () => {
    expect(dayLine(day([]), 'INR')).toBe('Nothing logged yet today.');
  });
});
