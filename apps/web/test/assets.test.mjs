import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PUBLIC, read } from './helpers.mjs';

const bytes = (file) => readFileSync(join(PUBLIC, file));
const sha256 = (file) => createHash('sha256').update(bytes(file)).digest('hex');

// Pinned so that a font can only change on purpose. These are Google Fonts' own WOFF2 cuts
// of Manrope v20: one variable file per character range, weights 400 to 700.
const FONTS = {
  'fonts/manrope-latin.woff2': 'e310b55a7fd9677f5e3555e6c6c4d064fa1f1d24393f0ddbe217cea12a8c432f',
  'fonts/manrope-latin-ext.woff2':
    'ce093b341d9c10658ee1eaa85c5f8042ff3307bc6ccfc5f405616eb437f0009e',
};

for (const [file, digest] of Object.entries(FONTS)) {
  test(`${file} is the pinned WOFF2 file`, () => {
    assert.equal(bytes(file).subarray(0, 4).toString('latin1'), 'wOF2');
    assert.equal(sha256(file), digest);
  });
}

test('the font licence travels with the fonts', () => {
  const licence = read(PUBLIC, 'fonts', 'OFL.txt');
  assert.match(licence, /The Manrope Project Authors/);
  assert.match(licence, /SIL Open Font License, Version 1\.1/);
});

test('every file the stylesheet points at exists', () => {
  const css = read(PUBLIC, 'styles.css');
  const targets = [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map(([, target]) => target);
  assert.equal(targets.length, 2, 'expected exactly the two font files');
  for (const target of targets) assert.ok(existsSync(join(PUBLIC, target)), `${target} is missing`);
});

/** Width and height from a PNG's IHDR chunk, which always comes first. */
function pngSize(file) {
  const png = bytes(file);
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG', `${file} is not a PNG`);
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

const ICONS = {
  'favicon.png': [48, 48],
  'apple-touch-icon.png': [180, 180],
  'og.png': [1200, 630],
};

for (const [file, size] of Object.entries(ICONS)) {
  test(`${file} is ${size.join(' by ')}`, () => assert.deepEqual(pngSize(file), size));
}
