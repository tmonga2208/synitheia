import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PUBLIC, read } from './helpers.mjs';

const html = read(PUBLIC, 'index.html');
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id));

test('the document declares its language, its viewport and one title', () => {
  assert.match(html, /^<!doctype html>\s*<html lang="en">/i);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.equal((html.match(/<title>/g) ?? []).length, 1);
});

test('there is exactly one h1', () => {
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
});

test('heading levels never skip', () => {
  const levels = [...html.matchAll(/<h([1-6])\b/g)].map(([, level]) => Number(level));
  assert.equal(levels[0], 1);
  for (let i = 1; i < levels.length; i += 1) {
    assert.ok(levels[i] - levels[i - 1] <= 1, `h${levels[i - 1]} is followed by h${levels[i]}`);
  }
});

test('every section is labelled by a heading that exists', () => {
  const sections = [...html.matchAll(/<section\b([^>]*)>/g)].map(([, attributes]) => attributes);
  assert.equal(sections.length, 9);
  for (const attributes of sections) {
    const label = /aria-labelledby="([^"]+)"/.exec(attributes)?.[1];
    assert.ok(label, `a section has no aria-labelledby:${attributes}`);
    assert.match(html, new RegExp(`<h[12] id="${label}"`), `${label} is not a heading`);
  }
});

test('every in-page link has a target', () => {
  const targets = [...html.matchAll(/href="#([^"]+)"/g)].map(([, id]) => id);
  assert.ok(targets.length >= 5);
  for (const id of targets) assert.ok(ids.has(id), `nothing has id="${id}"`);
});

test('every local file the page points at exists', () => {
  const local = [...html.matchAll(/\s(?:href|src)="([^"#:]+)"/g)].map(([, path]) => path);
  assert.ok(local.includes('styles.css') && local.includes('app.js'));
  for (const path of local) assert.ok(existsSync(join(PUBLIC, path)), `${path} is missing`);
});

test('nothing is styled or scripted inline', () => {
  assert.doesNotMatch(html, /\sstyle="/);
  assert.doesNotMatch(html, /<style\b/);
  assert.doesNotMatch(html, /\son[a-z]+="/);

  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map(([, attributes]) => attributes);
  assert.equal(scripts.length, 1);
  assert.match(scripts[0], /type="module" src="app\.js"/);
});

test('every drawing is hidden from assistive technology or labelled', () => {
  const drawings = [...html.matchAll(/<svg\b([^>]*)>/g)].map(([, attributes]) => attributes);
  assert.ok(drawings.length >= 2);
  for (const attributes of drawings) {
    assert.ok(
      /aria-hidden="true"/.test(attributes) || /role="img"[^>]*aria-label="[^"]+"/.test(attributes),
      `an svg is neither hidden nor labelled:${attributes}`,
    );
  }
  for (const [, attributes] of html.matchAll(/<img\b([^>]*)>/g)) {
    assert.match(attributes, /\salt="/, `an img has no alt:${attributes}`);
  }
});
