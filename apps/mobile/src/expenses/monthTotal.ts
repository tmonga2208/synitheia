import { asMinor, formatMoney } from '@synitheia/shared';

/** GET /expenses/totals: net of what friends have paid back, so what the month cost you. */
export interface WireExpenseTotals {
  totalMinor: number;
  count: number;
  byCategory: Record<string, number>;
  largestMinor: number | null;
  owedMinor: number;
}

/** "₹4,820.50 spent", or null while loading and for an empty month the screen already explains. */
export function monthSpentLine(
  totals: Pick<WireExpenseTotals, 'totalMinor' | 'count'> | undefined,
  currency: string,
): string | null {
  if (!totals || totals.count === 0) return null;
  return `${formatMoney(asMinor(totals.totalMinor), currency)} spent`;
}
