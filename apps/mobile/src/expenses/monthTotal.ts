/** GET /expenses/totals: net of what friends have paid back, so what the month cost you. */
export interface WireExpenseTotals {
  totalMinor: number;
  count: number;
  byCategory: Record<string, number>;
  largestMinor: number | null;
  owedMinor: number;
  /** Net per local date, for the days that had spending. */
  byDay: Record<string, number>;
  /** The biggest payees by net, at most six. */
  topPayees: { name: string; totalMinor: number; count: number; categoryName: string }[];
}
