import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createPreviewServer, headersFor } from '../scripts/preview.mjs';

// A folder and a config of the test's own, so this says nothing about the real page.
const config = {
  headers: [
    { source: '/(.*)', headers: [{ key: 'X-Everywhere', value: 'yes' }] },
    {
      source: '/fonts/(.*)',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    },
  ],
};

let outside;
let server;
let origin;

before(async () => {
  outside = mkdtempSync(join(tmpdir(), 'preview-test-'));
  const root = join(outside, 'public');
  mkdirSync(join(root, 'fonts'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>home</title>');
  writeFileSync(join(root, 'fonts', 'a.woff2'), 'font');
  writeFileSync(join(outside, 'secret.txt'), 'not for serving');

  server = createPreviewServer({ root, config });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  rmSync(outside, { recursive: true, force: true });
});

test('headersFor applies every rule whose pattern matches the path', () => {
  assert.deepEqual(headersFor('/index.html', config), { 'X-Everywhere': 'yes' });
  assert.deepEqual(headersFor('/fonts/a.woff2', config), {
    'X-Everywhere': 'yes',
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
  assert.deepEqual(headersFor('/anything', {}), {});
});

test('the home page is served for /, with the headers meant for every path', async () => {
  const response = await fetch(`${origin}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html/);
  assert.equal(response.headers.get('x-everywhere'), 'yes');
  assert.equal(response.headers.get('cache-control'), null);
  assert.match(await response.text(), /<title>home<\/title>/);
});

test('a font gets both rules and its own content type', async () => {
  const response = await fetch(`${origin}/fonts/a.woff2`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'font/woff2');
  assert.equal(response.headers.get('x-everywhere'), 'yes');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
});

test('nothing outside the folder is served, however the path is spelled', async () => {
  const attempts = [
    '/../secret.txt',
    '/..%2Fsecret.txt',
    '/%2e%2e/secret.txt',
    '/fonts/..%2F..%2Fsecret.txt',
    '/%E0%A4%A',
  ];
  for (const path of attempts) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(await response.text(), /not for serving/, path);
  }
});

test('a missing file and a folder are both a 404', async () => {
  for (const path of ['/nope.html', '/fonts', '/fonts/']) {
    assert.equal((await fetch(`${origin}${path}`)).status, 404, path);
  }
});
