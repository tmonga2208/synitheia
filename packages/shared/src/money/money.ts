/**
 * Money is always an integer count of minor units (paise, cents), never a float.
 *
 * `0.1 + 0.2 !== 0.3` in IEEE-754, and an expense tracker that silently loses a
 * paise per row is worse than useless. Every amount crossing the API, the DB, or
 * a sum is a `Minor`. Floats appear exactly once: when a human types "12.50".
 */
export type Minor = number & { readonly __brand: 'Minor' };

export interface CurrencyMeta {
  readonly code: string;
  readonly symbol: string;
  /** Digits after the decimal separator. JPY has 0; most currencies have 2. */
  readonly decimals: number;
  readonly locale: string;
}

export const CURRENCIES: Record<string, CurrencyMeta> = {
  INR: { code: 'INR', symbol: '₹', decimals: 2, locale: 'en-IN' },
  USD: { code: 'USD', symbol: '$', decimals: 2, locale: 'en-US' },
  EUR: { code: 'EUR', symbol: '€', decimals: 2, locale: 'de-DE' },
  GBP: { code: 'GBP', symbol: '£', decimals: 2, locale: 'en-GB' },
  JPY: { code: 'JPY', symbol: '¥', decimals: 0, locale: 'ja-JP' },
  AED: { code: 'AED', symbol: 'د.إ', decimals: 2, locale: 'ar-AE' },
  AUD: { code: 'AUD', symbol: 'A$', decimals: 2, locale: 'en-AU' },
  CAD: { code: 'CAD', symbol: 'C$', decimals: 2, locale: 'en-CA' },
  SGD: { code: 'SGD', symbol: 'S$', decimals: 2, locale: 'en-SG' },
};

export const DEFAULT_CURRENCY = 'INR';

export function currencyMeta(code: string): CurrencyMeta {
  const meta = CURRENCIES[code];
  if (!meta) throw new RangeError(`Unsupported currency: "${code}"`);
  return meta;
}

export function isSupportedCurrency(code: string): boolean {
  return code in CURRENCIES;
}

export function asMinor(value: number): Minor {
  if (!Number.isInteger(value)) {
    throw new RangeError(`Money must be an integer count of minor units, got ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Money amount is outside the safe integer range: ${value}`);
  }
  return value as Minor;
}

export const ZERO = 0 as Minor;

/**
 * Parse human input ("1,234.50", "₹250", "12") into minor units.
 * Returns null rather than throwing — this is called on every keystroke.
 */
export function parseMoneyInput(input: string, currency: string): Minor | null {
  const { decimals } = currencyMeta(currency);
  const cleaned = input.replace(/[^\d.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;

  const negative = cleaned.startsWith('-');
  const unsigned = negative ? cleaned.slice(1) : cleaned;

  const parts = unsigned.split('.');
  if (parts.length > 2) return null;

  const whole = parts[0] ?? '';
  const frac = parts[1] ?? '';
  if (whole === '' && frac === '') return null;
  if (frac.length > decimals) return null; // more precision than the currency has

  const scale = 10 ** decimals;
  const wholeMinor = (whole === '' ? 0 : Number(whole)) * scale;
  const fracMinor = frac === '' ? 0 : Number(frac.padEnd(decimals, '0'));
  if (!Number.isFinite(wholeMinor) || !Number.isFinite(fracMinor)) return null;

  const total = wholeMinor + fracMinor;
  if (!Number.isSafeInteger(total)) return null;
  return asMinor(negative ? -total : total);
}

/** Full display form: "₹1,234.50". */
/**
 * "₹606", "₹397.96": paise only when there are some. A column of "₹606.00, ₹359.00" is
 * noise for whole amounts, which most payments are; a part-rupee amount keeps both digits.
 */
export function formatMoney(amount: Minor, currency: string): string {
  const { code, decimals, locale } = currencyMeta(currency);
  const shown = amount % 10 ** decimals === 0 ? 0 : decimals;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: code,
    minimumFractionDigits: shown,
    maximumFractionDigits: shown,
  }).format(amount / 10 ** decimals);
}

/**
 * Compact display for dense UI — "₹1.2K", "₹4.8L" (Indian lakh/crore in en-IN).
 * Used in stat chips and chart labels where a full amount would wrap.
 */
export function formatMoneyCompact(amount: Minor, currency: string): string {
  const { code, decimals, locale } = currencyMeta(currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: code,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(amount / 10 ** decimals);
}

export function sumMoney(amounts: readonly Minor[]): Minor {
  return asMinor(amounts.reduce<number>((acc, n) => acc + n, 0));
}

/**
 * Percentage change from `previous` to `current`, as a rounded whole percent.
 *
 * Returns null when `previous` is zero: "spending rose from ₹0 to ₹500" has no
 * meaningful percentage, and an insight saying "up ∞%" or "up 100%" would both
 * be lies. Callers must handle null by phrasing it differently.
 */
export function percentChange(current: Minor, previous: Minor): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

/**
 * Split an amount between `ways` people without losing or inventing a single paise.
 *
 * ₹1,000 between 3 is 33,333.33 paise each — which does not exist. Rounding each share
 * independently gives 3 × 33,333 = 99,999, and one paise vanishes; rounding up gives
 * 100,002 and two paise appear from nowhere. Either way the shares no longer sum to the
 * bill, and a settle-up screen built on that will never quite balance.
 *
 * So: everyone gets the floor, and the remainder is handed out one unit at a time to the
 * earliest shares. The result always sums exactly to `total`, which is the only property
 * that actually matters.
 */
export function splitEvenly(total: Minor, ways: number): Minor[] {
  if (!Number.isInteger(ways) || ways < 1) {
    throw new RangeError(`Cannot split ${ways} ways`);
  }

  const base = Math.floor(total / ways);
  const remainder = total - base * ways;

  return Array.from({ length: ways }, (_, i) =>
    asMinor(base + (i < remainder ? 1 : 0)),
  );
}

/**
 * What an expense actually cost you: what you paid, minus what has been paid back.
 *
 * Never negative — if someone overpays you, that is a separate transaction, not a
 * negative lunch.
 */
export function netSpend(paid: Minor, settled: Minor): Minor {
  return asMinor(Math.max(0, paid - settled));
}
