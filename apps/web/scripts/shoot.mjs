#!/usr/bin/env node
/**
 * Look at a page the way a visitor's browser would, without touching anyone's real browser.
 *
 * A verification aid, not part of the site. It starts a throwaway headless Chrome, sets the
 * viewport and the media features a stylesheet can ask about, loads the page, prints what it
 * measured as JSON and saves a screenshot. Node 22 or newer (built-in WebSocket); no packages.
 *
 *   node shoot.mjs --url http://127.0.0.1:4173/ --out hero.png --width 390 --height 844
 *        [--scheme light|dark] [--reduced-motion] [--no-js] [--block <url-pattern>]...
 *        [--selector "#download"] [--full] [--dpr 2] [--tabs 3] [--eval "<js expression>"]
 *
 * Chrome is found at its usual macOS path; set CHROME to use another.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHROME =
  process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/**
 * Whether a page is wider than the width it was asked to fit.
 *
 * Measured against the width requested, never against `window.innerWidth`: under phone
 * emulation Chrome zooms out to show an overflowing page, so `innerWidth` grows to match the
 * content and the two are equal exactly when something has gone wrong.
 */
export function overflows(scrollWidth, requestedWidth) {
  return scrollWidth > requestedWidth;
}

function parseArgs(argv) {
  const opts = { width: 390, height: 844, scheme: 'light', dpr: 1, block: [], tabs: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = () => argv[(i += 1)];
    if (flag === '--url') opts.url = value();
    else if (flag === '--out') opts.out = value();
    else if (flag === '--width') opts.width = Number(value());
    else if (flag === '--height') opts.height = Number(value());
    else if (flag === '--scheme') opts.scheme = value();
    else if (flag === '--dpr') opts.dpr = Number(value());
    else if (flag === '--selector') opts.selector = value();
    else if (flag === '--eval') opts.eval = value();
    else if (flag === '--block') opts.block.push(value());
    else if (flag === '--tabs') opts.tabs = Number(value());
    else if (flag === '--full') opts.full = true;
    else if (flag === '--reduced-motion') opts.reducedMotion = true;
    else if (flag === '--no-js') opts.noJs = true;
    else throw new Error(`unknown flag ${flag}`);
  }
  if (!opts.url) throw new Error('--url is required');
  return opts;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  // Its own profile, so the user's Chrome, its windows and its logins are never involved.
  const profile = mkdtempSync(join(tmpdir(), 'shoot-'));
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  try {
    const endpoint = await new Promise((resolve, reject) => {
      let seen = '';
      const timer = setTimeout(() => reject(new Error('Chrome did not start')), 20000);
      chrome.on('error', reject);
      chrome.stderr.on('data', (chunk) => {
        seen += chunk;
        const match = seen.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
    });

    const socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });

    let nextId = 0;
    const pending = new Map();
    const listeners = [];
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      } else if (message.method) {
        for (const listener of listeners) listener(message);
      }
    });
    const send = (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        nextId += 1;
        pending.set(nextId, { resolve, reject });
        socket.send(JSON.stringify({ id: nextId, method, params, sessionId }));
      });

    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const page = (method, params) => send(method, params, sessionId);

    const consoleErrors = [];
    const failedRequests = [];
    let loaded = false;
    listeners.push((message) => {
      if (message.sessionId !== sessionId) return;
      if (message.method === 'Page.loadEventFired') loaded = true;
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails;
        consoleErrors.push(details.exception?.description ?? details.text);
      }
      // A content-security-policy violation arrives here, which is the point of serving the
      // page through preview.mjs.
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
        consoleErrors.push(message.params.entry.text);
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        consoleErrors.push(
          message.params.args.map((arg) => arg.value ?? arg.description).join(' '),
        );
      }
      if (message.method === 'Network.loadingFailed') {
        const { errorText, blockedReason } = message.params;
        failedRequests.push(`${errorText} ${blockedReason ?? ''}`.trim());
      }
    });

    await page('Page.enable');
    await page('Runtime.enable');
    await page('Log.enable');
    await page('Network.enable');
    await page('Emulation.setDeviceMetricsOverride', {
      width: opts.width,
      height: opts.height,
      deviceScaleFactor: opts.dpr,
      mobile: opts.width <= 500,
    });
    await page('Emulation.setEmulatedMedia', {
      media: 'screen',
      features: [
        { name: 'prefers-color-scheme', value: opts.scheme },
        {
          name: 'prefers-reduced-motion',
          value: opts.reducedMotion ? 'reduce' : 'no-preference',
        },
      ],
    });
    if (opts.noJs) await page('Emulation.setScriptExecutionDisabled', { value: true });
    if (opts.block.length > 0) await page('Network.setBlockedURLs', { urls: opts.block });

    const navigation = await page('Page.navigate', { url: opts.url });
    // A refused connection still fires a load event, for Chrome's own error page. Without
    // this, a server that is not running reads as a page with nothing wrong with it.
    if (navigation.errorText) {
      throw new Error(`could not load ${opts.url}: ${navigation.errorText}`);
    }
    for (let waited = 0; !loaded && waited < 15000; waited += 100) await sleep(100);
    if (!loaded) throw new Error('the page did not finish loading');
    // Fonts swap in after load, and the page's one animation runs for under a second.
    await sleep(1500);

    for (let i = 0; i < opts.tabs; i += 1) {
      for (const type of ['keyDown', 'keyUp']) {
        await page('Input.dispatchKeyEvent', {
          type,
          key: 'Tab',
          code: 'Tab',
          windowsVirtualKeyCode: 9,
          nativeVirtualKeyCode: 9,
        });
      }
      await sleep(80);
    }

    const evaluate = async (expression) => {
      const { result, exceptionDetails } = await page('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      return exceptionDetails ? `threw: ${exceptionDetails.text}` : result.value;
    };

    // With scripts disabled nothing can be evaluated; the screenshot is the evidence then.
    const measured = opts.noJs
      ? null
      : await evaluate(`({
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            pageHeight: document.documentElement.scrollHeight,
            focused: document.activeElement && document.activeElement !== document.body
              ? (document.activeElement.textContent || '').trim().slice(0, 60)
              : null,
            fontsLoaded: [...document.fonts]
              .filter((face) => face.status === 'loaded')
              .map((face) => face.family + ' ' + face.unicodeRange.slice(0, 13)),
          })`);
    if (measured) measured.overflowsSideways = overflows(measured.scrollWidth, opts.width);

    const report = {
      url: opts.url,
      viewport: `${opts.width}x${opts.height}`,
      scheme: opts.scheme,
      measured,
      evalResult: opts.eval && !opts.noJs ? await evaluate(opts.eval) : undefined,
      consoleErrors,
      failedRequests,
    };

    if (opts.out) {
      const shot = { format: 'png' };
      if (opts.selector) {
        const { root } = await page('DOM.getDocument', {});
        const { nodeId } = await page('DOM.querySelector', {
          nodeId: root.nodeId,
          selector: opts.selector,
        });
        if (!nodeId) throw new Error(`nothing matches ${opts.selector}`);
        const { model } = await page('DOM.getBoxModel', { nodeId });
        const [x, y] = model.border;
        shot.clip = { x, y, width: model.width, height: model.height, scale: 1 };
        shot.captureBeyondViewport = true;
      } else if (opts.full) {
        const { cssContentSize } = await page('Page.getLayoutMetrics');
        shot.clip = {
          x: 0,
          y: 0,
          width: cssContentSize.width,
          height: cssContentSize.height,
          scale: 1,
        };
        shot.captureBeyondViewport = true;
      }
      const { data } = await page('Page.captureScreenshot', shot);
      writeFileSync(opts.out, Buffer.from(data, 'base64'));
      report.screenshot = opts.out;
    }

    console.log(JSON.stringify(report, null, 2));
    socket.close();
  } finally {
    chrome.kill('SIGKILL');
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  }
}

// Only when run as a command: the tests import `overflows` from this file.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
