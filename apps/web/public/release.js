/**
 * The latest release, described for a person.
 *
 * Pure on purpose: everything in this file can be tested without a browser or a network.
 * app.js is the only file that touches either.
 */

export const REPO = 'tmonga2208/synitheia';
export const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

/** The two files the release workflow attaches. A test holds these to the workflows. */
export const ASSET_NAMES = { apk: 'Synitheia.apk', ipa: 'Synitheia-unsigned.ipa' };

/** "86.6 MB". Binary megabytes, because that is what GitHub's own release page shows. */
export function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return null;

  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 0.1) return `${megabytes.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * What GitHub said about the latest release, or null if it said anything else.
 *
 * GitHub answers a rate-limited or failed request with a JSON object too, just not this one,
 * so the shape is checked rather than trusted.
 */
export function describeRelease(payload, { locale, timeZone } = {}) {
  if (payload === null || typeof payload !== 'object') return null;
  if (typeof payload.tag_name !== 'string' || payload.tag_name.trim() === '') return null;

  const published =
    typeof payload.published_at === 'string' ? new Date(payload.published_at) : null;
  const date =
    published && !Number.isNaN(published.getTime())
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(published)
      : null;

  const assets = Array.isArray(payload.assets) ? payload.assets : [];
  const sizeOf = (name) => formatBytes(assets.find((asset) => asset?.name === name)?.size);

  return {
    version: payload.tag_name.trim(),
    date,
    sizes: { apk: sizeOf(ASSET_NAMES.apk), ipa: sizeOf(ASSET_NAMES.ipa) },
  };
}

/** One line for under a button: "v0.2.0 · 11 Oct 2026 · 86.6 MB". Missing parts are left out. */
export function releaseLine(release, kind) {
  if (!release) return null;

  const size = kind === 'apk' || kind === 'ipa' ? release.sizes[kind] : null;
  return [release.version, release.date, size].filter(Boolean).join(' · ');
}
