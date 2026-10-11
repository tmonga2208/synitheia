/**
 * Fill in the version, the date and the file sizes from the latest GitHub release.
 *
 * This is the page's only script and its only request to another host. Nothing depends on
 * it: the download buttons are plain links, and every place this writes to already holds
 * text that is true without it. So every failure here ends the same way, by doing nothing.
 */
import { LATEST_RELEASE_URL, describeRelease, releaseLine } from './release.js';

async function showLatestRelease() {
  const places = document.querySelectorAll('[data-release]');
  if (places.length === 0) return;

  try {
    const response = await fetch(LATEST_RELEASE_URL, {
      headers: { accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return;

    const release = describeRelease(await response.json());
    for (const place of places) {
      const line = releaseLine(release, place.dataset.release);
      // textContent, never innerHTML: the version string comes from the network.
      if (line) place.textContent = line;
    }
  } catch {
    // Offline, blocked, rate-limited or not JSON. The text already on the page stands.
  }
}

showLatestRelease();
