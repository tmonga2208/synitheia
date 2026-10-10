import { describe, expect, it } from 'vitest';
import { backgroundSyncCopy } from './backgroundCopy.js';

describe('backgroundSyncCopy', () => {
  describe('on Android', () => {
    it('says health is read in the background, and on what condition', () => {
      const copy = backgroundSyncCopy('android', { health: true, calendar: true });

      expect(copy).toContain('Calendar');
      expect(copy).toContain('Health');
      // Android only lets a background task read Health Connect once the user has allowed
      // background access there, and not every phone offers it.
      expect(copy).toContain('background access');
      expect(copy).toContain('Health Connect');
    });

    it('does not claim to sync a calendar that is not connected', () => {
      const copy = backgroundSyncCopy('android', { health: true, calendar: false });

      expect(copy).not.toContain('Calendar');
      expect(copy).toContain('Health');
      expect(copy).toContain('background access');
    });

    it('does not bring health into it when only the calendar is connected', () => {
      const copy = backgroundSyncCopy('android', { health: false, calendar: true });

      expect(copy).toContain('Calendar');
      expect(copy).not.toContain('Health');
    });

    it.each([
      { health: true, calendar: true },
      { health: true, calendar: false },
      { health: false, calendar: true },
    ])('is plain that Android decides when it runs (%o)', (connected) => {
      const copy = backgroundSyncCopy('android', connected);

      expect(copy).toContain('best-effort');
      expect(copy).toContain('Android decides when it runs');
    });
  });

  describe('on iPhone', () => {
    it('names both sources when both are connected', () => {
      expect(backgroundSyncCopy('ios', { health: true, calendar: true })).toBe(
        'Keeps Health and Calendar up to date when your phone allows it. This is best-effort: iOS decides when it runs, and it stops if you force-quit the app.',
      );
    });

    it('names only the source that is connected', () => {
      const healthOnly = backgroundSyncCopy('ios', { health: true, calendar: false });
      expect(healthOnly).toContain('Keeps Health up to date');
      expect(healthOnly).not.toContain('Calendar');

      const calendarOnly = backgroundSyncCopy('ios', { health: false, calendar: true });
      expect(calendarOnly).toContain('Keeps Calendar up to date');
      expect(calendarOnly).not.toContain('Health');
    });

    it('never mentions Health Connect', () => {
      expect(backgroundSyncCopy('ios', { health: true, calendar: true })).not.toContain(
        'Health Connect',
      );
    });
  });
});
