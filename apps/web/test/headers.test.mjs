import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WEB, read } from './helpers.mjs';

const config = JSON.parse(read(WEB, 'vercel.json'));
const everywhere = config.headers.find((rule) => rule.source === '/(.*)');
const header = (name) =>
  everywhere.headers.find(({ key }) => key.toLowerCase() === name)?.value ?? null;

test('the site is public/ as it stands, with nothing built', () => {
  assert.equal(config.outputDirectory, 'public');
  assert.equal(config.framework, null);
  assert.equal(config.buildCommand, undefined);
});

test('the policy allows this site and one GitHub request, and nothing else', () => {
  const policy = header('content-security-policy');
  const directives = Object.fromEntries(
    policy.split(';').map((directive) => {
      const [name, ...values] = directive.trim().split(/\s+/);
      return [name, values];
    }),
  );

  assert.deepEqual(directives, {
    'default-src': ["'none'"],
    'script-src': ["'self'"],
    'style-src': ["'self'"],
    'img-src': ["'self'"],
    'font-src': ["'self'"],
    'connect-src': ['https://api.github.com'],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
    'frame-ancestors': ["'none'"],
  });
});

test('the other protective headers are set', () => {
  assert.equal(header('x-content-type-options'), 'nosniff');
  assert.equal(header('x-frame-options'), 'DENY');
  assert.equal(header('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.match(header('permissions-policy'), /camera=\(\).*geolocation=\(\).*microphone=\(\)/);
});

test('fonts are cached for a year, because their names never change meaning', () => {
  const fonts = config.headers.find((rule) => rule.source === '/fonts/(.*)');
  assert.deepEqual(fonts.headers, [
    { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
  ]);
});
