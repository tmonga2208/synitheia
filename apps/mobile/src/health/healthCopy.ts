/**
 * What to say when the user comes back from Health Connect's permission sheet with nothing
 * allowed.
 *
 * It says only what is known. An empty grant has three causes the app cannot tell apart:
 * the user declined, the user closed the sheet, or the user tapped the sheet's own
 * "privacy policy" link. That link brings Synítheia to the front, and Android closes the
 * sheet behind it, which ends the request (seen on an Android 14 emulator). The earlier
 * wording — "Health Connect didn't give Synítheia access to anything", under a "Could not
 * update" title — told that third user off for reading the policy.
 */
export function nothingAllowedAlert(sourceName: string): { title: string; message: string } {
  return {
    title: 'Health is still off',
    message: `Nothing was allowed in ${sourceName}, so there is nothing for Synítheia to read. Turn this on again and allow at least one kind of data. You can change what is allowed at any time in the ${sourceName} app.`,
  };
}
