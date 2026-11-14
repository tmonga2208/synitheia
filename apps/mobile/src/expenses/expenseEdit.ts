import { parseMoneyInput, type Participant } from '@synitheia/shared';
import { moneyInputValue } from './moneyInput.js';

/** The parts of an expense the editor reads. */
export interface EditableExpense {
  amountMinor: number;
  currency: string;
  categoryId: string;
  merchant: string | null;
  note: string | null;
  paidBy: { name: string; contactId: string | null } | null;
  participants: readonly Participant[];
}

/** What the editor's fields hold: text as typed, and the chosen category. */
export interface ExpenseForm {
  amount: string;
  categoryId: string;
  merchant: string;
  note: string;
}

/** The body of the PATCH: only what changed. */
export interface ExpenseChanges {
  amountMinor?: number;
  categoryId?: string;
  merchant?: string | null;
  note?: string | null;
}

export type EditResult = { ok: true; changes: ExpenseChanges } | { ok: false; error: string };

/**
 * Whether the amount of a split expense stays as it was split.
 *
 * Split, the amount is one side of a sum: what you paid against what each person owes
 * you, or your share against the bill someone else paid. The server takes a new amount
 * without re-checking that sum, so a changed total could leave people owing more than the
 * bill. Until the split itself can be edited, its amount cannot be either.
 */
export function amountLocked(expense: Pick<EditableExpense, 'paidBy' | 'participants'>): boolean {
  return expense.paidBy != null || expense.participants.length > 0;
}

export function formFor(expense: EditableExpense): ExpenseForm {
  return {
    amount: moneyInputValue(expense.amountMinor, expense.currency),
    categoryId: expense.categoryId,
    merchant: expense.merchant ?? '',
    note: expense.note ?? '',
  };
}

/** A field left blank means "none", which the server stores as null, not "". */
function cleaned(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * What the form changes, or why it cannot be saved.
 *
 * Only what differs is sent. A save that changes the payee must not also rewrite the
 * amount, or the category, with whatever the screen last loaded.
 */
export function changesFrom(original: EditableExpense, form: ExpenseForm): EditResult {
  const changes: ExpenseChanges = {};

  if (!amountLocked(original)) {
    const minor = parseMoneyInput(form.amount, original.currency);
    if (minor === null) return { ok: false, error: 'That does not look like an amount' };
    if (minor <= 0) return { ok: false, error: 'Enter more than zero' };
    if (minor !== original.amountMinor) changes.amountMinor = minor;
  }

  if (form.categoryId !== original.categoryId) changes.categoryId = form.categoryId;

  const merchant = cleaned(form.merchant);
  if (merchant !== (original.merchant ?? null)) changes.merchant = merchant;

  const note = cleaned(form.note);
  if (note !== (original.note ?? null)) changes.note = note;

  return { ok: true, changes };
}
