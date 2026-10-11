import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ASSET_NAMES,
  LATEST_RELEASE_URL,
  describeRelease,
  formatBytes,
  releaseLine,
} from '../public/release.js';

// What GitHub answered for v0.2.0, cut down to the fields the page reads.
const LATEST = {
  tag_name: 'v0.2.0',
  published_at: '2026-10-11T18:59:38Z',
  assets: [
    { name: 'Synitheia-unsigned.ipa', size: 10253544 },
    { name: 'Synitheia.apk', size: 90762436 },
  ],
};

// Pinned, because the default is the machine's own locale and time zone.
const pinned = { locale: 'en-GB', timeZone: 'UTC' };

test('the request goes to the latest release of this repository', () => {
  assert.equal(
    LATEST_RELEASE_URL,
    'https://api.github.com/repos/tmonga2208/synitheia/releases/latest',
  );
  assert.deepEqual(ASSET_NAMES, { apk: 'Synitheia.apk', ipa: 'Synitheia-unsigned.ipa' });
});

test('a real answer becomes a version, a date and two sizes', () => {
  assert.deepEqual(describeRelease(LATEST, pinned), {
    version: 'v0.2.0',
    date: '11 Oct 2026',
    sizes: { apk: '86.6 MB', ipa: '9.8 MB' },
  });
});

test('the date is the visitor’s day, not Greenwich’s', () => {
  const inIndia = describeRelease(LATEST, { locale: 'en-GB', timeZone: 'Asia/Kolkata' });
  assert.equal(inIndia.date, '12 Oct 2026');
});

test('a rate-limit answer is not a release', () => {
  const limited = { message: 'API rate limit exceeded for 203.0.113.7.' };
  assert.equal(describeRelease(limited, pinned), null);
});

test('nothing that is not a release object is a release', () => {
  for (const junk of [null, undefined, '', 'v0.2.0', 42, [], { tag_name: '' }, { tag_name: 7 }]) {
    assert.equal(describeRelease(junk, pinned), null, JSON.stringify(junk));
  }
});

test('a release with one file missing still describes the other', () => {
  const onlyApk = { ...LATEST, assets: [{ name: 'Synitheia.apk', size: 90762436 }] };
  const release = describeRelease(onlyApk, pinned);
  assert.deepEqual(release.sizes, { apk: '86.6 MB', ipa: null });
  assert.equal(releaseLine(release, 'ipa'), 'v0.2.0 · 11 Oct 2026');
});

test('a release with no assets list at all is still a version and a date', () => {
  const { assets: _dropped, ...bare } = LATEST;
  assert.equal(releaseLine(describeRelease(bare, pinned), 'apk'), 'v0.2.0 · 11 Oct 2026');
});

test('an unreadable date is left out rather than shown as nonsense', () => {
  const release = describeRelease({ ...LATEST, published_at: 'soon' }, pinned);
  assert.equal(release.date, null);
  assert.equal(releaseLine(release, 'apk'), 'v0.2.0 · 86.6 MB');
});

test('sizes read the way GitHub shows them', () => {
  assert.equal(formatBytes(90762436), '86.6 MB');
  assert.equal(formatBytes(10253544), '9.8 MB');
  assert.equal(formatBytes(51200), '50 KB');
  for (const junk of [0, -5, NaN, Infinity, '12', null, undefined]) {
    assert.equal(formatBytes(junk), null, String(junk));
  }
});

test('the line under each button', () => {
  const release = describeRelease(LATEST, pinned);
  assert.equal(releaseLine(release, 'apk'), 'v0.2.0 · 11 Oct 2026 · 86.6 MB');
  assert.equal(releaseLine(release, 'ipa'), 'v0.2.0 · 11 Oct 2026 · 9.8 MB');
  assert.equal(releaseLine(release, 'version'), 'v0.2.0 · 11 Oct 2026');
  assert.equal(releaseLine(null, 'apk'), null);
});
