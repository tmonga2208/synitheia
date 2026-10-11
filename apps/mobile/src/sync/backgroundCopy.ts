/**
 * The sentence under "Sync in the background" on Connected Context.
 *
 * It names what the background task will actually read, because this is the screen that
 * promises to say so. Two things follow from that:
 *
 *   - Only connected sources are named. The card appears when either one is connected,
 *     and "keeps Calendar up to date" over a calendar that is switched off is false.
 *   - On Android, health comes with its condition. A background task may only read Health
 *     Connect once the user has allowed background access there, and Health Connect does
 *     not offer that on every phone. Without it the reader does not read in the background
 *     at all and the task sends nothing — so the sentence must not promise more than "if".
 */
export function backgroundSyncCopy(
  os: string,
  connected: { health: boolean; calendar: boolean },
): string {
  if (os === 'ios') {
    const sources = [connected.health ? 'Health' : null, connected.calendar ? 'Calendar' : null]
      .filter((name) => name !== null)
      .join(' and ');

    return `Keeps ${sources} up to date when your phone allows it. This is best-effort: iOS decides when it runs, and it stops if you force-quit the app.`;
  }

  const bestEffort = 'This is best-effort: Android decides when it runs.';
  const condition =
    'you have allowed background access for Synítheia in Health Connect, which not every phone offers';

  if (connected.health && connected.calendar) {
    return `Keeps Calendar up to date when your phone allows it. Health is included only if ${condition}. ${bestEffort}`;
  }
  if (connected.health) {
    return `Keeps Health up to date, but only if ${condition}. ${bestEffort}`;
  }
  return `Keeps Calendar up to date when your phone allows it. ${bestEffort}`;
}
