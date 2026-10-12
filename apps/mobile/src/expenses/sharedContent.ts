/**
 * What another app shared into Synítheia, read from the link Android's share activity opens.
 *
 * On Android a share reaches the app as `synitheia://expenses/new?sharedImage=…` or
 * `…?sharedText=…` (plugins/withShareTarget.js writes the activity that builds it). That
 * link is not a private channel: any app, and any web page, can open one. The import screen
 * uploads whatever this returns once the user taps "Read it", so the rule here is that a
 * link may only name a file this app's own share activity wrote — in its cache, under the
 * random name it chooses. Anything else is ignored, without a message: a forged link is not
 * something to explain to the person holding the phone.
 */

/** Whose cache folder is trusted. A test holds this to app.json. */
export const ANDROID_PACKAGE = 'com.synitheia.app';

/** The share activity cuts text off here too; this is the same limit, held on this side. */
export const MAX_SHARED_TEXT = 4000;

export type SharedContent =
  | { kind: 'image'; uri: string; mimeType: string; name: string }
  | { kind: 'text'; text: string }
  /** The share activity could not read what was shared: too large, withdrawn, or a type the importer does not take. */
  | { kind: 'unreadable' };

const MIME_TYPE: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

// Exactly what the share activity produces, and nothing looser: the app's cache, its
// `shared` folder, a UUID, and one of the four extensions the importer accepts. `user/<n>`
// is the same folder for another user or a work profile; `data/data` is its older spelling.
const SAVED_BY_SHARE_ACTIVITY = new RegExp(
  `^file:///data/(?:user/\\d+|data)/${ANDROID_PACKAGE.replace(/\./g, '\\.')}/cache/shared/` +
    '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpg|png|webp|gif)$',
);

/** Route parameters as the router hands them over: a value given twice arrives as a list. */
type RouteParams = Record<string, string | string[] | undefined>;

export function sharedContentFrom(params: RouteParams): SharedContent | null {
  const image = params.sharedImage;
  if (typeof image === 'string') {
    const extension = SAVED_BY_SHARE_ACTIVITY.exec(image)?.[1];
    const mimeType = extension ? MIME_TYPE[extension] : undefined;
    // The type comes from the file that will be sent, never from what the link claims.
    if (extension && mimeType) {
      return { kind: 'image', uri: image, mimeType, name: `shared.${extension}` };
    }
  }

  const text = params.sharedText;
  if (typeof text === 'string' && text.trim() !== '') {
    return { kind: 'text', text: text.trim().slice(0, MAX_SHARED_TEXT) };
  }

  if (typeof params.sharedError === 'string') return { kind: 'unreadable' };

  return null;
}
