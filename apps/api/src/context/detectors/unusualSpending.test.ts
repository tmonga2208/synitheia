import { describe, expect, it } from 'vitest';
import { detectUnusualSpending } from './unusualSpending.js';
import { baseCtx, fakeEvent, istAt } from './testing.js';

/** Sundays before TEST_DAY (2026-07-12). */
const SUNDAYS = ['2026-07-05', '2026-06-28', '2026-06-21', '2026-06-14'];

const spend = (amountMinor: number, day?: string, currency = 'INR') =>
  fakeEvent({
    type: 'expense.created',
    at: istAt('14:00', day),
    metadata: { amountMinor, currency, categoryName: 'Food' },
  });

describe('unusual spending', () => {
  it('fires when today is well above the same-weekday average', () => {
    const ctx = baseCtx({
      events: [spend(90_000)],
      history: SUNDAYS.slice(0, 3).map((d) => spend(40_000, d)),
    });

    const [d] = detectUnusualSpending(ctx);

    expect(d).toBeDefined();
    expect(d!.type).toBe('unusual_spending');
    expect(d!.proposed).toEqual({ kind: 'observation' });
    expect(d!.title).toBe("You've spent more than usual for a Sunday");
    // Formatted in code, in the user's currency — never a bare minor-unit number.
    expect(d!.description).toContain('₹900');
    expect(d!.description).toContain('₹400');
    expect(d!.evidence.some((e) => e.label.includes('3 Sundays'))).toBe(true);
  });

  it('needs three prior same-weekdays before it says anything', () => {
    const ctx = baseCtx({
      events: [spend(90_000)],
      history: SUNDAYS.slice(0, 2).map((d) => spend(40_000, d)),
    });
    expect(detectUnusualSpending(ctx)).toEqual([]);
  });

  it('ignores other weekdays in the baseline', () => {
    const ctx = baseCtx({
      events: [spend(90_000)],
      // Three Saturdays, not Sundays.
      history: ['2026-07-11', '2026-07-04', '2026-06-27'].map((d) => spend(40_000, d)),
    });
    expect(detectUnusualSpending(ctx)).toEqual([]);
  });

  it('does not fire just under 1.5×', () => {
    const ctx = baseCtx({
      events: [spend(59_900)],
      history: SUNDAYS.slice(0, 3).map((d) => spend(40_000, d)),
    });
    expect(detectUnusualSpending(ctx)).toEqual([]);
  });

  it('does not fire on ratio alone when the excess is small', () => {
    // 2× the average, but only ₹40 over it.
    const ctx = baseCtx({
      events: [spend(8_000)],
      history: SUNDAYS.slice(0, 3).map((d) => spend(4_000, d)),
    });
    expect(detectUnusualSpending(ctx)).toEqual([]);
  });

  it('leaves foreign-currency expenses out of both sides', () => {
    const ctx = baseCtx({
      // ₹300 at home plus a large USD charge: only the INR counts toward today.
      events: [spend(30_000), spend(500_000, undefined, 'USD')],
      history: SUNDAYS.slice(0, 3).map((d) => spend(40_000, d)),
    });
    expect(detectUnusualSpending(ctx)).toEqual([]);
  });

  it('sums several expenses on one day into one sample', () => {
    const ctx = baseCtx({
      events: [spend(50_000), spend(40_000)],
      history: SUNDAYS.slice(0, 3).flatMap((d) => [spend(20_000, d), spend(20_000, d)]),
    });
    expect(detectUnusualSpending(ctx)).toHaveLength(1);
  });

  it('is silent without a home currency', () => {
    const ctx = baseCtx({
      currency: null,
      events: [spend(90_000)],
      history: SUNDAYS.slice(0, 3).map((d) => spend(40_000, d)),
    });
    expect(detectUnusualSpending(ctx)).toEqual([]);
  });

  it('is more confident at 2× and with more samples, and never certain', () => {
    const base = detectUnusualSpending(
      baseCtx({
        events: [spend(65_000)],
        history: SUNDAYS.slice(0, 3).map((d) => spend(40_000, d)),
      }),
    )[0]!;
    const strong = detectUnusualSpending(
      baseCtx({
        events: [spend(90_000)],
        history: [...SUNDAYS, '2026-06-07', '2026-05-31'].map((d) => spend(40_000, d)),
      }),
    )[0]!;

    expect(base.confidence).toBeCloseTo(0.6);
    expect(strong.confidence).toBeCloseTo(0.8);
    expect(strong.confidence).toBeLessThan(1);
  });
});
