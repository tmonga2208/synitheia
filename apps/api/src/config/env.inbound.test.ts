import { describe, expect, it } from 'vitest';
import { loadEnv, resetEnvCache, isInboundConfigured } from './env.js';

const base = {
  MONGO_URI: 'mongodb://localhost:27017/test',
  JWT_SECRET: 'x'.repeat(48),
};

describe('inbound env', () => {
  it('is unconfigured without domain + secret', () => {
    resetEnvCache();
    const env = loadEnv({ ...base } as NodeJS.ProcessEnv);
    expect(isInboundConfigured(env)).toBe(false);
  });
  it('is configured with both', () => {
    resetEnvCache();
    const env = loadEnv({
      ...base,
      INBOUND_DOMAIN: 'in.example.app',
      INBOUND_WEBHOOK_SECRET: 's'.repeat(32),
    } as NodeJS.ProcessEnv);
    expect(isInboundConfigured(env)).toBe(true);
    expect(env.INBOUND_DOMAIN).toBe('in.example.app');
  });
});
