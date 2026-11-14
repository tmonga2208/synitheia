import { describe, expect, it } from 'vitest';
import { amountLocked, changesFrom, formFor, type EditableExpense } from './expenseEdit.js';

const coffee: EditableExpense = {
  amountMinor: 31_200,
  currency: 'INR',
  categoryId: 'food',
  merchant: 'Third Wave Coffee',
  note: null,
  paidBy: null,
  participants: [],
};

describe('formFor', () => {
  it('opens on the expense as it is, amount written the way the app writes money', () => {
    expect(formFor(coffee)).toEqual({
      amount: '312',
      categoryId: 'food',
      merchant: 'Third Wave Coffee',
      note: '',
    });
    expect(formFor({ ...coffee, amountMinor: 103_750 }).amount).toBe('1,037.50');
  });
});

describe('changesFrom', () => {
  it('sends nothing when nothing changed', () => {
    expect(changesFrom(coffee, formFor(coffee))).toEqual({ ok: true, changes: {} });
  });

  it('sends only what changed', () => {
    const form = { ...formFor(coffee), amount: '350', categoryId: 'shopping' };
    expect(changesFrom(coffee, form)).toEqual({
      ok: true,
      changes: { amountMinor: 35_000, categoryId: 'shopping' },
    });
  });

  it('reads an amount typed with grouping commas', () => {
    const form = { ...formFor(coffee), amount: '1,250' };
    expect(changesFrom(coffee, form)).toEqual({ ok: true, changes: { amountMinor: 125_000 } });
  });

  it('clears the payee or note when it is emptied, and trims what is typed', () => {
    const form = { ...formFor(coffee), merchant: '   ', note: '  with Ana ' };
    expect(changesFrom(coffee, form)).toEqual({
      ok: true,
      changes: { merchant: null, note: 'with Ana' },
    });
  });

  it('refuses an amount that is not one, or is not above zero', () => {
    expect(changesFrom(coffee, { ...formFor(coffee), amount: 'abc' })).toEqual({
      ok: false,
      error: 'That does not look like an amount',
    });
    expect(changesFrom(coffee, { ...formFor(coffee), amount: '0' })).toEqual({
      ok: false,
      error: 'Enter more than zero',
    });
  });

  it('never sends the amount of a split expense', () => {
    const split: EditableExpense = {
      ...coffee,
      participants: [{ name: 'Ana', contactId: null, shareMinor: 15_600, settledAt: null }],
    };
    const form = { ...formFor(split), amount: '999', note: 'split' };
    expect(changesFrom(split, form)).toEqual({ ok: true, changes: { note: 'split' } });
  });
});

describe('amountLocked', () => {
  it('locks the amount when people owe you a share of it, or someone else paid', () => {
    expect(amountLocked(coffee)).toBe(false);
    expect(
      amountLocked({
        ...coffee,
        participants: [{ name: 'Ana', contactId: null, shareMinor: 1, settledAt: null }],
      }),
    ).toBe(true);
    expect(amountLocked({ ...coffee, paidBy: { name: 'Ana', contactId: null } })).toBe(true);
  });
});
