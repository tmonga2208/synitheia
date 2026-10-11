import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ASSET_NAMES } from '../public/release.js';
import { PUBLIC, REPO, read } from './helpers.mjs';

const html = read(PUBLIC, 'index.html');
const PREFIX = 'https://github.com/tmonga2208/synitheia/releases/latest/download/';

/**
 * The file a build workflow uploads: the last segment of the `path:` line that ends in this
 * extension. If someone renames the artifact there, the button here must fail a test rather
 * than quietly point at nothing.
 */
function builtFile(workflow, extension) {
  const yaml = read(REPO, '.github', 'workflows', workflow);
  const match = new RegExp(`^\\s*path:.*/([^/\\s]+\\.${extension})\\s*$`, 'm').exec(yaml);
  assert.ok(match, `${workflow} uploads no .${extension}`);
  return match[1];
}

const built = [builtFile('android.yml', 'apk'), builtFile('ios.yml', 'ipa')].sort();

test('the page offers exactly the two files the workflows build', () => {
  const offered = [...html.matchAll(/href="([^"]*\/releases\/latest\/download\/[^"]*)"/g)].map(
    ([, href]) => href,
  );
  assert.ok(offered.length >= 2);
  for (const href of offered) assert.ok(href.startsWith(PREFIX), href);
  assert.deepEqual([...new Set(offered.map((href) => href.slice(PREFIX.length)))].sort(), built);
});

test('both downloads are plain links, so they work with scripts off', () => {
  for (const name of built) {
    assert.ok(html.includes(`<a class="button" href="${PREFIX}${name}">`), name);
  }
});

test('release.js names the same two files', () => {
  assert.deepEqual(Object.values(ASSET_NAMES).sort(), built);
});
