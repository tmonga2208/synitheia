import { ageOn, asLocalDate, isLocalDate, type BodyMetrics } from '@synitheia/shared';

/**
 * What the user types on the Body screen for the measurements their health store did not
 * supply, turned into a request — or a sentence saying what is wrong with it.
 *
 * Kept out of the screen so it can be tested. The bounds mirror `bodyMetricsSchema`: the
 * server would refuse the same values, but only with a generic failure, and a form that
 * says "between 50 and 280" is the difference between a typo and a dead end.
 */

export type MissingBodyField = 'height' | 'weight' | 'sex' | 'birthDate';

export interface BodyFormValues {
  heightCm: string;
  weightKg: string;
  sex: NonNullable<BodyMetrics['biologicalSex']> | null;
  /** As typed: `YYYY-MM-DD`. */
  birthDate: string;
}

export type BodyPatchResult =
  | { ok: true; patch: Partial<BodyMetrics> }
  | { ok: false; message: string };

/** People in much of the world type "70,5". */
function parseNumber(raw: string): number | null {
  const value = Number(raw.trim().replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/**
 * Only fields in `missing` are ever sent. The form shows nothing else, and a value the
 * health store did report must not be overwritten by something left in component state.
 *
 * A partial answer is fine: sex now, date of birth later.
 */
export function bodyPatch(
  missing: readonly MissingBodyField[],
  values: BodyFormValues,
  today: string,
): BodyPatchResult {
  const patch: Partial<BodyMetrics> = {};

  if (missing.includes('sex') && values.sex) patch.biologicalSex = values.sex;

  const typedDate = values.birthDate.trim();
  if (missing.includes('birthDate') && typedDate !== '') {
    if (!isLocalDate(typedDate)) {
      return {
        ok: false,
        message: 'Enter your date of birth as YYYY-MM-DD, for example 1994-03-07.',
      };
    }
    if (typedDate > today) {
      return { ok: false, message: 'A date of birth cannot be in the future.' };
    }
    if (ageOn(typedDate, asLocalDate(today)) > 120) {
      return { ok: false, message: 'Check the year in your date of birth.' };
    }
    patch.birthDate = typedDate;
  }

  if (missing.includes('height') && values.heightCm.trim() !== '') {
    const typed = parseNumber(values.heightCm);
    const cm = typed === null ? null : Math.round(typed);
    if (cm === null || cm < 50 || cm > 280) {
      return { ok: false, message: 'Enter your height in centimetres, between 50 and 280.' };
    }
    patch.heightCm = cm;
  }

  if (missing.includes('weight') && values.weightKg.trim() !== '') {
    const typed = parseNumber(values.weightKg);
    const kg = typed === null ? null : Math.round(typed * 10) / 10;
    if (kg === null || kg < 20 || kg > 500) {
      return { ok: false, message: 'Enter your weight in kilograms, between 20 and 500.' };
    }
    patch.weightKg = kg;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, message: 'Fill in at least one of these to save.' };
  }

  return { ok: true, patch };
}
