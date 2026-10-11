import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PUBLIC, contrast, read, rulesOf, tokens } from './helpers.mjs';

const css = read(PUBLIC, 'styles.css');

// Every text colour, with every ground the stylesheet is allowed to put it on.
//
// --accent-text is deliberately absent from --surface-raised and --accent-wash: in light it
// measures 4.41:1 and 4.37:1 there. Sage words belong on the page or on a card.
const TEXT_ON = [
  ['--text', '--bg'],
  ['--text', '--surface'],
  ['--text', '--surface-raised'],
  ['--text', '--accent-wash'],
  ['--text', '--habit-sage-wash'],
  ['--text-muted', '--bg'],
  ['--text-muted', '--surface'],
  ['--text-muted', '--surface-raised'],
  ['--text-muted', '--accent-wash'],
  ['--text-muted', '--habit-sage-wash'],
  ['--accent-text', '--bg'],
  ['--accent-text', '--surface'],
  ['--button-text', '--button'],
  ['--text-muted', '--flow-0'],
  ['--text', '--flow-1'],
  ['--text', '--flow-2'],
  ['--text', '--flow-3'],
  ['--button-text', '--flow-4'],
];

test('the contrast helper agrees with the two ends of the scale', () => {
  assert.equal(contrast('#FFFFFF', '#000000'), 21);
  assert.equal(contrast('#777777', '#777777'), 1);
});

for (const theme of ['light', 'dark']) {
  for (const [text, ground] of TEXT_ON) {
    test(`${theme}: ${text} on ${ground} is at least 4.5:1`, () => {
      const t = tokens(css, theme);
      const ratio = contrast(t[text], t[ground]);
      assert.ok(ratio >= 4.5, `${t[text]} on ${t[ground]} is ${ratio.toFixed(2)}:1`);
    });
  }
}

test('a colour is written down only as a token', () => {
  const literals = rulesOf(css).match(/#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/gi) ?? [];
  assert.deepEqual(literals, []);
});

test('text is only ever coloured with a text token', () => {
  const allowed = /^(var\(--(text|text-muted|accent-text|button-text)\)|inherit|currentColor)$/;
  const used = [...rulesOf(css).matchAll(/(?<![-\w])color\s*:\s*([^;}]+)/g)].map(([, value]) =>
    value.trim(),
  );
  assert.ok(used.length > 0, 'the stylesheet sets no text colour at all');
  assert.deepEqual(
    used.filter((value) => !allowed.test(value)),
    [],
  );
});
