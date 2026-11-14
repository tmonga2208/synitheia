import { currencyMeta } from '@synitheia/shared';

/**
 * A saved budget as the text its field opens with: "45,000", not "45000.00".
 *
 * Written the way formatMoney writes an amount, minus the symbol (the field shows that
 * beside it): grouped as the currency is read, with paise only when there are some.
 * `parseMoneyInput` ignores the grouping commas, so a budget saved without being touched
 * goes back as the amount it came from.
 */
export function budgetInputValue(minor: number | null, currency: string): string {
  if (minor == null) return '';

  const { decimals, locale } = currencyMeta(currency);
  const shown = minor % 10 ** decimals === 0 ? 0 : decimals;

  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: shown,
    maximumFractionDigits: shown,
  }).format(minor / 10 ** decimals);
}
