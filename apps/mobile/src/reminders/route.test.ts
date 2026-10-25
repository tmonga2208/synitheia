import { describe, expect, it } from 'vitest';
import { routeForNotification } from './route.js';

describe('routeForNotification', () => {
  it('opens the screen a reminder is about', () => {
    expect(
      routeForNotification({
        source: 'synitheia-reminder',
        kind: 'water',
        reminderId: '6a7025c8d36b5e0013390201',
        habitId: null,
        route: '/water',
      }),
    ).toBe('/water');

    expect(
      routeForNotification({
        source: 'synitheia-reminder',
        kind: 'habit',
        reminderId: null,
        habitId: '6a7025c8d36b5e0013390101',
        route: '/',
      }),
    ).toBe('/');
  });

  it('opens Today for a suggestion, where its card is', () => {
    expect(routeForNotification({ suggestionId: '6a7025c8d36b5e0013390301' })).toBe('/');
  });

  it('goes nowhere for anything it does not recognise', () => {
    expect(routeForNotification(undefined)).toBeNull();
    expect(routeForNotification(null)).toBeNull();
    expect(routeForNotification('water')).toBeNull();
    // A repeating reminder from an older build: the app opens where it was.
    expect(routeForNotification({ reminderId: '6a7025c8d36b5e0013390201' })).toBeNull();
    // A route this app never plans is not followed, whatever the notification says.
    expect(
      routeForNotification({ source: 'synitheia-reminder', route: '/privacy/account' }),
    ).toBeNull();
  });
});
