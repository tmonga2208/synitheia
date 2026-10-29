import { describe, expect, it } from 'vitest';
import type { DataSourceItem } from '../api/types.js';
import { canForget, forgetConfirmation, forgottenNotice } from './forgetSource.js';

function source(overrides: Partial<DataSourceItem> = {}): DataSourceItem {
  return {
    source: 'calendar',
    title: 'Calendar',
    why: 'Meetings give your day structure.',
    platforms: 'iOS and Android',
    reliability: 'Reliable.',
    status: 'connected',
    lastSyncedAt: '2026-10-20T09:00:00.000Z',
    lastSyncError: null,
    eventCount: 12,
    aiAllowed: false,
    connectedAt: '2026-10-01T09:00:00.000Z',
    ...overrides,
  };
}

describe('canForget', () => {
  it('offers nothing for a source that never collected anything', () => {
    expect(canForget(source({ status: 'disabled', lastSyncedAt: null, eventCount: 0 }))).toBe(false);
  });

  it('still offers it once the source is off, which is when leftovers matter', () => {
    expect(canForget(source({ status: 'disabled', eventCount: 4 }))).toBe(true);
  });

  it('offers it after a sync that added no events, since Health keeps daily records too', () => {
    expect(canForget(source({ source: 'health', eventCount: 0 }))).toBe(true);
  });

  it('never offers it for a source the app cannot collect', () => {
    expect(canForget(source({ status: 'unavailable', eventCount: 0, lastSyncedAt: null }))).toBe(
      false,
    );
  });
});

describe('forgetConfirmation', () => {
  it('counts the entries it will delete', () => {
    expect(forgetConfirmation(source({ eventCount: 1 }), 'Health Connect').message).toContain(
      '1 entry ',
    );
    expect(forgetConfirmation(source({ eventCount: 23 }), 'Health Connect').message).toContain(
      '23 entries',
    );
  });

  it('does not claim to delete "0 entries" when only other records are left', () => {
    const { message } = forgetConfirmation(source({ source: 'health', eventCount: 0 }), 'Apple Health');

    expect(message).not.toMatch(/\b0 entr(y|ies)\b/);
  });

  it('says the source is turned off as well', () => {
    const { message } = forgetConfirmation(source(), 'Health Connect');

    expect(message).toMatch(/turns Calendar off/);
  });

  it('names the health app this phone has, never another platform’s', () => {
    const { message } = forgetConfirmation(
      source({ source: 'health', title: 'Health & Activity' }),
      'Health Connect',
    );

    expect(message).toContain('Health Connect');
    expect(message).not.toContain('Apple Health');
  });
});

describe('forgottenNotice', () => {
  it('reports how many entries went', () => {
    expect(forgottenNotice('Calendar', 1).message).toMatch(/^1 entry deleted/);
    expect(forgottenNotice('Calendar', 12).message).toMatch(/^12 entries deleted/);
  });

  it('does not report "0 entries deleted"', () => {
    expect(forgottenNotice('Health & Activity', 0).message).not.toMatch(/\b0 entr(y|ies)\b/);
  });
});
