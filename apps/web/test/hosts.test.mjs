import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PUBLIC, read } from './helpers.mjs';

// The page and everything it loads. The licence text in fonts/ names its own addresses and
// is not something a visitor's browser runs.
const SERVED = ['index.html', 'styles.css', 'app.js', 'release.js'];
const ALLOWED = new Set(['github.com', 'api.github.com', 'synitheia.vercel.app']);

test('every absolute address is on GitHub or on this site', () => {
  for (const file of SERVED) {
    const addresses = read(PUBLIC, file).match(/https?:\/\/[^\s"'<>)`]+/g) ?? [];
    for (const address of addresses) {
      assert.ok(address.startsWith('https://'), `${file}: ${address} is not https`);
      assert.ok(ALLOWED.has(new URL(address).hostname), `${file}: ${address}`);
    }
  }
});

test('nothing is loaded protocol-relative', () => {
  for (const file of SERVED) {
    assert.doesNotMatch(read(PUBLIC, file), /(?:src|href)=["']\/\/|url\(\s*["']?\/\//, file);
  }
});
