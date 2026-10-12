import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PUBLIC, read } from './helpers.mjs';

const html = read(PUBLIC, 'index.html');
const figures = [
  ...html.matchAll(/<figure class="mock" id="mock-([\w-]+)">([\s\S]*?)<\/figure>/g),
].map(([, name, body]) => ({ name, body }));

const EXPECTED = [
  'today',
  'your-day',
  'expense-draft',
  'habits',
  'suggestion',
  'insight',
  'month',
  'source',
];

test('the eight mocks are all there, in page order', () => {
  assert.deepEqual(
    figures.map(({ name }) => name),
    EXPECTED,
  );
});

for (const name of EXPECTED) {
  test(`mock-${name} is one described picture with a sample-data caption`, () => {
    const figure = figures.find((candidate) => candidate.name === name);
    assert.ok(figure, `mock-${name} is missing`);

    const pictures = [...figure.body.matchAll(/role="img" aria-label="([^"]*)"/g)];
    assert.equal(pictures.length, 1);
    assert.match(figure.body, /^\s*<div class="[^"]+" role="img" aria-label="/);
    assert.ok(
      pictures[0][1].length >= 80,
      'the description is too short to stand in for the picture',
    );
    // Heard on its own, in a list of images, the label is all a listener gets: the caption
    // under the picture does not come with it. So the label itself has to say it is an example.
    assert.match(pictures[0][1], /^Example: /, 'the description does not say it is an example');
    assert.match(figure.body, /<figcaption>Sample data<\/figcaption>\s*$/);
  });
}

test('nothing inside a mock can be focused, followed or mistaken for page structure', () => {
  for (const { name, body } of figures) {
    assert.doesNotMatch(
      body,
      /<(a|button|input|select|textarea|h[1-6])\b|tabindex=/,
      `mock-${name}`,
    );
  }
});

test('no placeholder is left where a mock belongs', () => {
  assert.doesNotMatch(html, /<!--\s*mock:/);
});
