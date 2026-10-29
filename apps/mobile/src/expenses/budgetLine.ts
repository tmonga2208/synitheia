import { asMinor, formatMoneyCompact } from '@synitheia/shared';

export interface BudgetLine {
  text: string;
  over: boolean;
}

/**
 * The month's total against the user's monthly budget, as one short line.
 *
 * Null without a budget: a line about a budget nobody set would invent a goal.
 */
export function budgetLine(
  spentMinor: number,
  budgetMinor: number | null | undefined,
  currency: string,
): BudgetLine | null {
  if (budgetMinor == null || budgetMinor <= 0) return null;

  const budget = formatMoneyCompact(asMinor(budgetMinor), currency);
  const gap = Math.abs(budgetMinor - spentMinor);

  if (spentMinor > budgetMinor) {
    return {
      text: `${formatMoneyCompact(asMinor(gap), currency)} over your ${budget} budget`,
      over: true,
    };
  }
  return {
    text: `${formatMoneyCompact(asMinor(gap), currency)} left of your ${budget} budget`,
    over: false,
  };
}
