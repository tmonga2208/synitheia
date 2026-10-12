import { readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ANDROID_PACKAGE, MAX_SHARED_TEXT, sharedContentFrom } from './sharedContent.js';

const NAME = '3f2b6c1e-9a47-4d0b-8a55-0c2f6a1d9e77';
const FOLDER = '/data/user/0/com.synitheia.app/cache/shared';

describe('sharedContentFrom', () => {
  it('accepts an image the share activity saved', () => {
    expect(sharedContentFrom({ sharedImage: `file://${FOLDER}/${NAME}.png` })).toEqual({
      kind: 'image',
      uri: `file://${FOLDER}/${NAME}.png`,
      mimeType: 'image/png',
      name: 'shared.png',
    });
  });

  it('reads the type from the file it will send, not from what the link claims', () => {
    const shared = sharedContentFrom({
      sharedImage: `file://${FOLDER}/${NAME}.jpg`,
      sharedType: 'application/x-executable',
    });
    expect(shared).toMatchObject({ kind: 'image', mimeType: 'image/jpeg', name: 'shared.jpg' });

    expect(sharedContentFrom({ sharedImage: `file://${FOLDER}/${NAME}.webp` })).toMatchObject({
      mimeType: 'image/webp',
    });
    expect(sharedContentFrom({ sharedImage: `file://${FOLDER}/${NAME}.gif` })).toMatchObject({
      mimeType: 'image/gif',
    });
  });

  it('accepts the older spelling of the app’s data folder, and other device users', () => {
    const older = `file:///data/data/com.synitheia.app/cache/shared/${NAME}.png`;
    const workProfile = `file:///data/user/10/com.synitheia.app/cache/shared/${NAME}.png`;
    expect(sharedContentFrom({ sharedImage: older })).toMatchObject({ kind: 'image', uri: older });
    expect(sharedContentFrom({ sharedImage: workProfile })).toMatchObject({ kind: 'image' });
  });

  // The link is `synitheia://expenses/new?sharedImage=…`, and any app or web page can open
  // one. Whatever it names would be uploaded when the user taps "Read it". So the only thing
  // it may name is a file this app's own share activity wrote.
  it.each([
    ['another folder of this app', 'file:///data/user/0/com.synitheia.app/databases/RKStorage'],
    ['a climb out of the share folder', `file://${FOLDER}/../../shared_prefs/secrets.xml`],
    ['an encoded climb', `file://${FOLDER}/..%2F..%2Fshared_prefs%2Fsecrets.xml`],
    ['a name the share activity would not have chosen', `file://${FOLDER}/photo.png`],
    ['a folder inside the share folder', `file://${FOLDER}/x/${NAME}.png`],
    ['a type the importer does not take', `file://${FOLDER}/${NAME}.svg`],
    ['another app’s cache', `file:///data/user/0/com.evil.app/cache/shared/${NAME}.png`],
    ['shared storage', `file:///sdcard/Download/${NAME}.png`],
    ['a content address', `content://media/external/images/media/42`],
    ['a web address', `https://example.com/${NAME}.png`],
    ['a bare path', `${FOLDER}/${NAME}.png`],
    ['a trailing extra', `file://${FOLDER}/${NAME}.png?x=1`],
  ])('ignores an image that is %s', (_what, sharedImage) => {
    expect(sharedContentFrom({ sharedImage })).toBeNull();
  });

  it('accepts shared text, trimmed', () => {
    expect(sharedContentFrom({ sharedText: '  Paid Rs 320.00 to Green Bowl Cafe  \n' })).toEqual({
      kind: 'text',
      text: 'Paid Rs 320.00 to Green Bowl Cafe',
    });
  });

  it('cuts text off at the length the share activity allows', () => {
    const shared = sharedContentFrom({ sharedText: 'x'.repeat(MAX_SHARED_TEXT + 500) });
    expect(shared).toEqual({ kind: 'text', text: 'x'.repeat(MAX_SHARED_TEXT) });
  });

  it('ignores text with nothing in it', () => {
    expect(sharedContentFrom({ sharedText: '   \n ' })).toBeNull();
    expect(sharedContentFrom({ sharedText: '' })).toBeNull();
  });

  it('says so when the share activity could not read what was shared', () => {
    expect(sharedContentFrom({ sharedError: 'unreadable' })).toEqual({ kind: 'unreadable' });
  });

  it('ignores a parameter given more than once', () => {
    // The router hands a repeated parameter over as a list. Nothing the share activity
    // writes repeats one.
    expect(sharedContentFrom({ sharedText: ['a', 'b'] })).toBeNull();
    expect(sharedContentFrom({ sharedImage: [`file://${FOLDER}/${NAME}.png`] })).toBeNull();
  });

  it('is nothing when nothing was shared', () => {
    expect(sharedContentFrom({})).toBeNull();
    expect(sharedContentFrom({ unrelated: 'value' })).toBeNull();
  });

  it('prefers the image when a link carries both', () => {
    const shared = sharedContentFrom({
      sharedImage: `file://${FOLDER}/${NAME}.png`,
      sharedText: 'hello',
    });
    expect(shared).toMatchObject({ kind: 'image' });
  });
});

describe('ANDROID_PACKAGE', () => {
  it('is the package app.json builds, since that is whose cache folder is trusted', () => {
    const config = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../app.json', import.meta.url)), 'utf8'),
    ) as { expo: { android: { package: string } } };

    expect(ANDROID_PACKAGE).toBe(config.expo.android.package);
  });
});
