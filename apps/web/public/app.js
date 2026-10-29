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

/**
 * Play a screen's animation only while it is on screen.
 *
 * The stylesheet animates a mock only under `.in-view`, and only for visitors who have not
 * asked for reduced motion. Without this script nothing is marked, so every screen simply
 * shows its finished state. `motion-ready` lets the stylesheet hold back a screen's entrance
 * until it is seen, which is only safe once something is going to reveal it.
 */
function playMocksInView() {
  const mocks = document.querySelectorAll('.mock');
  if (mocks.length === 0 || !('IntersectionObserver' in window)) return;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) entry.target.classList.toggle('in-view', entry.isIntersecting);
    },
    { threshold: 0.3 },
  );
  for (const mock of mocks) observer.observe(mock);
  document.documentElement.classList.add('motion-ready');
}

playMocksInView();
