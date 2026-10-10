import { describe, expect, it } from 'vitest';
import { bodyPatch, type BodyFormValues } from './bodyForm.js';

const TODAY = '2026-10-10';
const blank: BodyFormValues = { heightCm: '', weightKg: '', sex: null, birthDate: '' };

describe('bodyPatch', () => {
  it('sends sex and date of birth when those are what the health store lacks', () => {
    // The Android case: Health Connect has no record type for either.
    expect(
      bodyPatch(['sex', 'birthDate'], { ...blank, sex: 'female', birthDate: '1994-03-07' }, TODAY),
    ).toEqual({ ok: true, patch: { biologicalSex: 'female', birthDate: '1994-03-07' } });
  });

  it('accepts one field now and the other later', () => {
    expect(bodyPatch(['sex', 'birthDate'], { ...blank, sex: 'other' }, TODAY)).toEqual({
      ok: true,
      patch: { biologicalSex: 'other' },
    });
  });

  it('never sends a field the health store already supplied', () => {
    // The form only shows missing fields; a stray value for another must not overwrite
    // what Health reported.
    const result = bodyPatch(
      ['sex'],
      { heightCm: '180', weightKg: '80', sex: 'male', birthDate: '1990-01-01' },
      TODAY,
    );
    expect(result).toEqual({ ok: true, patch: { biologicalSex: 'male' } });
  });

  it('asks for something when nothing was entered', () => {
    const result = bodyPatch(['sex', 'birthDate'], blank, TODAY);
    expect(result.ok).toBe(false);
  });

  it('trims whitespace around a typed date', () => {
    expect(bodyPatch(['birthDate'], { ...blank, birthDate: ' 1994-03-07 ' }, TODAY)).toEqual({
      ok: true,
      patch: { birthDate: '1994-03-07' },
    });
  });

  it.each([
    ['07/03/1994', 'the wrong shape'],
    ['1994-3-7', 'unpadded'],
    ['1994-02-31', 'a day that does not exist'],
    ['2026-10-11', 'tomorrow'],
    ['1890-01-01', 'more than 120 years ago'],
    ['yesterday', 'not a date'],
  ])('rejects %s as a date of birth (%s)', (birthDate) => {
    const result = bodyPatch(['birthDate'], { ...blank, birthDate }, TODAY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.length).toBeGreaterThan(10);
  });

  it('accepts a birthday today and one exactly 120 years ago', () => {
    expect(bodyPatch(['birthDate'], { ...blank, birthDate: '2026-10-10' }, TODAY).ok).toBe(true);
    expect(bodyPatch(['birthDate'], { ...blank, birthDate: '1906-10-10' }, TODAY).ok).toBe(true);
  });

  it('rounds height to whole centimetres and weight to one decimal', () => {
    expect(
      bodyPatch(['height', 'weight'], { ...blank, heightCm: '175.6', weightKg: '70.26' }, TODAY),
    ).toEqual({ ok: true, patch: { heightCm: 176, weightKg: 70.3 } });
  });

  it('accepts a comma as the decimal separator', () => {
    expect(bodyPatch(['weight'], { ...blank, weightKg: '70,5' }, TODAY)).toEqual({
      ok: true,
      patch: { weightKg: 70.5 },
    });
  });

  it.each([
    ['height', { heightCm: '17' }],
    ['height', { heightCm: '1.75' }],
    ['height', { heightCm: '400' }],
    ['height', { heightCm: 'tall' }],
    ['weight', { weightKg: '3' }],
    ['weight', { weightKg: '900' }],
    ['weight', { weightKg: 'heavy' }],
  ] as const)('rejects an impossible %s (%j)', (field, values) => {
    // The server validates the same bounds and would refuse the request; saying so here
    // names the field instead of showing a generic failure.
    const result = bodyPatch([field], { ...blank, ...values }, TODAY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.toLowerCase()).toContain(field);
  });
});
