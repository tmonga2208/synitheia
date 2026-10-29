import { describe, expect, it } from 'vitest';
import { changeLine, formatKg, paceLine, retargetLine } from './weightCopy.js';

describe('weight copy', () => {
  it('shows weight to one decimal', () => {
    expect(formatKg(72)).toBe('72.0 kg');
  });

  it('says which way the week went, or that there is no trend yet', () => {
    expect(changeLine(-0.6)).toBe('↓ 0.6 kg a week');
    expect(changeLine(0.3)).toBe('↑ 0.3 kg a week');
    expect(changeLine(null)).toBe('Weigh in again in a few days to see a trend');
  });

  it('names the goal when on track, and warns when losing too fast', () => {
    expect(paceLine('lose', 'on_track')).toBe('On track for losing weight');
    expect(paceLine('lose', 'fast')).toMatch(/Faster than a kilo a week/);
  });

  it('only mentions the target when it moved', () => {
    expect(retargetLine(2180, 2180)).toBeNull();
    expect(retargetLine(2180, 2159)).toBe(
      'Calorie target moved to 2,159 kcal (was 2,180) to match your new weight.',
    );
  });
});
