import { describe, expect, it } from 'vitest';
import { updateTargetsSchema } from './user.js';

describe('updateTargetsSchema', () => {
  it('lets the tracked areas change after setup', () => {
    expect(updateTargetsSchema.parse({ trackedDomains: ['habits', 'water'] })).toEqual({
      trackedDomains: ['habits', 'water'],
    });
  });

  it('keeps at least one area tracked', () => {
    expect(updateTargetsSchema.safeParse({ trackedDomains: [] }).success).toBe(false);
  });

  it('refuses the same area twice and areas that do not exist', () => {
    expect(updateTargetsSchema.safeParse({ trackedDomains: ['water', 'water'] }).success).toBe(
      false,
    );
    expect(updateTargetsSchema.safeParse({ trackedDomains: ['sleep'] }).success).toBe(false);
  });
});
