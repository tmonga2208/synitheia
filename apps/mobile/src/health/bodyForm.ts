import {
  ageOn,
  asLocalDate,
  isLocalDate,
  type BodyMetrics,
  type LocalDate,
} from '@synitheia/shared';

/**
 * What the user types on the Body screen, turned into a request — or a sentence saying
 * what is wrong with it. Two jobs share it: adding the measurements the health store did
 * not supply, and correcting the ones already stored.
 *
 * Kept out of the screen so it can be tested. The bounds mirror `bodyMetricsSchema`: the
 * server would refuse the same values, but only with a generic failure, and a form that
 * says "between 50 and 280" is the difference between a typo and a dead end.
 */

export type BodyField = 'height' | 'weight' | 'sex' | 'birthDate';

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

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/** People in much of the world type "70,5". */
function parseNumber(raw: string): number | null {
  const value = Number(raw.trim().replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function parseBirthDate(typed: string, today: string): Parsed<LocalDate> {
  if (!isLocalDate(typed)) {
    return {
      ok: false,
      message: 'Enter your date of birth as YYYY-MM-DD, for example 1994-03-07.',
    };
  }
  if (typed > today) {
    return { ok: false, message: 'A date of birth cannot be in the future.' };
  }
  if (ageOn(typed, asLocalDate(today)) > 120) {
    return { ok: false, message: 'Check the year in your date of birth.' };
  }
  return { ok: true, value: typed };
}

function parseHeight(raw: string): Parsed<number> {
  const typed = parseNumber(raw);
  const cm = typed === null ? null : Math.round(typed);
  if (cm === null || cm < 50 || cm > 280) {
    return { ok: false, message: 'Enter your height in centimetres, between 50 and 280.' };
  }
  return { ok: true, value: cm };
}

function parseWeight(raw: string): Parsed<number> {
  const typed = parseNumber(raw);
  const kg = typed === null ? null : Math.round(typed * 10) / 10;
  if (kg === null || kg < 20 || kg > 500) {
    return { ok: false, message: 'Enter your weight in kilograms, between 20 and 500.' };
  }
  return { ok: true, value: kg };
}

/** What is stored, as the user would type it: where a correction starts from. */
export function formValuesFrom(stored: BodyMetrics): BodyFormValues {
  return {
    heightCm: stored.heightCm === null ? '' : String(stored.heightCm),
    weightKg: stored.weightKg === null ? '' : String(stored.weightKg),
    sex: stored.biologicalSex,
    birthDate: stored.birthDate ?? '',
  };
}

/** The measurements the app already holds — the ones there is something to correct. */
export function storedFields(stored: BodyMetrics): BodyField[] {
  const fields: BodyField[] = [];
  if (stored.heightCm !== null) fields.push('height');
  if (stored.weightKg !== null) fields.push('weight');
  if (stored.biologicalSex !== null) fields.push('sex');
  if (stored.birthDate !== null) fields.push('birthDate');
  return fields;
}

/**
 * Adding what is missing.
 *
 * Only fields in `missing` are ever sent. The form shows nothing else, and a value the
 * health store did report must not be overwritten by something left in component state.
 *
 * A partial answer is fine: sex now, date of birth later.
 */
export function bodyPatch(
  missing: readonly BodyField[],
  values: BodyFormValues,
  today: string,
): BodyPatchResult {
  const patch: Partial<BodyMetrics> = {};

  if (missing.includes('sex') && values.sex) patch.biologicalSex = values.sex;

  const typedDate = values.birthDate.trim();
  if (missing.includes('birthDate') && typedDate !== '') {
    const parsed = parseBirthDate(typedDate, today);
    if (!parsed.ok) return parsed;
    patch.birthDate = parsed.value;
  }

  if (missing.includes('height') && values.heightCm.trim() !== '') {
    const parsed = parseHeight(values.heightCm);
    if (!parsed.ok) return parsed;
    patch.heightCm = parsed.value;
  }

  if (missing.includes('weight') && values.weightKg.trim() !== '') {
    const parsed = parseWeight(values.weightKg);
    if (!parsed.ok) return parsed;
    patch.weightKg = parsed.value;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, message: 'Fill in at least one of these to save.' };
  }

  return { ok: true, patch };
}

/**
 * Correcting what is already stored.
 *
 * Without this, a value typed once was permanent. On Android that is not a corner case:
 * Health Connect has nowhere to keep sex or date of birth, so nothing would ever arrive
 * to overwrite a slip — and those two feed the resting-energy figure behind a calorie
 * target the user acts on.
 *
 * `stored` is what the form was opened with, and only a field whose text differs from
 * that is sent. Comparing text, not numbers, is deliberate: a field the user never
 * touched cannot turn into a write just because of how it was rounded.
 *
 * A field left empty is removed. It is the user's own entry; they may take it back.
 * Fields that are not stored yet are ignored here — adding them is `bodyPatch`.
 */
export function bodyEdit(
  stored: BodyMetrics,
  values: BodyFormValues,
  today: string,
): BodyPatchResult {
  const before = formValuesFrom(stored);
  const patch: Partial<BodyMetrics> = {};

  if (stored.biologicalSex !== null && values.sex && values.sex !== stored.biologicalSex) {
    patch.biologicalSex = values.sex;
  }

  const typedDate = values.birthDate.trim();
  if (stored.birthDate !== null && typedDate !== before.birthDate) {
    if (typedDate === '') {
      patch.birthDate = null;
    } else {
      const parsed = parseBirthDate(typedDate, today);
      if (!parsed.ok) return parsed;
      patch.birthDate = parsed.value;
    }
  }

  const typedHeight = values.heightCm.trim();
  if (stored.heightCm !== null && typedHeight !== before.heightCm) {
    if (typedHeight === '') {
      patch.heightCm = null;
    } else {
      const parsed = parseHeight(typedHeight);
      if (!parsed.ok) return parsed;
      patch.heightCm = parsed.value;
    }
  }

  const typedWeight = values.weightKg.trim();
  if (stored.weightKg !== null && typedWeight !== before.weightKg) {
    if (typedWeight === '') {
      patch.weightKg = null;
    } else {
      const parsed = parseWeight(typedWeight);
      if (!parsed.ok) return parsed;
      patch.weightKg = parsed.value;
    }
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, message: 'Nothing has changed.' };
  }

  return { ok: true, patch };
}
