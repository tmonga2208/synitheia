import { describe, expect, it } from 'vitest';
import { asLocalDate, type BodyMetrics } from '@synitheia/shared';
import { bodyProvenance, bodyRows, missingSentence } from './bodyCopy.js';

describe('missingSentence', () => {
  it('says what Synítheia lacks, without saying whose fault that is', () => {
    // "Health Connect has not shared your sex" would be false: it has nowhere to keep it.
    const sentence = missingSentence(['sex', 'birthDate']);

    expect(sentence).toBe(
      'Synítheia doesn’t have your sex and date of birth yet. Add them below.',
    );
  });

  it('reads naturally for one thing and for several', () => {
    expect(missingSentence(['height'])).toBe(
      'Synítheia doesn’t have your height yet. Add it below.',
    );
    expect(missingSentence(['height', 'weight', 'sex', 'birthDate'])).toBe(
      'Synítheia doesn’t have your height, weight, sex and date of birth yet. Add them below.',
    );
  });
});

describe('bodyProvenance', () => {
  it('on Android, says which values the health store can supply and which it never can', () => {
    const copy = bodyProvenance('Health Connect', false);

    expect(copy).toContain('Height and weight come from Health Connect when it has them');
    expect(copy).toContain('replace what you enter here');
    expect(copy).toContain('Sex and date of birth are only ever what you enter');
  });

  it('on iPhone, does not claim anything is hand-entered only', () => {
    const copy = bodyProvenance('Apple Health', true);

    expect(copy).toContain('come from Apple Health when it has them');
    expect(copy).toContain('replace what you enter here');
    expect(copy).not.toContain('only ever');
  });
});

describe('bodyRows', () => {
  const stored: BodyMetrics = {
    heightCm: 175,
    weightKg: 70.3,
    biologicalSex: 'male',
    birthDate: asLocalDate('1994-03-07'),
  };

  it('shows each stored value with its unit', () => {
    expect(bodyRows(stored)).toEqual([
      { label: 'Height', value: '175 cm' },
      { label: 'Weight', value: '70.3 kg' },
      { label: 'Sex', value: 'Male' },
      { label: 'Date of birth', value: 'March 7, 1994' },
    ]);
  });

  it('shows only what is stored', () => {
    expect(
      bodyRows({ heightCm: 175, weightKg: null, biologicalSex: null, birthDate: null }),
    ).toEqual([{ label: 'Height', value: '175 cm' }]);
  });

  it('keeps a birthday on its own calendar day, wherever the phone is', () => {
    // A date of birth is a calendar label, not an instant: New Year's Day must not
    // become New Year's Eve west of Greenwich.
    const [row] = bodyRows({ ...stored, heightCm: null, weightKg: null, biologicalSex: null, birthDate: asLocalDate('2000-01-01') });
    expect(row).toEqual({ label: 'Date of birth', value: 'January 1, 2000' });
  });
});
