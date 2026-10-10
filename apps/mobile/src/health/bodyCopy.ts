import type { BodyMetrics } from '@synitheia/shared';
import type { BodyField } from './bodyForm.js';

/**
 * The Body screen's words about where its numbers come from.
 *
 * Kept as functions because every one of them used to be wrong somewhere. The screen
 * said "From Health Connect" over values the user had typed, and that Health Connect "has
 * not shared" a sex and date of birth it has no way to hold. The server does not record
 * which measurement came from where, so these say what is true in every case rather than
 * guess at a source.
 */

const FIELD_LABEL: Record<BodyField, string> = {
  height: 'height',
  weight: 'weight',
  sex: 'sex',
  birthDate: 'date of birth',
};

const SEX_LABEL: Record<NonNullable<BodyMetrics['biologicalSex']>, string> = {
  female: 'Female',
  male: 'Male',
  other: 'Other',
};

/** "height", "height and weight", "height, weight and sex". */
function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Why there is nothing to compute yet, and what to do about it. */
export function missingSentence(missing: readonly BodyField[]): string {
  const what = listOf(missing.map((field) => FIELD_LABEL[field]));
  return `Synítheia doesn’t have your ${what} yet. Add ${missing.length > 1 ? 'them' : 'it'} below.`;
}

/**
 * Which of the details the health store can supply, and what that does to typed ones.
 *
 * The second half matters to anyone about to edit: a sync sets every body value the store
 * returns, so a correction to a value the store also holds lasts until the next sync.
 * Saying so here is better than an edit that quietly undoes itself.
 */
export function bodyProvenance(sourceName: string, storeHoldsIdentity: boolean): string {
  if (storeHoldsIdentity) {
    return `These come from ${sourceName} when it has them, and its values replace what you enter here each time it syncs.`;
  }
  return `Height and weight come from ${sourceName} when it has them, and its values replace what you enter here each time it syncs. Sex and date of birth are only ever what you enter.`;
}

// A date of birth is a calendar label, not an instant. Anchoring it at UTC midnight and
// formatting it in UTC is what keeps a phone west of Greenwich from showing the day before.
const BIRTH_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/** The stored details, ready to show. Only what is stored: the rest has its own form. */
export function bodyRows(stored: BodyMetrics): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];

  if (stored.heightCm !== null) rows.push({ label: 'Height', value: `${stored.heightCm} cm` });
  if (stored.weightKg !== null) rows.push({ label: 'Weight', value: `${stored.weightKg} kg` });
  if (stored.biologicalSex !== null) {
    rows.push({ label: 'Sex', value: SEX_LABEL[stored.biologicalSex] });
  }
  if (stored.birthDate !== null) {
    rows.push({
      label: 'Date of birth',
      value: BIRTH_DATE.format(new Date(`${stored.birthDate}T00:00:00Z`)),
    });
  }

  return rows;
}
