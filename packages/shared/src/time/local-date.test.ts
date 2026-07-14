import { describe, expect, it } from 'vitest';
import {
  addLocalDays,
  asLocalDate,
  diffLocalDays,
  eachLocalDay,
  isLocalDate,
  isValidTimeZone,
  localDayRange,
  localMinutesOfDay,
  localWeekdayIndex,
  startOfLocalDay,
  startOfLocalMonth,
  startOfLocalWeek,
  toLocalDate,
} from './local-date.js';

const IST = 'Asia/Kolkata'; // UTC+5:30, no DST
const NY = 'America/New_York'; // DST
const UTC = 'UTC';

describe('isLocalDate', () => {
  it('accepts well-formed dates', () => {
    expect(isLocalDate('2026-07-12')).toBe(true);
    expect(isLocalDate('2024-02-29')).toBe(true); // leap year
  });

  it('rejects malformed shapes', () => {
    expect(isLocalDate('2026-7-12')).toBe(false);
    expect(isLocalDate('12-07-2026')).toBe(false);
    expect(isLocalDate('')).toBe(false);
  });

  it('rejects dates that match the shape but do not exist', () => {
    expect(isLocalDate('2026-02-30')).toBe(false);
    expect(isLocalDate('2026-13-01')).toBe(false);
    expect(isLocalDate('2025-02-29')).toBe(false); // not a leap year
  });
});

describe('toLocalDate', () => {
  it('is the same calendar day in UTC', () => {
    expect(toLocalDate(new Date('2026-07-12T10:00:00Z'), UTC)).toBe('2026-07-12');
  });

  it('rolls forward for a late-evening IST log that is still "today" to the user', () => {
    // 23:30 IST on the 12th is 18:00 UTC on the 12th — same day here, but the
    // inverse case below is the one that bites.
    expect(toLocalDate(new Date('2026-07-12T18:00:00Z'), IST)).toBe('2026-07-12');
  });

  it('keeps a post-midnight-UTC IST evening on the correct local day', () => {
    // 2026-07-12T20:00Z is 2026-07-13 01:30 IST — a different local day.
    expect(toLocalDate(new Date('2026-07-12T20:00:00Z'), IST)).toBe('2026-07-13');
  });

  it('keeps a US evening on the previous UTC day', () => {
    // 2026-07-13T02:00Z is 2026-07-12 22:00 in New York.
    expect(toLocalDate(new Date('2026-07-13T02:00:00Z'), NY)).toBe('2026-07-12');
  });

  it('handles the exact local midnight boundary', () => {
    // 18:30Z is exactly 00:00 IST the next day.
    expect(toLocalDate(new Date('2026-07-12T18:29:59Z'), IST)).toBe('2026-07-12');
    expect(toLocalDate(new Date('2026-07-12T18:30:00Z'), IST)).toBe('2026-07-13');
  });
});

describe('startOfLocalDay', () => {
  it('resolves IST midnight to 18:30Z the previous day', () => {
    expect(startOfLocalDay(asLocalDate('2026-07-13'), IST).toISOString()).toBe(
      '2026-07-12T18:30:00.000Z',
    );
  });

  it('accounts for daylight saving offset', () => {
    // EDT (UTC-4) in July.
    expect(startOfLocalDay(asLocalDate('2026-07-13'), NY).toISOString()).toBe(
      '2026-07-13T04:00:00.000Z',
    );
    // EST (UTC-5) in January.
    expect(startOfLocalDay(asLocalDate('2026-01-13'), NY).toISOString()).toBe(
      '2026-01-13T05:00:00.000Z',
    );
  });
});

describe('localDayRange', () => {
  it('is half-open and 24h long on a normal day', () => {
    const { start, end } = localDayRange(asLocalDate('2026-07-12'), IST);
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('is 23 hours long on a spring-forward day', () => {
    // 2026-03-08 is the US DST spring-forward date.
    const { start, end } = localDayRange(asLocalDate('2026-03-08'), NY);
    expect(end.getTime() - start.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it('is 25 hours long on a fall-back day', () => {
    // 2026-11-01 is the US DST fall-back date.
    const { start, end } = localDayRange(asLocalDate('2026-11-01'), NY);
    expect(end.getTime() - start.getTime()).toBe(25 * 60 * 60 * 1000);
  });

  it('produces contiguous, non-overlapping ranges across a DST boundary', () => {
    const a = localDayRange(asLocalDate('2026-03-07'), NY);
    const b = localDayRange(asLocalDate('2026-03-08'), NY);
    expect(a.end.getTime()).toBe(b.start.getTime());
  });

  it('round-trips: any instant inside a day range maps back to that local date', () => {
    const day = asLocalDate('2026-11-01');
    const { start, end } = localDayRange(day, NY);
    for (const t of [start.getTime(), start.getTime() + 3_600_000, end.getTime() - 1]) {
      expect(toLocalDate(new Date(t), NY)).toBe(day);
    }
    // The instant at `end` belongs to the *next* day — that's what half-open means.
    expect(toLocalDate(end, NY)).toBe('2026-11-02');
  });
});

describe('addLocalDays', () => {
  it('adds and subtracts', () => {
    expect(addLocalDays(asLocalDate('2026-07-12'), 1)).toBe('2026-07-13');
    expect(addLocalDays(asLocalDate('2026-07-12'), -1)).toBe('2026-07-11');
  });

  it('crosses month and year boundaries', () => {
    expect(addLocalDays(asLocalDate('2026-07-31'), 1)).toBe('2026-08-01');
    expect(addLocalDays(asLocalDate('2026-12-31'), 1)).toBe('2027-01-01');
    expect(addLocalDays(asLocalDate('2026-01-01'), -1)).toBe('2025-12-31');
  });

  it('handles leap days', () => {
    expect(addLocalDays(asLocalDate('2024-02-28'), 1)).toBe('2024-02-29');
    expect(addLocalDays(asLocalDate('2025-02-28'), 1)).toBe('2025-03-01');
  });

  it('is unaffected by DST — a day is always a day', () => {
    expect(addLocalDays(asLocalDate('2026-03-07'), 1)).toBe('2026-03-08');
    expect(addLocalDays(asLocalDate('2026-11-01'), 1)).toBe('2026-11-02');
  });
});

describe('diffLocalDays', () => {
  it('counts whole calendar days', () => {
    expect(diffLocalDays(asLocalDate('2026-07-12'), asLocalDate('2026-07-19'))).toBe(7);
    expect(diffLocalDays(asLocalDate('2026-07-19'), asLocalDate('2026-07-12'))).toBe(-7);
    expect(diffLocalDays(asLocalDate('2026-07-12'), asLocalDate('2026-07-12'))).toBe(0);
  });

  it('counts a DST week as exactly 7 days, not 6.96', () => {
    expect(diffLocalDays(asLocalDate('2026-03-05'), asLocalDate('2026-03-12'))).toBe(7);
  });
});

describe('week and month anchors', () => {
  it('anchors weeks to Monday', () => {
    // 2026-07-12 is a Sunday; its week starts Monday 2026-07-06.
    expect(startOfLocalWeek(asLocalDate('2026-07-12'))).toBe('2026-07-06');
    // 2026-07-06 is itself a Monday.
    expect(startOfLocalWeek(asLocalDate('2026-07-06'))).toBe('2026-07-06');
  });

  it('anchors months to the 1st', () => {
    expect(startOfLocalMonth(asLocalDate('2026-07-12'))).toBe('2026-07-01');
  });

  it('indexes weekdays Monday-first to match the chart', () => {
    expect(localWeekdayIndex(asLocalDate('2026-07-06'))).toBe(0); // Mon
    expect(localWeekdayIndex(asLocalDate('2026-07-12'))).toBe(6); // Sun
  });
});

describe('eachLocalDay', () => {
  it('is inclusive of both endpoints', () => {
    expect(eachLocalDay(asLocalDate('2026-07-12'), asLocalDate('2026-07-14'))).toEqual([
      '2026-07-12',
      '2026-07-13',
      '2026-07-14',
    ]);
  });

  it('returns a single day when from === to', () => {
    expect(eachLocalDay(asLocalDate('2026-07-12'), asLocalDate('2026-07-12'))).toEqual([
      '2026-07-12',
    ]);
  });

  it('returns empty when the range is inverted', () => {
    expect(eachLocalDay(asLocalDate('2026-07-14'), asLocalDate('2026-07-12'))).toEqual([]);
  });
});

describe('localMinutesOfDay', () => {
  it('reports wall-clock minutes in the user timezone, not UTC', () => {
    // 07:30 IST — the reminder time in the New Habit screenshot.
    expect(localMinutesOfDay(new Date('2026-07-12T02:00:00Z'), IST)).toBe(7 * 60 + 30);
    expect(localMinutesOfDay(new Date('2026-07-12T02:00:00Z'), UTC)).toBe(2 * 60);
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA zones and rejects junk', () => {
    expect(isValidTimeZone(IST)).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('IST')).toBe(false); // abbreviation, not IANA
  });
});
