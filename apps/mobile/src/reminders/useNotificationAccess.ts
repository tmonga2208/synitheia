import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { readNotificationAccess, type NotificationAccess } from './permission.js';

/**
 * Notification access, re-read whenever the app comes back to the front, which is how a
 * change made in Settings shows up without a restart. Null until first read.
 */
export function useNotificationAccess(): [
  NotificationAccess | null,
  (next: NotificationAccess) => void,
] {
  const [access, setAccess] = useState<NotificationAccess | null>(null);

  useEffect(() => {
    let alive = true;
    const read = () => {
      readNotificationAccess()
        .then((next) => {
          if (alive) setAccess(next);
        })
        .catch(() => undefined);
    };

    read();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') read();
    });

    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  return [access, setAccess];
}
