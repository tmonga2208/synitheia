import { describe, expect, it } from 'vitest';
import {
  overallFoodConfidence,
  rescaleForPortion,
  type DraftFoodItem,
} from './nutrition.js';

const biryani: DraftFoodItem = {
  name: 'Chicken biryani',
  portionQty: 300,
  portionUnit: 'g',
  macros: { calories: 480, proteinG: 26, carbsG: 58, fatG: 16 },
  identifyConfidence: 0.92,
  portionConfidence: 0.55,
  reasoning: 'Rice with visible chicken pieces and fried onion, served on a full plate.',
};

describe('rescaleForPortion', () => {
  it('scales macros linearly when the user corrects the portion', () => {
    // The model guessed 300g; the user says it was really 450g.
    expect(rescaleForPortion(biryani, 450)).toEqual({
      calories: 720,
      proteinG: 39,
      carbsG: 87,
      fatG: 24,
    });
  });

  it('scales down', () => {
    expect(rescaleForPortion(biryani, 150)).toEqual({
      calories: 240,
      proteinG: 13,
      carbsG: 29,
      fatG: 8,
    });
  });

  it('is identity when the portion is unchanged', () => {
    expect(rescaleForPortion(biryani, 300)).toEqual(biryani.macros);
  });

  it('never divides by zero', () => {
    const broken = { ...biryani, portionQty: 0 };
    expect(rescaleForPortion(broken, 100)).toEqual({
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
    });
  });

  it('rounds grams to one decimal rather than emitting 25.999999999', () => {
    const item = {
      macros: { calories: 100, proteinG: 3.3, carbsG: 10, fatG: 1.1 },
      portionQty: 100,
    };
    const scaled = rescaleForPortion(item, 33);
    expect(scaled.proteinG).toBeCloseTo(1.1, 5);
    expect(Number.isInteger(scaled.calories)).toBe(true);
  });
});

describe('overallFoodConfidence', () => {
  /**
   * The whole point of splitting the two confidences. The model is 92% sure this is
   * biryani but only 55% sure of the portion — and portion is what drives the calorie
   * count. Reporting 92% would tell the user to trust a number that rests on a coin
   * flip.
   */
  it('reports the weaker of identification and portion', () => {
    expect(overallFoodConfidence(biryani)).toBe(0.55);
  });

  it('is not flattered by a confident identification', () => {
    const certainFoodWildPortion: DraftFoodItem = {
      ...biryani,
      identifyConfidence: 1,
      portionConfidence: 0.3,
    };
    expect(overallFoodConfidence(certainFoodWildPortion)).toBe(0.3);
  });

  it('is limited by a shaky identification too', () => {
    const unsureFoodExactPortion: DraftFoodItem = {
      ...biryani,
      identifyConfidence: 0.4,
      portionConfidence: 1,
    };
    expect(overallFoodConfidence(unsureFoodExactPortion)).toBe(0.4);
  });
});
