import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { promisify } from 'node:util';
import { createPreviewServer } from '../scripts/preview.mjs';
import { CHROME, overflows } from '../scripts/shoot.mjs';
import { WEB } from './helpers.mjs';

const run = promisify(execFile);
const SHOOT = join(WEB, 'scripts', 'shoot.mjs');

// The two tests that drive a real browser are skipped where there is none, rather than
// failing a machine that was never going to run the visual checks.
const noChrome = existsSync(CHROME) ? false : 'Chrome is not installed here';

test('wider than the width asked for is overflow, whatever the browser calls its viewport', () => {
  assert.equal(overflows(390, 390), false);
  assert.equal(overflows(391, 390), true);
  // What Chrome reported for a 195px request under phone emulation: scrollWidth 267, and an
  // innerWidth that had grown to 267 as well. Comparing those two said "no overflow".
  assert.equal(overflows(267, 195), true);
});

let outside;
let server;
let origin;

before(async () => {
  outside = mkdtempSync(join(tmpdir(), 'shoot-test-'));
  const root = join(outside, 'public');
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'index.html'),
    '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>wide</title><body style="margin:0"><div style="width:600px;height:10px"></div>',
  );

  server = createPreviewServer({ root, config: {} });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  rmSync(outside, { recursive: true, force: true });
});

test('a page wider than a phone is reported as overflowing', { skip: noChrome }, async () => {
  const { stdout } = await run('node', [SHOOT, '--url', `${origin}/`, '--width', '320', '--height', '480']);
  const report = JSON.parse(stdout);

  assert.equal(report.measured.scrollWidth, 600);
  assert.equal(report.measured.overflowsSideways, true);
});

test('a page that cannot be loaded is an error, not a clean report', { skip: noChrome }, async () => {
  // A port nothing is listening on: taken, noted, and released.
  const closedPort = await new Promise((resolve) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

  await assert.rejects(
    run('node', [SHOOT, '--url', `http://127.0.0.1:${closedPort}/`, '--width', '320', '--height', '480']),
    (error) => {
      assert.notEqual(error.code, 0);
      assert.match(error.stderr, /could not load/);
      return true;
    },
  );
});
