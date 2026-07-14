import { describe, expect, it } from 'vitest';
import { loadEnv, resetEnvCache } from '../../config/env.js';
import { resolveProvider } from '../client.js';
import { __toGeminiSchemaForTests } from './gemini.js';

const BASE = {
  MONGO_URI: 'mongodb://localhost:27017/test',
  JWT_SECRET: 'x'.repeat(40),
};

function env(extra: Record<string, string> = {}) {
  resetEnvCache();
  return loadEnv({ ...BASE, ...extra } as NodeJS.ProcessEnv);
}

describe('provider resolution', () => {
  it('is null when no key is configured — the feature is simply off', () => {
    expect(resolveProvider(env())).toBeNull();
  });

  it('picks whichever provider actually has a key', () => {
    expect(resolveProvider(env({ ANTHROPIC_API_KEY: 'sk-x' }))?.name).toBe('anthropic');
    expect(resolveProvider(env({ GEMINI_API_KEY: 'g-x' }))?.name).toBe('gemini');
  });

  it('honours an explicit AI_PROVIDER when both keys are present', () => {
    const both = { ANTHROPIC_API_KEY: 'sk-x', GEMINI_API_KEY: 'g-x' };
    expect(resolveProvider(env({ ...both, AI_PROVIDER: 'gemini' }))?.name).toBe('gemini');
    expect(resolveProvider(env({ ...both, AI_PROVIDER: 'anthropic' }))?.name).toBe(
      'anthropic',
    );
  });

  /**
   * A provider selected with no matching key would otherwise produce a feature that
   * silently does nothing — which reads to the user as a broken app, not a
   * misconfigured server. The process refuses to boot instead.
   */
  it('refuses to boot when AI_PROVIDER names a provider whose key is missing', () => {
    expect(() => env({ AI_PROVIDER: 'gemini' })).toThrow(/GEMINI_API_KEY/);
    expect(() => env({ AI_PROVIDER: 'anthropic' })).toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe('JSON Schema → Gemini schema', () => {
  /**
   * The one real dialect mismatch. We express an optional field as JSON Schema's
   * `type: ['string', 'null']`; Gemini wants a single type with `nullable: true` and
   * rejects the whole request otherwise — so getting this wrong 400s every call, not
   * just the ones with a null value.
   */
  it('converts a nullable union to nullable: true', () => {
    expect(__toGeminiSchemaForTests({ type: ['string', 'null'] })).toEqual({
      type: 'STRING',
      nullable: true,
    });
  });

  it('leaves a plain type non-nullable', () => {
    expect(__toGeminiSchemaForTests({ type: 'string' })).toEqual({ type: 'STRING' });
  });

  it('uppercases the type names Gemini expects', () => {
    expect(__toGeminiSchemaForTests({ type: 'number' }).type).toBe('NUMBER');
    expect(__toGeminiSchemaForTests({ type: 'integer' }).type).toBe('INTEGER');
    expect(__toGeminiSchemaForTests({ type: 'boolean' }).type).toBe('BOOLEAN');
    expect(__toGeminiSchemaForTests({ type: 'array' }).type).toBe('ARRAY');
    expect(__toGeminiSchemaForTests({ type: 'object' }).type).toBe('OBJECT');
  });

  it('carries enums, descriptions, and required through', () => {
    const out = __toGeminiSchemaForTests({
      type: 'object',
      description: 'a food',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        unit: { type: 'string', enum: ['g', 'ml'] },
      },
    });

    expect(out.description).toBe('a food');
    expect(out.required).toEqual(['name']);
    expect(out.properties?.unit?.enum).toEqual(['g', 'ml']);
  });

  it('recurses into arrays of objects — the shape every real call uses', () => {
    const out = __toGeminiSchemaForTests({
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              reasoning: { type: ['string', 'null'] },
            },
          },
        },
      },
    });

    const item = out.properties?.items?.items;
    expect(item?.type).toBe('OBJECT');
    expect(item?.properties?.name).toEqual({ type: 'STRING' });
    expect(item?.properties?.reasoning).toEqual({ type: 'STRING', nullable: true });
  });
});
