/** The words for working offline, in one place. */

/** The sign-out question's message, which warns when changes made offline would be lost. */
export function signOutMessage(waiting: number): string {
  if (waiting === 0) return 'You will need to sign in again on this device.';
  if (waiting === 1) {
    return '1 change made offline hasn’t synced yet. Signing out now deletes it.';
  }
  return `${waiting} changes made offline haven’t synced yet. Signing out now deletes them.`;
}
