import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PUBLIC, read } from './helpers.mjs';

// What a first visit downloads. The social image and the touch icon are fetched by other
// things (a link preview, a home-screen shortcut), not by a visit.
const FIRST_LOAD = [
  'index.html',
  'styles.css',
  'app.js',
  'release.js',
  'fonts/manrope-latin.woff2',
  'fonts/manrope-latin-ext.woff2',
  'favicon.png',
];

// The spec's budget. Overridable only so the test can be seen to fail.
const BUDGET = Number(process.env.WEIGHT_BUDGET ?? 256_000);

test('a first visit downloads less than 250 KB', () => {
  const total = FIRST_LOAD.reduce((sum, file) => sum + statSync(join(PUBLIC, file)).size, 0);
  assert.ok(total < BUDGET, `first load is ${total} bytes; the budget is ${BUDGET}`);
});

test('the list is what a first visit really loads', () => {
  const html = read(PUBLIC, 'index.html');
  for (const file of ['styles.css', 'app.js', 'favicon.png', 'fonts/manrope-latin.woff2']) {
    assert.ok(html.includes(`"${file}"`), `index.html does not load ${file}`);
  }
  assert.match(read(PUBLIC, 'app.js'), /from '\.\/release\.js'/);

  const css = read(PUBLIC, 'styles.css');
  for (const font of ['fonts/manrope-latin.woff2', 'fonts/manrope-latin-ext.woff2']) {
    assert.ok(css.includes(`url("${font}")`), `styles.css does not load ${font}`);
  }
});
