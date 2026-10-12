import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PUBLIC, read, textOf } from './helpers.mjs';

const html = read(PUBLIC, 'index.html');
const text = textOf(html);

// The spec's "must be stated". Each is a sentence a visitor reads, not an attribute.
const MUST_BE_STATED = [
  [
    'Android health is unverified on a phone',
    'Health Connect. New in 0.2.0 and not yet verified on a physical phone',
  ],
  [
    'background sync is best-effort and unconfirmed',
    'so it is best-effort, and it has not yet been confirmed on a physical phone',
  ],
  ['the Android build has only run on an emulator', 'Not yet run on a physical phone'],
  ['the iPhone file needs sideloading', 'This file cannot be installed by tapping it'],
  ['Apple Health is lost with a free Apple ID', 'Apple Health does not work'],
  ['where an account lives', "server run by the app's developer"],
  ['what this page is not', 'It is not a legal privacy policy'],
  // Added after the whole-branch review, which checked the page's claims against the code.
  [
    'everything an import sends to a model',
    'pasted messages and the text of a PDF statement are read by a hosted AI model, whether or not AI insights are on',
  ],
  ['the merchant promise is about insights only', 'For insights it is never sent a merchant, a note or a place'],
  // True since the API fix of 2026-10-12, which a test there holds
  // (apps/api/src/modules/privacy/routes.test.ts). Before it, neither could be said.
  ['the export is complete', 'Export everything stored about you as JSON'],
  ['deleting an account erases it', 'Deleted means erased, not hidden'],
  ['what the ring measures', 'your habits, water and food targets'],
  ['iPhone also supplies sex and date of birth', 'on iPhone also sex and date of birth'],
];

for (const [what, sentence] of MUST_BE_STATED) {
  test(`says that ${what}`, () => {
    assert.ok(text.includes(sentence), `missing: "${sentence}"`);
  });
}

// The spec's "must not appear".
const MUST_NOT_APPEAR = [
  ['social proof the project does not have', /testimonial|press quote|as seen in|award/i],
  [
    'a user or download count',
    /\b\d[\d,.]*\s*(\+\s*)?(users|downloads|installs|reviews|ratings)\b/i,
  ],
  ['a rating', /\b(rated|stars?)\b/i],
  ['a feature that cannot be used in the app', /statement inbox|interval reminder/i],
  [
    'a sign-in method that is not known to work',
    /(sign(ing)? in|continue|log ?in) with (google|apple)|google sign-?in|apple sign-?in/i,
  ],
  ['anything "automatic"', /automatic/i],
  ['background sync without its condition', /syncs? in the background/i],
  // Added after the whole-branch review. Each of these was on the page and was not true of
  // the code: no screen deletes one source's data, nothing handles an image shared into the
  // app, and the insight context has no per-category weekday figure.
  ['a button the app does not have', /one source.s data/i],
  ['a share path the app does not have', /share (a|the) payment screenshot/i],
  ['a store-policy reason nobody verified', /google play allows|store policy/i],
  ['phones forbidding what is really a choice', /not something the phones allow/i],
  ['an insight figure the server never computes', /across four fridays|18 food expenses|other weekdays/i],
  ['a ring that covers everything', /across everything you track/i],
  ['XP for merely logging water', /logged water/i],
  ['insights that run by themselves', /most days it has nothing to say/i],
];

for (const [what, pattern] of MUST_NOT_APPEAR) {
  test(`never claims ${what}`, () => assert.doesNotMatch(text, pattern));
}

test('all six rules are named', () => {
  const rules = [
    'Possible meal',
    'Low water',
    'Unusual spending',
    'Low activity',
    'Habit slipping',
    'Workout matches a habit',
  ];
  for (const rule of rules) assert.ok(text.includes(rule), rule);
});

test('all five sources are named', () => {
  const sources = ['Health and activity', 'Calendar', 'Weather', 'Location', 'SMS and notifications'];
  for (const source of sources) assert.ok(html.includes(`<h3>${source}</h3>`), source);
});

test('every mock says it shows sample data, and nothing else borrows the label', () => {
  const mocks = (html.match(/<figure class="mock"/g) ?? []).length;
  const labels = (text.match(/Sample data/g) ?? []).length;
  assert.equal(labels, mocks);
});
