import { describe, expect, it } from 'vitest';
import { ingestionChannelSchema, ingestionStatusSchema } from './expense.js';

describe('ingestion enums', () => {
  it('accepts the email channel', () => {
    expect(ingestionChannelSchema.parse('email')).toBe('email');
  });
  it('accepts the needs_password status', () => {
    expect(ingestionStatusSchema.parse('needs_password')).toBe('needs_password');
  });
});
