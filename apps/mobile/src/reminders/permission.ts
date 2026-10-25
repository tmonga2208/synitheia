import * as Notifications from 'expo-notifications';

/**
 * Whether reminders can reach the user, said out loud.
 *
 * Without notification permission a reminder used to look switched on and simply never
 * arrive, and nothing said why. Three states matter, because they need different help:
 * allowed; not asked yet (the app can ask); refused for good (only Settings can change it).
 */
export type NotificationAccess = 'granted' | 'ask' | 'blocked';

function accessFrom(permission: { granted: boolean; canAskAgain: boolean }): NotificationAccess {
  if (permission.granted) return 'granted';
  return permission.canAskAgain ? 'ask' : 'blocked';
}

export async function readNotificationAccess(): Promise<NotificationAccess> {
  return accessFrom(await Notifications.getPermissionsAsync());
}

/** Shows the system question only when the phone still will; otherwise reports the state. */
export async function askForNotifications(): Promise<NotificationAccess> {
  const current = await readNotificationAccess();
  if (current !== 'ask') return current;
  return accessFrom(await Notifications.requestPermissionsAsync());
}

export interface AccessCopy {
  title: string;
  body: string;
  action: 'ask' | 'settings';
  actionLabel: string;
}

export function accessCopy(access: NotificationAccess): AccessCopy | null {
  if (access === 'granted') return null;

  return {
    title: 'Reminders can’t reach you',
    body: 'Notifications are off for Synítheia, so none of these will appear.',
    action: access === 'ask' ? 'ask' : 'settings',
    actionLabel: access === 'ask' ? 'Turn on notifications' : 'Open Settings',
  };
}
