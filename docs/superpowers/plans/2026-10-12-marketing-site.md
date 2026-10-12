# Marketing Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One static page that shows what the released app does, says plainly what is unverified, and offers the Android and iPhone downloads from the latest GitHub Release.

**Architecture:** A new workspace package, `apps/web`, whose `public/` folder is the whole site: one HTML page, one stylesheet, two small JavaScript modules, two font files and three icons. Nothing is built; Vercel serves the folder as it is. The app's screens are rebuilt in HTML from the app's own colour tokens. Tests are static checks on those files, run by Node's built-in test runner, plus a browser check driven through headless Chrome.

**Tech Stack:** HTML, CSS, JavaScript modules (no framework, no build step, no dependencies). Node's built-ins for the tests (Node 20 or newer) and for the two developer scripts (the browser helper needs Node 22 or newer). Vercel for hosting.

**Spec:** `docs/superpowers/specs/2026-10-12-marketing-site-design.md`

## Global Constraints

- No framework, no build step, no dependencies. `apps/web/package.json` has no `dependencies` and no `devDependencies`.
- Everything the visitor loads lives in `apps/web/public/`.
- Light and dark follow the system setting through `prefers-color-scheme`. There is no toggle.
- A colour literal appears in the stylesheet only inside the two `:root` blocks. Values come from `apps/mobile/src/theme/palette.ts` and `theme.ts`.
- Text meets 4.5:1 in both themes. Filled buttons are `#5E7260` under white in light and `#89A889` under `#15171A` in dark. Sage text (`--accent-text`) sits only on `--bg` or `--surface`.
- No inline `style` attributes, no inline scripts, no event-handler attributes: the content-security policy forbids them.
- The only hosts an absolute URL may name are `github.com`, `api.github.com` and the site's own `synitheia.vercel.app`. No analytics, no cookies.
- Download links are exactly `https://github.com/tmonga2208/synitheia/releases/latest/download/Synitheia.apk` and `https://github.com/tmonga2208/synitheia/releases/latest/download/Synitheia-unsigned.ipa`.
- First load stays under 250 KB (256,000 bytes).
- Copy rules, from the spec. Must be stated: Android health is not yet verified on a physical phone; background sync is best-effort and not yet confirmed on a physical phone; the iPhone file cannot be installed by tapping it and Apple Health does not work with a free Apple ID; every mock is labelled "Sample data"; signing up creates an account on a server run by the app's developer; the page is not a legal privacy policy. Must not appear: user counts, ratings, testimonials, awards; statement inbox; interval reminders; sign-in with Google or Apple; the word "automatic"; "syncs in the background".
- Not touched: `apps/mobile`, `apps/api`, `packages/`, `.github/workflows/`.
- Run every command from the repository root unless a step says otherwise. The package's tests are `pnpm --filter @synitheia/web test`.
- Commit messages follow the repository's style (`feat(web): …`, `test(web): …`, `docs: …`) and end with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

The conditions most likely to hurt a visitor that the spec implies without spelling out. Each has its test or check in the task named.

1. **GitHub's API does not answer with a release** (rate limit, outage, blocked by the visitor's network). The buttons must still download and the version line must keep its plain text. Task 3 tests `describeRelease` with a rate-limit answer and with junk; Task 7 loads the page with the request blocked.
2. **JavaScript is off.** Every section must read and both downloads must work. Task 5's download test requires plain links with real addresses; Task 7 loads the page with scripts disabled.
3. **A narrow phone.** No sideways scrolling at 320px. Task 7 measures it at 320px and 390px.
4. **Dark mode.** Every text and ground pair is measured in both themes in Task 1; Task 7 looks at every section in dark.
5. **A build artifact is renamed in a workflow.** The buttons would 404 with nothing failing. Task 5's download test reads the file names out of the workflows and compares.
6. **A screen reader.** A mock must be announced once, as a described picture, never as sample data read out as fact. Task 6's test requires one labelled image per mock and nothing interactive inside it.

## File structure

```
apps/web/
  package.json            workspace package: name, the test and preview scripts, nothing else
  .gitignore              .vercel (the CLI's link to the project)
  vercel.json             serve public/, response headers
  scripts/
    preview.mjs           serve public/ locally with the headers from vercel.json
    shoot.mjs             load a page in headless Chrome: viewport, theme, screenshot, measurements
  public/
    index.html            the page: all copy, all eight mocks
    styles.css            tokens, both themes, layout, components, mocks
    release.js            pure functions: GitHub's answer -> the line under a button
    app.js                the only file that touches the network and the document
    fonts/                manrope-latin.woff2, manrope-latin-ext.woff2, OFL.txt
    favicon.png, apple-touch-icon.png, og.png
  test/
    helpers.mjs           paths, reading files, token parsing, contrast, visible text
    contrast.test.mjs     Task 1
    assets.test.mjs       Task 2
    release.test.mjs      Task 3
    headers.test.mjs      Task 4
    preview.test.mjs      Task 4
    structure.test.mjs    Task 5
    hosts.test.mjs        Task 5
    downloads.test.mjs    Task 5
    copy.test.mjs         Task 5
    mocks.test.mjs        Task 6
    weight.test.mjs       Task 7
```

`release.js` is separate from `app.js` so that everything with a decision in it can be tested without a browser. `scripts/` holds developer tools; nothing in it is served.

---

### Task 1: The workspace package, the colour tokens and the contrast test

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/.gitignore`
- Create: `apps/web/test/helpers.mjs`
- Create: `apps/web/test/contrast.test.mjs`
- Create: `apps/web/public/styles.css`
- Modify: `pnpm-lock.yaml` (by `pnpm install`)

**Interfaces:**
- Consumes: nothing.
- Produces, from `test/helpers.mjs`: `WEB`, `PUBLIC`, `REPO` (absolute paths to `apps/web`, `apps/web/public` and the repository root); `read(...pathParts): string`; `tokens(css: string, theme: 'light' | 'dark'): Record<string, string>` (custom property name, with its leading `--`, to resolved value); `rulesOf(css: string): string` (the stylesheet without comments and without its `:root` blocks); `contrast(hexA: string, hexB: string): number`; `textOf(html: string): string`.
- Produces, from `public/styles.css`: the custom properties `--bg`, `--surface`, `--surface-raised`, `--border`, `--text`, `--text-muted`, `--accent`, `--accent-deep`, `--accent-soft`, `--accent-wash`, `--accent-text`, `--button`, `--button-text`, `--focus`, `--flow-0` to `--flow-4`, `--habit-sage`, `--habit-sage-wash`, `--habit-indigo`, `--habit-indigo-wash`, `--habit-clay`, `--habit-clay-wash`, `--dot-habit`, `--dot-money`, `--dot-food`, `--dot-move`, `--dot-water`, `--shadow-card`, `--shadow-raised`, `--shadow-button`.

- [ ] **Step 1: Create the package**

`apps/web/package.json`:

```json
{
  "name": "@synitheia/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "The public page for Synítheia. Static files, no build step.",
  "scripts": {
    "test": "node --test test/*.test.mjs",
    "preview": "node scripts/preview.mjs"
  }
}
```

`apps/web/.gitignore`:

```
.vercel
```

- [ ] **Step 2: Let pnpm see it**

Run: `pnpm install`
Expected: it finishes without adding packages. `git diff --stat pnpm-lock.yaml` shows a few added lines: a new importer, `apps/web: {}`.

- [ ] **Step 3: Write the test helpers**

`apps/web/test/helpers.mjs`:

```js
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** apps/web, wherever the tests are run from. */
export const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC = join(WEB, 'public');
export const REPO = join(WEB, '..', '..');

export const read = (...parts) => readFileSync(join(...parts), 'utf8');

const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function declarations(block) {
  const found = {};
  for (const [, name, value] of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    found[name] = value.trim();
  }
  return found;
}

/**
 * The stylesheet's custom properties as one theme resolves them.
 *
 * Dark is the light set with the dark block laid over it, which is what a browser does, so
 * a token the dark block forgets is measured with its light value rather than skipped.
 */
export function tokens(css, theme) {
  const source = withoutComments(css);
  const light = source.match(/:root\s*\{([^}]*)\}/);
  const dark = source.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/);
  if (!light || !dark) {
    throw new Error('styles.css must declare :root tokens and a dark :root override');
  }

  const merged = { ...declarations(light[1]), ...(theme === 'dark' ? declarations(dark[1]) : {}) };

  const resolve = (value, depth = 0) => {
    const alias = /^var\((--[\w-]+)\)$/.exec(value);
    if (!alias) return value;
    if (depth > 8 || !(alias[1] in merged)) throw new Error(`cannot resolve ${value}`);
    return resolve(merged[alias[1]], depth + 1);
  };

  return Object.fromEntries(Object.entries(merged).map(([name, value]) => [name, resolve(value)]));
}

/** The stylesheet with its comments and its token blocks removed: everything that USES a token. */
export function rulesOf(css) {
  return withoutComments(css).replace(/:root\s*\{[^}]*\}/g, '');
}

const channel = (value) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

function luminance(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`not a six-digit hex colour: ${hex}`);
  const n = parseInt(match[1], 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

/** WCAG 2 contrast ratio between two six-digit hex colours. */
export function contrast(a, b) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * A page's visible words: tags dropped, curly quotes straightened, whitespace collapsed.
 * Attributes go with the tags, so a claim cannot be satisfied from an aria-label.
 */
export function textOf(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
```

- [ ] **Step 4: Write the failing test**

`apps/web/test/contrast.test.mjs`:

```js
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
```

- [ ] **Step 5: Run it and watch it fail**

Run: `pnpm --filter @synitheia/web test`
Expected: FAIL. `contrast.test.mjs` cannot be loaded: `ENOENT: no such file or directory, open '…/apps/web/public/styles.css'`.

- [ ] **Step 6: Write the tokens**

`apps/web/public/styles.css`:

```css
/*
 * Synítheia's public page.
 *
 * The colours are the app's own (apps/mobile/src/theme/palette.ts), written down once, here.
 * Nothing below the two :root blocks may contain a colour literal, and a test enforces it,
 * for the same reason the app forbids importing its palette outside its theme.
 */
:root {
  color-scheme: light dark;

  --bg: #FBF9F6;
  --surface: #FBF9F6;
  --surface-raised: #EFECEA;
  --border: #DBDAD7;

  --text: #2D2D2D;
  --text-muted: #6B6B68;

  /* Sage as decoration: the ring, the mark, borders. 3.18:1 on bone, so never words. */
  --accent: #7D927D;
  --accent-deep: #67806A;
  --accent-soft: #A8B8A8;
  --accent-wash: #E8EDE8;
  /* Sage that can carry words: the tone the app uses for a habit's metadata line. */
  --accent-text: #5E7260;

  /* The app's own button is white on --accent, 3.34:1. Here it has to clear 4.5:1. */
  --button: #5E7260;
  --button-text: #FFFFFF;

  --focus: #2D2D2D;

  /* The History ramp: sage over bone at the app's alphas, flattened so it can be measured. */
  --flow-0: #EFECEA;
  --flow-1: #DDE0D9;
  --flow-2: #C1CABE;
  --flow-3: #9EAD9C;
  --flow-4: #5E7260;

  /* One accent per habit, as in the app. */
  --habit-sage: #7D927D;
  --habit-sage-wash: #E8EDE8;
  --habit-indigo: #7D8FA9;
  --habit-indigo-wash: #E5E9EF;
  --habit-clay: #C08A7D;
  --habit-clay-wash: #F4E9E6;

  /* What kind of thing a timeline row is. Decoration: the words carry the meaning. */
  --dot-habit: #7D927D;
  --dot-money: #C08A7D;
  --dot-food: #B0917D;
  --dot-move: #7D8FA9;
  --dot-water: #7DA095;

  --shadow-card: 0 6px 30px rgba(90, 90, 80, 0.06);
  --shadow-raised: 0 10px 40px rgba(90, 90, 80, 0.1);
  --shadow-button: 0 8px 32px rgba(74, 90, 74, 0.18);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #15171A;
    --surface: #1A1D21;
    --surface-raised: #20242A;
    --border: #2C3138;

    --text: #E6E9EC;
    --text-muted: #8D949C;

    --accent: #89A889;
    --accent-deep: #7A9A7A;
    --accent-soft: #5E7460;
    --accent-wash: #1F2620;
    --accent-text: #89A889;

    /* Lifted sage cannot hold white (2.62:1), so the label inverts, as it does in the app. */
    --button: #89A889;
    --button-text: #15171A;

    --focus: #E6E9EC;

    --flow-0: #20242A;
    --flow-1: #2E3634;
    --flow-2: #404C44;
    --flow-3: #546557;
    --flow-4: #89A889;

    --habit-sage: #597159;
    --habit-sage-wash: #252C2B;
    --habit-indigo: #536C90;
    --habit-indigo-wash: #242B35;
    --habit-clay: #A6533F;
    --habit-clay-wash: #332726;

    --dot-habit: #779377;
    --dot-money: #C57865;
    --dot-food: #B08366;
    --dot-move: #768EB0;
    --dot-water: #639686;

    /* A soft shadow over charcoal renders as nothing; depth comes from the surface steps. */
    --shadow-card: none;
    --shadow-raised: none;
    --shadow-button: none;
  }
}

/* ── Base ─────────────────────────────────────────────────────────────────────────────── */

*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
}
```

- [ ] **Step 7: Run it and watch it pass**

Run: `pnpm --filter @synitheia/web test`
Expected: PASS. 39 tests: the helper check, 18 pairs in each theme, and the two rules about how colour is written.

- [ ] **Step 8: Commit**

```bash
git add apps/web/package.json apps/web/.gitignore apps/web/test/helpers.mjs apps/web/test/contrast.test.mjs apps/web/public/styles.css pnpm-lock.yaml
git commit -m "feat(web): the site's package, its colour tokens, and a contrast test that holds them

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Fonts and icons

**Files:**
- Create: `apps/web/public/fonts/manrope-latin.woff2`, `apps/web/public/fonts/manrope-latin-ext.woff2`, `apps/web/public/fonts/OFL.txt` (downloaded)
- Create: `apps/web/public/favicon.png`, `apps/web/public/apple-touch-icon.png`, `apps/web/public/og.png` (cut from `apps/mobile/assets/icon.png`)
- Create: `apps/web/test/assets.test.mjs`
- Modify: `apps/web/public/styles.css` (two `@font-face` rules and the font family)

**Interfaces:**
- Consumes: `PUBLIC`, `read` from `test/helpers.mjs`.
- Produces: the font family name `"Manrope"` (weights 400 to 700), and the files `fonts/manrope-latin.woff2`, `fonts/manrope-latin-ext.woff2`, `fonts/OFL.txt`, `favicon.png` (48×48), `apple-touch-icon.png` (180×180), `og.png` (1200×630), all relative to `public/`.

The app ships Manrope as four TrueType files of 96 KB each, which would be more than the page's whole budget. Google Fonts publishes the same family as one variable WOFF2 file per character range. Two ranges are needed: `latin` for everything, and `latin-ext` because the sample screens use the rupee sign (U+20B9). The files are downloaded once and committed, so the published page asks no third party for a font. Manrope is licensed under the SIL Open Font License 1.1, which allows this as long as the licence travels with the files.

- [ ] **Step 1: Write the failing test**

`apps/web/test/assets.test.mjs`:

```js
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @synitheia/web test`
Expected: FAIL. The seven tests in `assets.test.mjs` fail: the font and icon files do not exist (`ENOENT`), and the stylesheet has no `url(` yet (`expected exactly the two font files`). `contrast.test.mjs` still passes.

- [ ] **Step 3: Download the fonts and the licence**

```bash
mkdir -p apps/web/public/fonts
curl -sS --fail -o apps/web/public/fonts/manrope-latin.woff2 "https://fonts.gstatic.com/s/manrope/v20/xn7gYHE41ni1AdIRggexSvfedN4.woff2"
curl -sS --fail -o apps/web/public/fonts/manrope-latin-ext.woff2 "https://fonts.gstatic.com/s/manrope/v20/xn7gYHE41ni1AdIRggmxSvfedN62Zw.woff2"
curl -sS --fail -o apps/web/public/fonts/OFL.txt "https://raw.githubusercontent.com/google/fonts/main/ofl/manrope/OFL.txt"
ls -l apps/web/public/fonts
```

Expected: three files of 24,576, 15,240 and 4,387 bytes.

If a font address answers 404, Google has published a newer version of the family. Fetch `https://fonts.googleapis.com/css2?family=Manrope:wght@400..700&display=swap` with a desktop Chrome user-agent, take the addresses under `/* latin */` and `/* latin-ext */`, download those, and replace the two digests in the test with `shasum -a 256` of the new files. Record that as a ruling.

- [ ] **Step 4: Cut the icons**

`sips` is part of macOS. The app icon's background is exactly `#FBF9F6`, so padding with that colour leaves no seam.

```bash
sips -z 48 48 apps/mobile/assets/icon.png --out apps/web/public/favicon.png
sips -z 180 180 apps/mobile/assets/icon.png --out apps/web/public/apple-touch-icon.png
sips -z 630 630 apps/mobile/assets/icon.png --out apps/web/public/og.png
sips --padToHeightWidth 630 1200 --padColor FBF9F6 apps/web/public/og.png --out apps/web/public/og.png
ls -l apps/web/public/*.png
```

Expected: `favicon.png` about 2 KB, `apple-touch-icon.png` about 11 KB, `og.png` about 54 KB.

- [ ] **Step 5: Declare the font**

In `apps/web/public/styles.css`, insert this block between the closing brace of the dark `@media` block and the `/* ── Base` comment:

```css
/*
 * Manrope, from this site's own folder. It comes as two files because that is how the family
 * is cut: a browser fetches the second only when the page uses a character in its range, and
 * the rupee sign in the sample screens is one.
 */
@font-face {
  font-family: "Manrope";
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url("fonts/manrope-latin-ext.woff2") format("woff2");
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304,
    U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4,
    U+2113, U+2C60-2C7F, U+A720-A7FF;
}

@font-face {
  font-family: "Manrope";
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url("fonts/manrope-latin.woff2") format("woff2");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304,
    U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
```

Then replace the `body` rule at the end of the file with:

```css
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: "Manrope", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 1.0625rem;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
```

The `latin` range has no right-pointing arrow (U+2192) and Manrope has no check mark (U+2713), so the page never uses either as text. Arrows and ticks are drawn as SVG.

- [ ] **Step 6: Run it and watch it pass**

Run: `pnpm --filter @synitheia/web test`
Expected: PASS. 46 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/web/public/fonts apps/web/public/favicon.png apps/web/public/apple-touch-icon.png apps/web/public/og.png apps/web/public/styles.css apps/web/test/assets.test.mjs
git commit -m "feat(web): Manrope served from the site itself, and icons cut from the app's

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Release details

**Files:**
- Create: `apps/web/public/release.js`
- Create: `apps/web/public/app.js`
- Create: `apps/web/test/release.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, from `public/release.js`:
  - `REPO: 'tmonga2208/synitheia'`
  - `LATEST_RELEASE_URL: string`
  - `ASSET_NAMES: { apk: 'Synitheia.apk', ipa: 'Synitheia-unsigned.ipa' }`
  - `formatBytes(bytes: unknown): string | null`
  - `describeRelease(payload: unknown, options?: { locale?: string, timeZone?: string }): { version: string, date: string | null, sizes: { apk: string | null, ipa: string | null } } | null`
  - `releaseLine(release: ReturnType<typeof describeRelease>, kind: 'apk' | 'ipa' | 'version'): string | null`
- Produces, from `public/app.js`: on load, every element with a `data-release` attribute (`"apk"`, `"ipa"` or `"version"`) has its text replaced by `releaseLine(...)`. If anything fails, the text already in the page stays.

- [ ] **Step 1: Write the failing test**

`apps/web/test/release.test.mjs`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ASSET_NAMES,
  LATEST_RELEASE_URL,
  describeRelease,
  formatBytes,
  releaseLine,
} from '../public/release.js';

// What GitHub answered for v0.2.0, cut down to the fields the page reads.
const LATEST = {
  tag_name: 'v0.2.0',
  published_at: '2026-10-11T18:59:38Z',
  assets: [
    { name: 'Synitheia-unsigned.ipa', size: 10253544 },
    { name: 'Synitheia.apk', size: 90762436 },
  ],
};

// Pinned, because the default is the machine's own locale and time zone.
const pinned = { locale: 'en-GB', timeZone: 'UTC' };

test('the request goes to the latest release of this repository', () => {
  assert.equal(
    LATEST_RELEASE_URL,
    'https://api.github.com/repos/tmonga2208/synitheia/releases/latest',
  );
  assert.deepEqual(ASSET_NAMES, { apk: 'Synitheia.apk', ipa: 'Synitheia-unsigned.ipa' });
});

test('a real answer becomes a version, a date and two sizes', () => {
  assert.deepEqual(describeRelease(LATEST, pinned), {
    version: 'v0.2.0',
    date: '11 Oct 2026',
    sizes: { apk: '86.6 MB', ipa: '9.8 MB' },
  });
});

test('the date is the visitor’s day, not Greenwich’s', () => {
  const inIndia = describeRelease(LATEST, { locale: 'en-GB', timeZone: 'Asia/Kolkata' });
  assert.equal(inIndia.date, '12 Oct 2026');
});

test('a rate-limit answer is not a release', () => {
  const limited = { message: 'API rate limit exceeded for 203.0.113.7.' };
  assert.equal(describeRelease(limited, pinned), null);
});

test('nothing that is not a release object is a release', () => {
  for (const junk of [null, undefined, '', 'v0.2.0', 42, [], { tag_name: '' }, { tag_name: 7 }]) {
    assert.equal(describeRelease(junk, pinned), null, JSON.stringify(junk));
  }
});

test('a release with one file missing still describes the other', () => {
  const onlyApk = { ...LATEST, assets: [{ name: 'Synitheia.apk', size: 90762436 }] };
  const release = describeRelease(onlyApk, pinned);
  assert.deepEqual(release.sizes, { apk: '86.6 MB', ipa: null });
  assert.equal(releaseLine(release, 'ipa'), 'v0.2.0 · 11 Oct 2026');
});

test('a release with no assets list at all is still a version and a date', () => {
  const { assets: _dropped, ...bare } = LATEST;
  assert.equal(releaseLine(describeRelease(bare, pinned), 'apk'), 'v0.2.0 · 11 Oct 2026');
});

test('an unreadable date is left out rather than shown as nonsense', () => {
  const release = describeRelease({ ...LATEST, published_at: 'soon' }, pinned);
  assert.equal(release.date, null);
  assert.equal(releaseLine(release, 'apk'), 'v0.2.0 · 86.6 MB');
});

test('sizes read the way GitHub shows them', () => {
  assert.equal(formatBytes(90762436), '86.6 MB');
  assert.equal(formatBytes(10253544), '9.8 MB');
  assert.equal(formatBytes(51200), '50 KB');
  for (const junk of [0, -5, NaN, Infinity, '12', null, undefined]) {
    assert.equal(formatBytes(junk), null, String(junk));
  }
});

test('the line under each button', () => {
  const release = describeRelease(LATEST, pinned);
  assert.equal(releaseLine(release, 'apk'), 'v0.2.0 · 11 Oct 2026 · 86.6 MB');
  assert.equal(releaseLine(release, 'ipa'), 'v0.2.0 · 11 Oct 2026 · 9.8 MB');
  assert.equal(releaseLine(release, 'version'), 'v0.2.0 · 11 Oct 2026');
  assert.equal(releaseLine(null, 'apk'), null);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @synitheia/web test`
Expected: FAIL. `release.test.mjs` cannot be loaded: `Cannot find module '…/apps/web/public/release.js'`.

- [ ] **Step 3: Write the pure half**

`apps/web/public/release.js`:

```js
/**
 * The latest release, described for a person.
 *
 * Pure on purpose: everything in this file can be tested without a browser or a network.
 * app.js is the only file that touches either.
 */

export const REPO = 'tmonga2208/synitheia';
export const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

/** The two files the release workflow attaches. A test holds these to the workflows. */
export const ASSET_NAMES = { apk: 'Synitheia.apk', ipa: 'Synitheia-unsigned.ipa' };

/** "86.6 MB". Binary megabytes, because that is what GitHub's own release page shows. */
export function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return null;

  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 0.1) return `${megabytes.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * What GitHub said about the latest release, or null if it said anything else.
 *
 * GitHub answers a rate-limited or failed request with a JSON object too, just not this one,
 * so the shape is checked rather than trusted.
 */
export function describeRelease(payload, { locale, timeZone } = {}) {
  if (payload === null || typeof payload !== 'object') return null;
  if (typeof payload.tag_name !== 'string' || payload.tag_name.trim() === '') return null;

  const published =
    typeof payload.published_at === 'string' ? new Date(payload.published_at) : null;
  const date =
    published && !Number.isNaN(published.getTime())
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(published)
      : null;

  const assets = Array.isArray(payload.assets) ? payload.assets : [];
  const sizeOf = (name) => formatBytes(assets.find((asset) => asset?.name === name)?.size);

  return {
    version: payload.tag_name.trim(),
    date,
    sizes: { apk: sizeOf(ASSET_NAMES.apk), ipa: sizeOf(ASSET_NAMES.ipa) },
  };
}

/** One line for under a button: "v0.2.0 · 11 Oct 2026 · 86.6 MB". Missing parts are left out. */
export function releaseLine(release, kind) {
  if (!release) return null;

  const size = kind === 'apk' || kind === 'ipa' ? release.sizes[kind] : null;
  return [release.version, release.date, size].filter(Boolean).join(' · ');
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @synitheia/web test`
Expected: PASS. 56 tests.

- [ ] **Step 5: Write the half that touches the page**

`apps/web/public/app.js`:

```js
/**
 * Fill in the version, the date and the file sizes from the latest GitHub release.
 *
 * This is the page's only script and its only request to another host. Nothing depends on
 * it: the download buttons are plain links, and every place this writes to already holds
 * text that is true without it. So every failure here ends the same way, by doing nothing.
 */
import { LATEST_RELEASE_URL, describeRelease, releaseLine } from './release.js';

async function showLatestRelease() {
  const places = document.querySelectorAll('[data-release]');
  if (places.length === 0) return;

  try {
    const response = await fetch(LATEST_RELEASE_URL, {
      headers: { accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return;

    const release = describeRelease(await response.json());
    for (const place of places) {
      const line = releaseLine(release, place.dataset.release);
      // textContent, never innerHTML: the version string comes from the network.
      if (line) place.textContent = line;
    }
  } catch {
    // Offline, blocked, rate-limited or not JSON. The text already on the page stands.
  }
}

showLatestRelease();
```

`app.js` has no unit test: it is a dozen lines of wiring around a document and a network. Task 7 exercises it in a browser, with the request allowed and with it blocked.

- [ ] **Step 6: Check both files parse**

Run: `node --check apps/web/public/app.js && node --check apps/web/public/release.js && echo parsed`
Expected: `parsed`

- [ ] **Step 7: Commit**

```bash
git add apps/web/public/release.js apps/web/public/app.js apps/web/test/release.test.mjs
git commit -m "feat(web): the version, date and size under each download, from GitHub's latest release

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Response headers, a local preview that sends them, and a way to look at the page

**Files:**
- Create: `apps/web/vercel.json`
- Create: `apps/web/scripts/preview.mjs`
- Create: `apps/web/scripts/shoot.mjs`
- Create: `apps/web/test/headers.test.mjs`
- Create: `apps/web/test/preview.test.mjs`

**Interfaces:**
- Consumes: `WEB`, `read` from `test/helpers.mjs`.
- Produces, from `scripts/preview.mjs`: `headersFor(pathname: string, config: object): Record<string, string>` and `createPreviewServer(options?: { root?: string, config?: object }): http.Server`. Run directly, it serves `public/` on `http://127.0.0.1:4173/` (or `PORT`).
- Produces, from `scripts/shoot.mjs`: a command line, `node apps/web/scripts/shoot.mjs --url <url> [--out <png>] [--width n] [--height n] [--scheme light|dark] [--reduced-motion] [--no-js] [--block <url-pattern>]… [--selector <css>] [--full] [--dpr n] [--tabs n] [--eval <js>]`, which prints a JSON report with `measured.overflowsSideways`, `measured.fontsLoaded`, `measured.focused`, `evalResult`, `consoleErrors`, `failedRequests`.

Two developer tools, neither of them served. The preview exists because the content-security policy is the thing most likely to break the page silently, and a plain file server would never send it. The second exists because this page has to be right in two themes and at two widths, and that cannot be checked by reading the stylesheet.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/headers.test.mjs`:

```js
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
```

`apps/web/test/preview.test.mjs`:

```js
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createPreviewServer, headersFor } from '../scripts/preview.mjs';

// A folder and a config of the test's own, so this says nothing about the real page.
const config = {
  headers: [
    { source: '/(.*)', headers: [{ key: 'X-Everywhere', value: 'yes' }] },
    {
      source: '/fonts/(.*)',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    },
  ],
};

let outside;
let server;
let origin;

before(async () => {
  outside = mkdtempSync(join(tmpdir(), 'preview-test-'));
  const root = join(outside, 'public');
  mkdirSync(join(root, 'fonts'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>home</title>');
  writeFileSync(join(root, 'fonts', 'a.woff2'), 'font');
  writeFileSync(join(outside, 'secret.txt'), 'not for serving');

  server = createPreviewServer({ root, config });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  rmSync(outside, { recursive: true, force: true });
});

test('headersFor applies every rule whose pattern matches the path', () => {
  assert.deepEqual(headersFor('/index.html', config), { 'X-Everywhere': 'yes' });
  assert.deepEqual(headersFor('/fonts/a.woff2', config), {
    'X-Everywhere': 'yes',
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
  assert.deepEqual(headersFor('/anything', {}), {});
});

test('the home page is served for /, with the headers meant for every path', async () => {
  const response = await fetch(`${origin}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html/);
  assert.equal(response.headers.get('x-everywhere'), 'yes');
  assert.equal(response.headers.get('cache-control'), null);
  assert.match(await response.text(), /<title>home<\/title>/);
});

test('a font gets both rules and its own content type', async () => {
  const response = await fetch(`${origin}/fonts/a.woff2`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'font/woff2');
  assert.equal(response.headers.get('x-everywhere'), 'yes');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
});

test('nothing outside the folder is served, however the path is spelled', async () => {
  const attempts = [
    '/../secret.txt',
    '/..%2Fsecret.txt',
    '/%2e%2e/secret.txt',
    '/fonts/..%2F..%2Fsecret.txt',
    '/%E0%A4%A',
  ];
  for (const path of attempts) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(await response.text(), /not for serving/, path);
  }
});

test('a missing file and a folder are both a 404', async () => {
  for (const path of ['/nope.html', '/fonts', '/fonts/']) {
    assert.equal((await fetch(`${origin}${path}`)).status, 404, path);
  }
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @synitheia/web test`
Expected: FAIL. `headers.test.mjs` cannot read `vercel.json` (`ENOENT`), and `preview.test.mjs` cannot find `…/apps/web/scripts/preview.mjs`. The 56 earlier tests still pass.

- [ ] **Step 3: Write the Vercel configuration**

`apps/web/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": null,
  "outputDirectory": "public",
  "cleanUrls": true,
  "trailingSlash": false,
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src https://api.github.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        {
          "key": "Permissions-Policy",
          "value": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()"
        }
      ]
    },
    {
      "source": "/fonts/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    }
  ]
}
```

There is deliberately no `buildCommand` or `installCommand`. The package has no dependencies and no `build` script, so Vercel's defaults install nothing, build nothing and serve `public/`.

- [ ] **Step 4: Write the preview server**

`apps/web/scripts/preview.mjs`:

```js
#!/usr/bin/env node
/**
 * Serve public/ the way production will: the same files, with the response headers from
 * vercel.json.
 *
 * It exists for the content-security policy. A plain file server sends no policy, so a page
 * that would be broken in production by an inline style or a forgotten host looks fine
 * locally. With this, the browser enforces the real policy before anything is deployed.
 */
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

/**
 * The headers vercel.json gives a path.
 *
 * Vercel's `source` is a path pattern. The two this site uses, "/(.*)" and "/fonts/(.*)",
 * mean the same thing read as regular expressions, which is all this needs to understand.
 */
export function headersFor(pathname, config) {
  const headers = {};
  for (const rule of config.headers ?? []) {
    if (new RegExp(`^${rule.source}$`).test(pathname)) {
      for (const { key, value } of rule.headers) headers[key] = value;
    }
  }
  return headers;
}

export function createPreviewServer({
  root = join(WEB, 'public'),
  config = JSON.parse(readFileSync(join(WEB, 'vercel.json'), 'utf8')),
} = {}) {
  return createServer(async (request, response) => {
    const { pathname } = new URL(request.url, 'http://localhost');
    const headers = headersFor(pathname, config);
    const notFound = () => response.writeHead(404, headers).end('Not found');

    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return notFound();
    }

    // An encoded "../" survives URL parsing and only becomes a parent folder here, so the
    // check has to come after decoding and normalising, on the final path.
    const file = normalize(join(root, decoded.endsWith('/') ? `${decoded}index.html` : decoded));
    if (!file.startsWith(root + sep)) return notFound();

    try {
      const body = await readFile(file);
      response.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        ...headers,
      });
      response.end(body);
    } catch {
      notFound();
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4173);
  // Loopback only: this is a developer's preview, not something to offer the local network.
  createPreviewServer().listen(port, '127.0.0.1', () => {
    console.log(`http://127.0.0.1:${port}/`);
  });
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pnpm --filter @synitheia/web test`
Expected: PASS. 65 tests.

- [ ] **Step 6: Write the browser helper**

`apps/web/scripts/shoot.mjs`:

```js
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

const CHROME =
  process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

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

    await page('Page.navigate', { url: opts.url });
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

    const report = {
      url: opts.url,
      viewport: `${opts.width}x${opts.height}`,
      scheme: opts.scheme,
      // With scripts disabled nothing can be evaluated; the screenshot is the evidence then.
      measured: opts.noJs
        ? null
        : await evaluate(`({
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            overflowsSideways: document.documentElement.scrollWidth > window.innerWidth,
            pageHeight: document.documentElement.scrollHeight,
            focused: document.activeElement && document.activeElement !== document.body
              ? (document.activeElement.textContent || '').trim().slice(0, 60)
              : null,
            fontsLoaded: [...document.fonts]
              .filter((face) => face.status === 'loaded')
              .map((face) => face.family + ' ' + face.unicodeRange.slice(0, 13)),
          })`),
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

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
```

`shoot.mjs` has no unit test. It drives a real browser, so the proof that it works is that the checks in Tasks 5 to 7 run through it.

- [ ] **Step 7: Check the helper parses and refuses bad input**

Run: `node --check apps/web/scripts/shoot.mjs && node apps/web/scripts/shoot.mjs; echo "exit $?"`
Expected: `--url is required`, then `exit 1`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/vercel.json apps/web/scripts apps/web/test/headers.test.mjs apps/web/test/preview.test.mjs
git commit -m "feat(web): response headers, a preview that sends them, and a headless-browser check

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The page

**Files:**
- Create: `apps/web/public/index.html`
- Create: `apps/web/test/structure.test.mjs`, `apps/web/test/hosts.test.mjs`, `apps/web/test/downloads.test.mjs`, `apps/web/test/copy.test.mjs`
- Modify: `apps/web/public/styles.css` (append the page's layout and components)

**Interfaces:**
- Consumes: `PUBLIC`, `REPO`, `read`, `textOf` from `test/helpers.mjs`; `ASSET_NAMES` from `public/release.js`; every custom property from Task 1; the `"Manrope"` family and the icon files from Task 2; `app.js` from Task 3; `scripts/preview.mjs` and `scripts/shoot.mjs` from Task 4.
- Produces: `public/index.html` with nine sections whose ids are `top`, `timeline`, `trackers`, `suggestions`, `insights`, `history`, `your-data`, `limits`, `download`; the ids `download-android` and `download-iphone`; three elements carrying `data-release` (`version`, `apk`, `ipa`); and eight placeholder comments that Task 6 replaces, exactly `<!-- mock: today -->`, `<!-- mock: your-day -->`, `<!-- mock: expense-draft -->`, `<!-- mock: habits -->`, `<!-- mock: suggestion -->`, `<!-- mock: insight -->`, `<!-- mock: month -->`, `<!-- mock: source -->`.
- Produces, in `styles.css`, the classes Task 6 builds on: `.wrap`, `.split`, `.split-text`, `.grid`, `.card`, `.stack`, `.mark-outer`, `.mark-middle`, `.mark-inner`.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/structure.test.mjs`:

```js
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
```

`apps/web/test/hosts.test.mjs`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PUBLIC, read } from './helpers.mjs';

// The page and everything it loads. The licence text in fonts/ names its own addresses and
// is not something a visitor's browser runs.
const SERVED = ['index.html', 'styles.css', 'app.js', 'release.js'];
const ALLOWED = new Set(['github.com', 'api.github.com', 'synitheia.vercel.app']);

test('every absolute address is on GitHub or on this site', () => {
  for (const file of SERVED) {
    const addresses = read(PUBLIC, file).match(/https?:\/\/[^\s"'<>)`]+/g) ?? [];
    for (const address of addresses) {
      assert.ok(address.startsWith('https://'), `${file}: ${address} is not https`);
      assert.ok(ALLOWED.has(new URL(address).hostname), `${file}: ${address}`);
    }
  }
});

test('nothing is loaded protocol-relative', () => {
  for (const file of SERVED) {
    assert.doesNotMatch(read(PUBLIC, file), /(?:src|href)=["']\/\/|url\(\s*["']?\/\//, file);
  }
});
```

`apps/web/test/downloads.test.mjs`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ASSET_NAMES } from '../public/release.js';
import { PUBLIC, REPO, read } from './helpers.mjs';

const html = read(PUBLIC, 'index.html');
const PREFIX = 'https://github.com/tmonga2208/synitheia/releases/latest/download/';

/**
 * The file a build workflow uploads: the last segment of the `path:` line that ends in this
 * extension. If someone renames the artifact there, the button here must fail a test rather
 * than quietly point at nothing.
 */
function builtFile(workflow, extension) {
  const yaml = read(REPO, '.github', 'workflows', workflow);
  const match = new RegExp(`^\\s*path:.*/([^/\\s]+\\.${extension})\\s*$`, 'm').exec(yaml);
  assert.ok(match, `${workflow} uploads no .${extension}`);
  return match[1];
}

const built = [builtFile('android.yml', 'apk'), builtFile('ios.yml', 'ipa')].sort();

test('the page offers exactly the two files the workflows build', () => {
  const offered = [...html.matchAll(/href="([^"]*\/releases\/latest\/download\/[^"]*)"/g)].map(
    ([, href]) => href,
  );
  assert.ok(offered.length >= 2);
  for (const href of offered) assert.ok(href.startsWith(PREFIX), href);
  assert.deepEqual([...new Set(offered.map((href) => href.slice(PREFIX.length)))].sort(), built);
});

test('both downloads are plain links, so they work with scripts off', () => {
  for (const name of built) {
    assert.ok(html.includes(`<a class="button" href="${PREFIX}${name}">`), name);
  }
});

test('release.js names the same two files', () => {
  assert.deepEqual(Object.values(ASSET_NAMES).sort(), built);
});
```

`apps/web/test/copy.test.mjs`:

```js
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
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @synitheia/web test`
Expected: FAIL. The four new files cannot be loaded: `ENOENT: no such file or directory, open '…/apps/web/public/index.html'`. The 65 earlier tests still pass.

- [ ] **Step 3: Write the page**

The three paths of the mark are the app icon's arcs measured off `apps/mobile/assets/icon.png` (1024 by 1024, centre 512,512, radii 306, 206 and 108, stroke 72). The copy is final; every claim in it was checked against the code named in the spec.

`apps/web/public/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Synítheia — your day, understood</title>
  <meta name="description" content="One app for habits, spending, meals, water and health. It notices patterns, shows its evidence and asks before it records anything. Free for Android and iPhone.">
  <meta name="theme-color" content="#FBF9F6" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#15171A" media="(prefers-color-scheme: dark)">
  <link rel="canonical" href="https://synitheia.vercel.app/">
  <link rel="icon" type="image/png" sizes="48x48" href="favicon.png">
  <link rel="apple-touch-icon" href="apple-touch-icon.png">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://synitheia.vercel.app/">
  <meta property="og:title" content="Synítheia — your day, understood">
  <meta property="og:description" content="One app for habits, spending, meals, water and health. It notices patterns and asks. It never assumes.">
  <meta property="og:image" content="https://synitheia.vercel.app/og.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="preload" href="fonts/manrope-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="styles.css">
  <script type="module" src="app.js"></script>
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>

  <header class="site-header">
    <div class="wrap">
      <a class="brand" href="#top">
        <svg class="mark" viewBox="0 0 1024 1024" aria-hidden="true">
          <path class="mark-outer" d="M338.7 764.2A306 306 0 1 1 763.9 685.8"/>
          <path class="mark-middle" d="M495.1 717.3A206 206 0 1 1 710.1 455.6"/>
          <path class="mark-inner" d="M539.4 407.5A108 108 0 1 0 565.8 605.6"/>
        </svg>
        <span>Synítheia</span>
      </a>
      <nav class="site-nav" aria-label="Sections">
        <a href="#timeline">Features</a>
        <a href="#your-data">Your data</a>
        <a class="button small" href="#download">Download</a>
      </nav>
    </div>
  </header>

  <main id="main">
    <section class="hero" id="top" aria-labelledby="hero-title">
      <svg class="hero-mark" viewBox="0 0 1024 1024" aria-hidden="true">
        <path class="mark-outer" d="M338.7 764.2A306 306 0 1 1 763.9 685.8"/>
        <path class="mark-middle" d="M495.1 717.3A206 206 0 1 1 710.1 455.6"/>
        <path class="mark-inner" d="M539.4 407.5A108 108 0 1 0 565.8 605.6"/>
      </svg>
      <div class="wrap split">
        <div class="split-text">
          <p class="overline">For Android and iPhone</p>
          <h1 id="hero-title">Your day, understood</h1>
          <p class="lead">Habits, spending, meals and water — tracked together, so Synítheia can tell you what they mean as a whole. It notices patterns and asks. It never assumes.</p>
          <div class="actions">
            <a class="button" href="https://github.com/tmonga2208/synitheia/releases/latest/download/Synitheia.apk">Download for Android</a>
            <a class="button secondary" href="#download-iphone">Get it on iPhone</a>
          </div>
          <p class="release-note"><span data-release="version">Latest release</span> · Free · Android 8.0 or newer · iPhone needs sideloading</p>
        </div>
        <!-- mock: today -->
      </div>
    </section>

    <section id="timeline" aria-labelledby="timeline-title">
      <div class="wrap split flip">
        <div class="split-text stack">
          <p class="overline">Today</p>
          <h2 id="timeline-title">One timeline, not seven trackers</h2>
          <p>Expenses, habits, food, water, steps, workouts, sleep, calendar events and the weather land in one feed, in the order they happened. You open one screen to see your day, not a tab for each thing you track.</p>
          <p>The ring at the top is one number for the whole day, across everything you track.</p>
        </div>
        <!-- mock: your-day -->
      </div>
    </section>

    <section id="trackers" aria-labelledby="trackers-title">
      <div class="wrap">
        <div class="section-head stack">
          <p class="overline">Trackers</p>
          <h2 id="trackers-title">Everything you track, in one place</h2>
          <p class="lead">Six trackers share one account, one timeline and one set of targets.</p>
        </div>
        <ul class="grid two three" role="list">
          <li class="card stack">
            <h3>Expenses</h3>
            <p>Add one in a few taps, or bring one in: share a payment screenshot or a receipt photo, paste the SMS, or upload a CSV or a bank-statement PDF, even a password-protected one. Split a bill with your contacts and see who owes you. Subscriptions post themselves on the day they are due, and a monthly budget keeps count.</p>
          </li>
          <li class="card stack">
            <h3>Habits</h3>
            <p>Tick it, count it, time it or walk it, daily or weekly. Streaks forgive one missed day. Step habits complete themselves from your health data, and each habit can have its own reminder.</p>
          </li>
          <li class="card stack">
            <h3>Nutrition</h3>
            <p>Log a meal with its calories and macros, or start from a photo and confirm what it found. The day’s totals sit against a calorie target that is suggested from your body details and applied only if you choose it.</p>
          </li>
          <li class="card stack">
            <h3>Water</h3>
            <p>One tap adds a glass, counted against a daily target you set.</p>
          </li>
          <li class="card stack">
            <h3>Body</h3>
            <p>Height, weight, sex and date of birth come from your phone’s health store where it holds them, or you type them in. From those it works out BMI and how much energy you use.</p>
          </li>
          <li class="card stack">
            <h3>Reminders and targets</h3>
            <p>Reminders are scheduled on your phone, daily or on the weekdays you pick. One screen holds your water, calorie and budget targets.</p>
          </li>
        </ul>
        <p class="note after">Completed habits, logged water and a month kept within budget earn XP.</p>
        <div class="grid two">
          <!-- mock: expense-draft -->
          <!-- mock: habits -->
        </div>
      </div>
    </section>

    <section id="suggestions" aria-labelledby="suggestions-title">
      <div class="wrap">
        <div class="split">
          <div class="split-text stack">
            <p class="overline">Suggestions</p>
            <h2 id="suggestions-title">It asks before it assumes</h2>
            <p>Six rules watch for things worth asking about. Each one shows you what it saw, and nothing is added to your day until you confirm it.</p>
            <p>They are plain rules written in code, not AI, so the same day always produces the same question.</p>
            <p>When a background sync turns one up, it can reach you as a notification: at most two a day, and none overnight.</p>
          </div>
          <!-- mock: suggestion -->
        </div>
        <ul class="grid two three" role="list">
          <li class="card stack">
            <h3>Possible meal</h3>
            <p class="says">“Looks like you had lunch around 1:04 PM”</p>
            <p>Shows the food expense and its time, how often you have made a similar purchase, and an arrival at a known place when location is on.</p>
          </li>
          <li class="card stack">
            <h3>Low water</h3>
            <p class="says">“You’ve had 600 ml today”</p>
            <p>Shows your own recent daily average. It never measures you against a population norm.</p>
          </li>
          <li class="card stack">
            <h3>Unusual spending</h3>
            <p class="says">“You’ve spent more than usual for a Friday”</p>
            <p>Shows today’s total beside your average for that weekday, and how many of them the average rests on.</p>
          </li>
          <li class="card stack">
            <h3>Low activity</h3>
            <p class="says">“A quieter day than usual”</p>
            <p>Shows today’s steps beside your recent average.</p>
          </li>
          <li class="card stack">
            <h3>Habit slipping</h3>
            <p class="says">“Reading is usually done by now”</p>
            <p>Shows the time you usually finish it, and how many recent days that comes from.</p>
          </li>
          <li class="card stack">
            <h3>Workout matches a habit</h3>
            <p class="says">“Mark Run done?”</p>
            <p>Shows the workout, its length, and that it came from your health data.</p>
          </li>
        </ul>
      </div>
    </section>

    <section id="insights" aria-labelledby="insights-title">
      <div class="wrap split flip">
        <div class="split-text stack">
          <p class="overline">Synítheia AI</p>
          <h2 id="insights-title">Insights you can check</h2>
          <p>AI insights are off until you turn them on. When they are on, a hosted AI model is sent totals and averages that the server has already worked out, such as “food spending averaged ₹482 across four Fridays”. It is never sent a merchant, a note or a place.</p>
          <p>Every insight has a “Why am I seeing this?” that shows the exact numbers the model was given, and you can mark an insight helpful or not. Most days it has nothing to say, and that is the right answer.</p>
        </div>
        <!-- mock: insight -->
      </div>
    </section>

    <section id="history" aria-labelledby="history-title">
      <div class="wrap split">
        <div class="split-text stack">
          <p class="overline">History</p>
          <h2 id="history-title">A month at a glance</h2>
          <p>Each day in the calendar is tinted by how it went, in five steps, so a strong week and a thin one look different at a glance. A day with nothing logged stays an outline.</p>
          <p>Tap any day to see it as it was. Past days are read-only.</p>
        </div>
        <!-- mock: month -->
      </div>
    </section>

    <section id="your-data" aria-labelledby="your-data-title">
      <div class="wrap">
        <div class="split flip">
          <div class="split-text stack">
            <p class="overline">Privacy</p>
            <h2 id="your-data-title">Your data, switch by switch</h2>
            <p>The Connected Context screen lists every source the app can read, what it is used for and when it last synced. Each source has two switches: one to collect it, and a separate one to let Synítheia AI use it.</p>
          </div>
          <!-- mock: source -->
        </div>
        <ul class="sources" role="list">
          <li class="card source">
            <h3>Health and activity</h3>
            <dl>
              <div><dt>iPhone</dt><dd>Apple Health. Not available when the .ipa is re-signed with a free Apple ID.</dd></div>
              <div><dt>Android</dt><dd>Health Connect. New in 0.2.0 and not yet verified on a physical phone.</dd></div>
              <div><dt>Notes</dt><dd>Read-only. Steps, active energy, workouts, sleep, resting heart rate, height and weight.</dd></div>
            </dl>
          </li>
          <li class="card source">
            <h3>Calendar</h3>
            <dl>
              <div><dt>iPhone</dt><dd>Yes</dd></div>
              <div><dt>Android</dt><dd>Yes</dd></div>
              <div><dt>Notes</dt><dd>Read-only. Your calendar is never written to.</dd></div>
            </dl>
          </li>
          <li class="card source">
            <h3>Weather</h3>
            <dl>
              <div><dt>iPhone</dt><dd>Yes</dd></div>
              <div><dt>Android</dt><dd>Yes</dd></div>
              <div><dt>Notes</dt><dd>Your approximate area only, while the app is open.</dd></div>
            </dl>
          </li>
          <li class="card source">
            <h3>Location</h3>
            <dl>
              <div><dt>iPhone</dt><dd>Yes</dd></div>
              <div><dt>Android</dt><dd>Yes</dd></div>
              <div><dt>Notes</dt><dd>Off by default. Best-effort, and only while the app is open.</dd></div>
            </dl>
          </li>
          <li class="card source">
            <h3>SMS and notifications</h3>
            <dl>
              <div><dt>iPhone</dt><dd>No</dd></div>
              <div><dt>Android</dt><dd>No</dd></div>
              <div><dt>Notes</dt><dd>Not available on either phone. The reasons are in the next section.</dd></div>
            </dl>
          </li>
        </ul>
        <p class="after">Health and Calendar can also sync while the app is closed. The phone decides when that happens, so it is best-effort, and it has not yet been confirmed on a physical phone. On Android it carries health data only if you allow background access for Synítheia in Health Connect, which not every phone offers.</p>
        <ul class="checks">
          <li>Export everything as JSON.</li>
          <li>Delete one source’s data, or your whole account. Deleted means erased, not hidden.</li>
          <li>Receipt photos are not kept unless you turn that on.</li>
        </ul>
        <p class="note after">Signing up creates an account on a server run by the app’s developer, and what you log is stored there. This page describes what the app does. It is not a legal privacy policy.</p>
      </div>
    </section>

    <section id="limits" aria-labelledby="limits-title">
      <div class="wrap">
        <div class="section-head stack">
          <p class="overline">Limits</p>
          <h2 id="limits-title">What it doesn’t do, and why</h2>
          <p class="lead">Capturing payments without you is not something the phones allow, so the app does not pretend to.</p>
        </div>
        <ul class="grid two three" role="list">
          <li class="card stack">
            <h3>It does not read your SMS</h3>
            <p>iPhone gives apps no way to. On Android, Google Play allows it only for the app you use as your SMS app.</p>
          </li>
          <li class="card stack">
            <h3>It does not read your notifications</h3>
            <p>iPhone gives apps no way to, and store policy on Android does not allow it for tracking expenses.</p>
          </li>
          <li class="card stack">
            <h3>It is not connected to UPI or your bank</h3>
            <p>UPI has no public interface that an app like this can use.</p>
          </li>
        </ul>
        <p class="after">So you hand it the data instead: share the payment screenshot, paste the SMS or upload the statement. Screenshots and pasted messages are read by an AI model, and a CSV is read by plain code. Whatever is read arrives as a draft, and nothing becomes an expense until you confirm it.</p>
      </div>
    </section>

    <section id="download" aria-labelledby="download-title">
      <div class="wrap">
        <div class="section-head stack">
          <p class="overline">Download</p>
          <h2 id="download-title">Get Synítheia</h2>
          <p class="lead">Both builds are free and come from the project’s GitHub releases. You sign in with an email address and a password.</p>
        </div>
        <div class="downloads">
          <div class="card download" id="download-android">
            <h3>Android</h3>
            <a class="button" href="https://github.com/tmonga2208/synitheia/releases/latest/download/Synitheia.apk">Download the .apk</a>
            <p class="release-line" data-release="apk">Latest release</p>
            <p>For Android 8.0 or newer.</p>
            <ol class="steps">
              <li>Download the file.</li>
              <li>Open it and, when Android asks, allow your browser to install apps.</li>
              <li>Open Synítheia and create an account.</li>
            </ol>
            <p>It is not on the Play Store. Install it only from this page or from GitHub Releases.</p>
          </div>
          <div class="card download" id="download-iphone">
            <h3>iPhone</h3>
            <a class="button" href="https://github.com/tmonga2208/synitheia/releases/latest/download/Synitheia-unsigned.ipa">Download the unsigned .ipa</a>
            <p class="release-line" data-release="ipa">Latest release</p>
            <p>This file cannot be installed by tapping it.</p>
            <ol class="steps">
              <li>Download the file on a computer.</li>
              <li>Install it on your phone with Sideloadly or AltStore, signing with your Apple ID.</li>
              <li>Open Synítheia and create an account.</li>
            </ol>
            <p>With a free Apple ID the app has to be re-signed every seven days, and Apple Health does not work.</p>
          </div>
        </div>
        <div class="card checked">
          <h3>What has been checked</h3>
          <ul>
            <li>The Android build was installed, opened and updated from 0.1.1 on an Android 14 emulator. Not yet run on a physical phone.</li>
            <li>Health on Android, through Health Connect, is new in 0.2.0 and not yet verified on a physical phone.</li>
            <li>Background sync is best-effort and not yet confirmed on a physical phone.</li>
            <li>The iPhone build is made by the release pipeline and has not been installed on a phone for this version.</li>
          </ul>
        </div>
        <p class="links">
          <a href="https://github.com/tmonga2208/synitheia/releases">All releases</a>
          <a href="https://github.com/tmonga2208/synitheia">Source code</a>
        </p>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="wrap">
      <p>Synítheia is a personal project. This page sets no cookies and has no analytics. It asks GitHub for the latest release details, and nothing else leaves it.</p>
      <p class="links">
        <a href="https://github.com/tmonga2208/synitheia">Source code</a>
        <a href="https://github.com/tmonga2208/synitheia/releases">All releases</a>
        <a href="fonts/OFL.txt">Manrope font licence</a>
      </p>
    </div>
  </footer>
</body>
</html>
```

- [ ] **Step 4: Add the page's layout and components to the stylesheet**

Append to `apps/web/public/styles.css`:

```css
html {
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
  /* The sticky header would otherwise sit on top of whatever a link jumps to. */
  scroll-padding-top: 5.5rem;
}

h1,
h2,
h3,
p,
ul,
ol,
dl,
dd,
figure {
  margin: 0;
  padding: 0;
}

ul[role="list"] {
  list-style: none;
}

svg {
  display: block;
}

a {
  color: var(--accent-text);
  text-underline-offset: 0.2em;
}

a:hover {
  text-decoration-thickness: 2px;
}

:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 3px;
  border-radius: 0.5rem;
}

.skip {
  position: absolute;
  left: 1rem;
  top: -5rem;
  z-index: 20;
  padding: 0.75rem 1rem;
  border-radius: 0.75rem;
  background: var(--button);
  color: var(--button-text);
  font-weight: 600;
}

.skip:focus {
  top: 1rem;
}

/* ── Type: the app's scale, proportionally ────────────────────────────────────────────── */

h1 {
  font-size: clamp(2.5rem, 9vw, 4.25rem);
  line-height: 1.04;
  letter-spacing: -0.035em;
  font-weight: 700;
}

h2 {
  font-size: clamp(1.75rem, 5vw, 2.5rem);
  line-height: 1.15;
  letter-spacing: -0.025em;
  font-weight: 700;
}

h3 {
  font-size: 1.125rem;
  line-height: 1.35;
  letter-spacing: -0.01em;
  font-weight: 600;
}

.overline {
  font-size: 0.75rem;
  line-height: 1.4;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.lead {
  font-size: clamp(1.0625rem, 2.4vw, 1.25rem);
  color: var(--text-muted);
}

.note {
  font-size: 0.9375rem;
  color: var(--text-muted);
}

/* ── Layout ───────────────────────────────────────────────────────────────────────────── */

.wrap {
  width: min(100% - 2.5rem, 70rem);
  margin-inline: auto;
}

main > section {
  padding-block: clamp(3.5rem, 9vw, 6.5rem);
}

main > section + section {
  border-top: 1px solid var(--border);
}

.stack > * + * {
  margin-top: 1rem;
}

.section-head {
  max-width: 40rem;
}

.after {
  margin-top: 2rem;
  max-width: 46rem;
}

.split {
  display: grid;
  gap: 2.5rem;
  align-items: center;
}

.split > * {
  min-width: 0;
}

.grid {
  display: grid;
  gap: 1rem;
  margin-top: 2.5rem;
}

.grid > * {
  min-width: 0;
}

@media (min-width: 40em) {
  .grid.two {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (min-width: 56.25em) {
  .split {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 4rem;
  }

  /* Text first in the source, so it comes first on a phone and for a screen reader. */
  .split.flip > .split-text {
    order: 2;
  }
}

@media (min-width: 64em) {
  .grid.three {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

/* ── Header ───────────────────────────────────────────────────────────────────────────── */

.site-header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}

.site-header .wrap {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-height: 4rem;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.625rem;
  min-height: 2.75rem;
  color: var(--text);
  font-size: 1.125rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  text-decoration: none;
}

.mark {
  flex: none;
  width: 2rem;
  height: 2rem;
}

.mark path,
.hero-mark path {
  fill: none;
  stroke-width: 72;
  stroke-linecap: round;
}

.mark-outer {
  stroke: var(--accent-soft);
}

.mark-middle {
  stroke: var(--accent);
}

.mark-inner {
  stroke: var(--accent-deep);
}

.site-nav {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.site-nav a:not(.button) {
  display: none;
  align-items: center;
  min-height: 2.75rem;
  padding-inline: 0.875rem;
  border-radius: 0.75rem;
  color: var(--text);
  font-size: 0.9375rem;
  font-weight: 500;
  text-decoration: none;
}

.site-nav a:not(.button):hover {
  background: var(--surface-raised);
}

@media (min-width: 40em) {
  .site-nav a:not(.button) {
    display: inline-flex;
  }
}

/* ── Buttons ──────────────────────────────────────────────────────────────────────────── */

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 3.25rem;
  padding: 0.75rem 1.5rem;
  border: 1px solid transparent;
  border-radius: 1rem;
  background: var(--button);
  color: var(--button-text);
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.2;
  text-align: center;
  text-decoration: none;
  box-shadow: var(--shadow-button);
}

/* An underline, not a lighter fill: a lighter sage would drop the label under 4.5:1. */
.button:hover {
  text-decoration: underline;
  text-decoration-thickness: 2px;
}

.button.secondary {
  border-color: var(--border);
  background: var(--surface-raised);
  color: var(--text);
  box-shadow: none;
}

.button.small {
  min-height: 2.75rem;
  padding: 0.5rem 1.125rem;
  font-size: 0.9375rem;
  box-shadow: none;
}

/* ── Hero ─────────────────────────────────────────────────────────────────────────────── */

.hero {
  position: relative;
  overflow: hidden;
}

main > section.hero {
  padding-block: clamp(2.5rem, 7vw, 5rem) clamp(3.5rem, 9vw, 6.5rem);
}

.hero .wrap {
  position: relative;
}

/*
 * The mark, large and faint, behind the phone. Only where there are two columns: on one
 * column it would sit under the paragraph, and muted text over a sage arc falls below 4.5:1.
 */
.hero-mark {
  display: none;
}

@media (min-width: 56.25em) {
  .hero-mark {
    display: block;
    position: absolute;
    top: 50%;
    right: -8vw;
    width: 50vw;
    opacity: 0.12;
    transform: translateY(-50%);
    pointer-events: none;
  }
}

.hero .overline {
  margin-bottom: 1rem;
}

.hero .lead {
  max-width: 34rem;
  margin-top: 1.25rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 2rem;
}

.release-note {
  margin-top: 1rem;
  font-size: 0.875rem;
  color: var(--text-muted);
}

/* ── Cards and lists ──────────────────────────────────────────────────────────────────── */

.card {
  padding: 1.5rem;
  border: 1px solid var(--border);
  border-radius: 2rem;
  background: var(--surface);
  box-shadow: var(--shadow-card);
}

.card p,
.card li,
.card dd {
  font-size: 0.9375rem;
  color: var(--text-muted);
}

.card .says {
  color: var(--text);
  font-weight: 600;
}

.sources {
  display: grid;
  gap: 1rem;
  margin-top: 2.5rem;
}

.source dl {
  display: grid;
  gap: 0.75rem;
  margin-top: 1rem;
}

.source dt {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
}

@media (min-width: 56.25em) {
  /* Reads as a table on a wide screen without being one, so it never has to un-table itself. */
  .source {
    display: grid;
    grid-template-columns: 13rem minmax(0, 1fr);
    gap: 2rem;
    align-items: start;
  }

  .source dl {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1.5rem;
    margin-top: 0;
  }
}

.checks,
.steps,
.checked ul {
  display: grid;
  gap: 0.5rem;
  padding-left: 1.25rem;
}

.checks {
  margin-top: 2rem;
}

.checked ul {
  margin-top: 1rem;
}

/* ── Download ─────────────────────────────────────────────────────────────────────────── */

.downloads {
  display: grid;
  gap: 1rem;
  margin-top: 2.5rem;
}

@media (min-width: 56.25em) {
  .downloads {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.download {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.download .button {
  align-self: flex-start;
}

.checked {
  margin-top: 1rem;
}

.links {
  display: flex;
  flex-wrap: wrap;
  gap: 0 1.5rem;
  margin-top: 1.5rem;
}

.links a {
  display: inline-flex;
  align-items: center;
  min-height: 2.75rem;
}

/* ── Footer ───────────────────────────────────────────────────────────────────────────── */

.site-footer {
  padding-block: 2.5rem;
  border-top: 1px solid var(--border);
  font-size: 0.875rem;
  color: var(--text-muted);
}

.site-footer .links {
  margin-top: 0.5rem;
}

/* ── Motion: one thing moves, once, and only if the visitor has not asked for stillness ── */

@media (prefers-reduced-motion: no-preference) {
  html {
    scroll-behavior: smooth;
  }
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pnpm --filter @synitheia/web test`
Expected: PASS. 95 tests.

- [ ] **Step 6: Look at it**

Put screenshots in a scratch folder outside the repository; below it is `$SHOTS`.

```bash
SHOTS=$(mktemp -d)
node apps/web/scripts/preview.mjs &
PREVIEW=$!
node apps/web/scripts/shoot.mjs --url http://127.0.0.1:4173/ --width 390 --height 844 --full --out "$SHOTS/page-390-light.png" --eval "[...document.querySelectorAll('[data-release]')].map((el) => el.textContent)"
node apps/web/scripts/shoot.mjs --url http://127.0.0.1:4173/ --width 1280 --height 900 --scheme dark --full --out "$SHOTS/page-1280-dark.png"
kill $PREVIEW
```

Expected in both reports: `"overflowsSideways": false`, `"consoleErrors": []`, `"failedRequests": []`, and `fontsLoaded` naming `Manrope`. The first report's `evalResult` is three strings that each start with `v`, for example `"v0.2.0 · 12 Oct 2026 · 86.6 MB"`. If GitHub cannot be reached from this machine, `failedRequests` has one entry and the three strings read `Latest release`; that is the fallback working, and it is checked on purpose in Task 7.

Open both screenshots. Each of these must be true, and anything that is not is fixed in the stylesheet before committing:

- The header shows the three-arc mark, the name and a Download button. At 1280px it also shows Features and Your data.
- The mark reads as the app icon: three nested arcs, lightest outside, with the inner one open to the right.
- The hero's two buttons sit side by side at 1280px and wrap cleanly at 390px.
- Every section's heading, paragraphs and cards are present, in the order of the spec's table.
- In dark, cards are a step lighter than the page, no card has a shadow, and no text is hard to read.
- Nothing is clipped at either edge and no text overlaps other text.

- [ ] **Step 7: Commit**

```bash
git add apps/web/public/index.html apps/web/public/styles.css apps/web/test/structure.test.mjs apps/web/test/hosts.test.mjs apps/web/test/downloads.test.mjs apps/web/test/copy.test.mjs
git commit -m "feat(web): the page, with every claim on it held by a test

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The eight mocks

**Files:**
- Create: `apps/web/test/mocks.test.mjs`
- Modify: `apps/web/public/index.html` (each `<!-- mock: … -->` comment becomes a figure)
- Modify: `apps/web/public/styles.css` (append the mock styles)

**Interfaces:**
- Consumes: the eight placeholder comments from Task 5; the custom properties from Task 1 (`--flow-*`, `--habit-*`, `--dot-*`, `--button`, `--button-text`, the surfaces and text colours); `scripts/preview.mjs` and `scripts/shoot.mjs`.
- Produces: eight figures, `<figure class="mock" id="mock-NAME">`, with NAME in page order `today`, `your-day`, `expense-draft`, `habits`, `suggestion`, `insight`, `month`, `source`. Each holds exactly one element with `role="img"` and an `aria-label`, followed by `<figcaption>Sample data</figcaption>`. Produces the class `.ring-progress`, which Task 7 inspects.

A mock is a picture of the app, drawn in HTML. Everything inside it is a `div`, `p` or `span`: no links, no buttons, no headings. A screen reader gets the `aria-label` and nothing else, so "₹320.00 spent at Green Bowl" is never read out as something that happened. The wording inside each one is the app's own, taken from the component named beside it.

- [ ] **Step 1: Write the failing test**

`apps/web/test/mocks.test.mjs`:

```js
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @synitheia/web test`
Expected: FAIL. Ten of the eleven new tests fail: the list of mocks is empty, each named mock `is missing`, and the placeholders are still there. The 95 earlier tests still pass.

- [ ] **Step 3: Replace the eight placeholders**

In `apps/web/public/index.html`, replace each comment with the figure given for it. Keep the indentation of the comment being replaced.

Replace `<!-- mock: today -->` (wording from `apps/mobile/app/(tabs)/index.tsx`):

```html
<figure class="mock" id="mock-today">
  <div class="phone" role="img" aria-label="The Today screen. A greeting, a ring showing the day 72 percent complete, a six-day streak and 240 XP, and a card asking whether a food expense at 1:04 PM was lunch, with Dismiss and Confirm.">
    <div class="m-bar">
      <span class="m-avatar">A</span>
      <span class="m-icons">
        <span class="m-icon"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg></span>
        <span class="m-icon"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 7H4c0-1 2-2 2-7M10 20a2 2 0 0 0 4 0"/></svg></span>
      </span>
    </div>
    <p class="m-overline">Friday, October 9</p>
    <p class="m-title">Good afternoon, Asha</p>
    <p class="m-sub">You’re on a 6-day streak. Keep the momentum.</p>
    <div class="m-ring">
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle class="ring-track" cx="100" cy="100" r="78"/>
        <circle class="ring-progress" cx="100" cy="100" r="78" stroke-dasharray="490.09" stroke-dashoffset="137.22" transform="rotate(-90 100 100)"/>
      </svg>
      <p class="m-ring-value"><span>72<small>%</small></span></p>
    </div>
    <div class="m-chips">
      <span class="m-chip"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>6 Day Streak</span>
      <span class="m-chip">240 XP</span>
    </div>
    <div class="m-card">
      <span class="m-tag">detected</span>
      <p class="m-card-title">Looks like you had lunch around 1:04 PM</p>
      <p class="m-body">Add it to today?</p>
      <p class="m-evidence">• Food expense at 1:04 PM</p>
      <div class="m-actions">
        <span class="m-button secondary">Dismiss</span>
        <span class="m-button">Confirm</span>
      </div>
    </div>
  </div>
  <figcaption>Sample data</figcaption>
</figure>
```

The ring's numbers: radius 78, so its circumference is 2π × 78 = 490.09. At 72 percent the undrawn part is 490.09 × 0.28 = 137.22.

Replace `<!-- mock: your-day -->` (sentences as `describe()` in `apps/mobile/src/components/Timeline.tsx` writes them):

```html
<figure class="mock" id="mock-your-day">
  <div class="panel" role="img" aria-label="The Your Day card, in three parts. Morning: one habit and 500 millilitres of water. Afternoon: a 320 rupee lunch, the meal it was logged as, and a design review. Evening: a 32 minute run, 6,480 steps and a completed habit.">
    <div class="m-bucket">
      <div class="m-bucket-head">
        <div class="m-dots"><span class="m-dot habit"></span><span class="m-dot water"></span></div>
        <div>
          <p class="m-overline">Morning</p>
          <p class="m-bucket-summary">1 habit · 500 ml water</p>
        </div>
      </div>
    </div>
    <div class="m-bucket">
      <div class="m-bucket-head">
        <div class="m-dots"><span class="m-dot money"></span><span class="m-dot food"></span></div>
        <div>
          <p class="m-overline">Afternoon</p>
          <p class="m-bucket-summary">₹320.00 · 540 kcal</p>
        </div>
      </div>
      <div class="m-rows">
        <p class="m-row"><span class="m-time">1:04 PM</span><span class="m-dot money"></span><span>₹320.00 spent at Green Bowl · Food</span></p>
        <p class="m-row"><span class="m-time">1:10 PM</span><span class="m-dot food"></span><span>Dal and rice for lunch · 540 kcal</span></p>
        <p class="m-row"><span class="m-time">3:00 PM</span><span class="m-dot context"></span><span>Design review · 45 min</span></p>
      </div>
    </div>
    <div class="m-bucket">
      <div class="m-bucket-head">
        <div class="m-dots"><span class="m-dot habit"></span><span class="m-dot move"></span></div>
        <div>
          <p class="m-overline">Evening</p>
          <p class="m-bucket-summary">1 habit · 6,480 steps</p>
        </div>
      </div>
      <div class="m-rows">
        <p class="m-row"><span class="m-time">6:15 PM</span><span class="m-dot move"></span><span>running · 32 min</span></p>
        <p class="m-row"><span class="m-time">6:50 PM</span><span class="m-dot move"></span><span>6,480 steps</span></p>
        <p class="m-row"><span class="m-time">7:05 PM</span><span class="m-dot habit"></span><span>Run completed</span></p>
      </div>
    </div>
  </div>
  <figcaption>Sample data</figcaption>
</figure>
```

Replace `<!-- mock: expense-draft -->` (the draft card in `apps/mobile/app/expenses/new.tsx`):

```html
<figure class="mock" id="mock-expense-draft">
  <div class="panel" role="img" aria-label="A draft expense read from a payment screenshot: 320 rupees at Green Bowl Cafe, category Food, marked as being added. It shows the line it was read from and says the app is 92 percent sure it read it correctly.">
    <div class="m-draft-head">
      <p class="m-amount">₹320.00</p>
      <span class="m-chip selected">Adding</span>
    </div>
    <p class="m-evidence">“Paid ₹320.00 to Green Bowl Cafe”</p>
    <div class="m-field">
      <p class="m-label">Amount</p>
      <p class="m-input">₹ 320.00</p>
    </div>
    <div class="m-field">
      <p class="m-label">Merchant</p>
      <p class="m-input">Green Bowl Cafe</p>
    </div>
    <div class="m-field">
      <p class="m-label">Category</p>
      <div class="m-pills">
        <span class="m-chip selected">Food</span>
        <span class="m-chip">Transport</span>
        <span class="m-chip">Shopping</span>
      </div>
    </div>
    <p class="m-evidence">We are 92% sure we read this correctly.</p>
  </div>
  <figcaption>Sample data</figcaption>
</figure>
```

Replace `<!-- mock: habits -->` (the metadata line as `metadataFor()` in `apps/mobile/src/components/HabitCard.tsx` builds it):

```html
<figure class="mock" id="mock-habits">
  <div class="panel plain" role="img" aria-label="Three habit cards, each in its own colour. Read is done for today, on a 14-day streak. Walk is at 3,500 of 8,000 steps, on a 6-day streak. Meditate, ten minutes daily, is on its first day.">
    <div class="m-habit sage done">
      <span class="m-habit-icon"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21a2 2 0 0 0 2 2h13"/></svg></span>
      <div>
        <p class="m-habit-name">Read</p>
        <p class="m-habit-meta">Daily • 14D Streak</p>
      </div>
      <span class="m-check"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
    </div>
    <div class="m-habit indigo">
      <span class="m-habit-icon"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg></span>
      <div>
        <p class="m-habit-name">Walk</p>
        <p class="m-habit-meta">3,500 / 8,000 steps • 6D Streak</p>
      </div>
      <span class="m-check"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></span>
    </div>
    <div class="m-habit clay">
      <span class="m-habit-icon"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19c0-8 5-14 14-14 0 9-6 14-14 14zM5 19c3-5 6-8 10-10"/></svg></span>
      <div>
        <p class="m-habit-name">Meditate</p>
        <p class="m-habit-meta">10 min daily • First Day</p>
      </div>
      <span class="m-check"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></span>
    </div>
  </div>
  <figcaption>Sample data</figcaption>
</figure>
```

Replace `<!-- mock: suggestion -->` (the suggestion card on Today, with the workout rule's title and evidence from `apps/api/src/context/detectors/workoutHabit.ts`):

```html
<figure class="mock" id="mock-suggestion">
  <div class="panel" role="img" aria-label="A suggestion card tagged as detected. It asks: Mark Run done? Its evidence is a 32 minute run from your health data. Under it are two buttons, Dismiss and Confirm.">
    <span class="m-tag">detected</span>
    <p class="m-card-title">Mark Run done?</p>
    <p class="m-evidence">• Running, 32 min, from your health data</p>
    <div class="m-actions">
      <span class="m-button secondary">Dismiss</span>
      <span class="m-button">Confirm</span>
    </div>
  </div>
  <figcaption>Sample data</figcaption>
</figure>
```

Replace `<!-- mock: insight -->` (`InsightCard` in `apps/mobile/app/(tabs)/index.tsx`):

```html
<figure class="mock" id="mock-insight">
  <div class="panel" role="img" aria-label="An insight card titled Fridays cost more, with Why am I seeing this opened. It shows what the model was given: 18 food expenses across the last 4 Fridays, averaging 482 rupees against 376 on other weekdays.">
    <p class="m-card-title first">Fridays cost more</p>
    <p class="m-body">Your food spending on Fridays has run above your other weekdays for the past month.</p>
    <p class="m-why"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>Why am I seeing this?</p>
    <div class="m-metrics">
      <p>Based on 18 food expenses across the last 4 Fridays.</p>
      <p class="m-metric"><span>Food spending on Fridays</span><span>₹482.00 vs ₹376.00 other weekdays</span></p>
    </div>
  </div>
  <figcaption>Sample data</figcaption>
</figure>
```

Replace `<!-- mock: month -->` (`apps/mobile/src/components/MonthGrid.tsx`; 1 October 2026 is a Thursday, so three empty cells come first):

```html
<figure class="mock" id="mock-month">
  <div class="panel" role="img" aria-label="The History calendar for October 2026. Days one to eight are tinted from pale to deep sage by how each went, except the fourth, which is an outline because nothing was logged. The ninth is marked as today, and the rest of the month has not happened yet.">
    <p class="m-month-head">October 2026</p>
    <div class="m-week"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div>
    <div class="m-days">
      <span></span><span></span><span></span>
      <span class="m-day f3">1</span><span class="m-day f4">2</span><span class="m-day f0">3</span><span class="m-day hollow">4</span>
      <span class="m-day f2">5</span><span class="m-day f4">6</span><span class="m-day f1">7</span><span class="m-day f4">8</span><span class="m-day f3 today">9</span><span class="m-day later">10</span><span class="m-day later">11</span>
      <span class="m-day later">12</span><span class="m-day later">13</span><span class="m-day later">14</span><span class="m-day later">15</span><span class="m-day later">16</span><span class="m-day later">17</span><span class="m-day later">18</span>
      <span class="m-day later">19</span><span class="m-day later">20</span><span class="m-day later">21</span><span class="m-day later">22</span><span class="m-day later">23</span><span class="m-day later">24</span><span class="m-day later">25</span>
      <span class="m-day later">26</span><span class="m-day later">27</span><span class="m-day later">28</span><span class="m-day later">29</span><span class="m-day later">30</span><span class="m-day later">31</span>
    </div>
  </div>
  <figcaption>Sample data</figcaption>
</figure>
```

Replace `<!-- mock: source -->` (a source row in `apps/mobile/app/privacy.tsx`, with the sentence the API sends for Health in `apps/api/src/modules/privacy/routes.ts`):

```html
<figure class="mock" id="mock-source">
  <div class="panel" role="img" aria-label="A source card from Connected Context: Health and Activity, connected, with what it is used for, where it comes from on each phone and when it last synced. The switch to collect it is on. The separate switch to let Synítheia AI use it is off.">
    <div class="m-source-head">
      <p class="m-card-title first">Health &amp; Activity</p>
      <p class="m-status">Connected</p>
    </div>
    <p class="m-body">Steps, workouts, and sleep appear on your timeline and let Synítheia notice things like lower activity on days you eat more.</p>
    <p class="m-evidence">Apple Health on iOS · Health Connect on Android</p>
    <p class="m-evidence">Last synced Oct 9, 9:12 AM</p>
    <div class="m-toggle">
      <div>
        <p class="m-toggle-title">Collect this data</p>
        <p class="m-toggle-note">Read it into your timeline and your day.</p>
      </div>
      <span class="m-switch on"></span>
    </div>
    <div class="m-toggle">
      <div>
        <p class="m-toggle-title">Let Synítheia AI use it</p>
        <p class="m-toggle-note">A separate decision. You can keep a source and still keep it out of the model.</p>
      </div>
      <span class="m-switch"></span>
    </div>
  </div>
  <figcaption>Sample data</figcaption>
</figure>
```

- [ ] **Step 4: Add the mock styles**

In `apps/web/public/styles.css`, insert this block immediately before the `/* ── Motion` comment:

```css
/* ── Mocks: the app's screens, drawn from the same tokens ──────────────────────────────── */

.mock {
  min-width: 0;
}

/* A pill, so the caption stays readable where the hero's mark passes behind it. */
.mock figcaption {
  width: fit-content;
  margin: 0.875rem auto 0;
  padding: 0.125rem 0.75rem;
  border-radius: 999px;
  background: var(--bg);
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.04em;
}

.phone {
  position: relative;
  width: min(100%, 21.5rem);
  margin-inline: auto;
  padding: 1.25rem 1.125rem 1.5rem;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 2.75rem;
  background: var(--bg);
  box-shadow: var(--shadow-raised);
}

.panel {
  width: min(100%, 26rem);
  margin-inline: auto;
  padding: 1.25rem;
  border: 1px solid var(--border);
  border-radius: 2rem;
  background: var(--surface);
  box-shadow: var(--shadow-card);
}

.panel.plain {
  display: grid;
  gap: 0.75rem;
  padding: 0;
  border: 0;
  background: none;
  box-shadow: none;
}

.i {
  flex: none;
  width: 1.25rem;
  height: 1.25rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.m-bar,
.m-draft-head,
.m-source-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.m-avatar,
.m-icon {
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 50%;
}

.m-avatar {
  background: var(--button);
  color: var(--button-text);
  font-weight: 600;
}

.m-icons {
  display: flex;
  gap: 0.5rem;
}

.m-icon {
  background: var(--surface-raised);
}

.m-overline {
  font-size: 0.6875rem;
  line-height: 1.4;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.phone .m-overline {
  margin-top: 1.25rem;
}

.m-title {
  margin-top: 0.25rem;
  font-size: 1.625rem;
  line-height: 1.2;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.m-sub,
.m-body {
  margin-top: 0.375rem;
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--text-muted);
}

.m-ring {
  position: relative;
  width: 11rem;
  margin: 1.25rem auto 0;
}

.m-ring svg {
  width: 100%;
  height: auto;
}

.ring-track,
.ring-progress {
  fill: none;
  stroke-width: 22;
}

.ring-track {
  stroke: var(--border);
}

.ring-progress {
  stroke: var(--accent);
  stroke-linecap: round;
}

.m-ring-value {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 3.25rem;
  line-height: 1;
  font-weight: 700;
  letter-spacing: -0.05em;
}

.m-ring-value small {
  font-size: 1.125rem;
  font-weight: 600;
  letter-spacing: 0;
  color: var(--text-muted);
}

.m-chips,
.m-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.m-chips {
  justify-content: center;
  margin-top: 1rem;
}

.m-pills {
  margin-top: 0.375rem;
}

.m-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.875rem;
  border-radius: 999px;
  background: var(--surface-raised);
  font-size: 0.8125rem;
  line-height: 1.4;
  font-weight: 500;
}

.m-chip .i {
  width: 0.875rem;
  height: 0.875rem;
  stroke-width: 2;
}

.m-chip.selected {
  background: var(--button);
  color: var(--button-text);
}

.m-card {
  margin-top: 1.25rem;
  padding: 1.125rem;
  border: 1px solid var(--border);
  border-radius: 1.75rem;
  background: var(--surface);
  box-shadow: var(--shadow-card);
}

.m-tag {
  display: inline-block;
  padding: 0.125rem 0.625rem;
  border-radius: 999px;
  background: var(--surface-raised);
  color: var(--text-muted);
  font-size: 0.6875rem;
  font-weight: 500;
}

.m-card-title {
  margin-top: 0.625rem;
  font-size: 1.0625rem;
  line-height: 1.35;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.m-card-title.first {
  margin-top: 0;
}

.m-evidence,
.m-toggle-note,
.m-habit-meta {
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--text-muted);
}

.m-evidence {
  margin-top: 0.375rem;
}

.m-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
}

.m-button {
  flex: 1;
  padding: 0.625rem 0.75rem;
  border-radius: 0.875rem;
  background: var(--button);
  color: var(--button-text);
  font-size: 0.875rem;
  font-weight: 600;
  text-align: center;
}

.m-button.secondary {
  background: var(--surface-raised);
  color: var(--text);
}

/* Your Day */

.m-bucket {
  padding-block: 0.875rem;
}

.m-bucket:first-child {
  padding-top: 0;
}

.m-bucket:last-child {
  padding-bottom: 0;
}

.m-bucket + .m-bucket {
  border-top: 1px solid var(--border);
}

.m-bucket-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.m-dots {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  gap: 0.1875rem;
  width: 2.125rem;
}

.m-dot {
  flex: none;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
}

.m-dot.habit {
  background: var(--dot-habit);
}

.m-dot.money {
  background: var(--dot-money);
}

.m-dot.food {
  background: var(--dot-food);
}

.m-dot.move {
  background: var(--dot-move);
}

.m-dot.water {
  background: var(--dot-water);
}

.m-dot.context {
  background: var(--accent-soft);
}

.m-bucket-summary {
  font-size: 0.9375rem;
  line-height: 1.4;
  font-weight: 500;
}

.m-rows {
  display: grid;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.m-row {
  display: grid;
  grid-template-columns: 3.75rem 0.5rem minmax(0, 1fr);
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  line-height: 1.4;
}

.m-time {
  color: var(--text-muted);
  font-size: 0.75rem;
  text-align: right;
}

/* Expense draft */

.m-amount {
  font-size: 1.25rem;
  line-height: 1.3;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.m-field {
  margin-top: 0.875rem;
}

.m-label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-muted);
}

.m-input {
  margin-top: 0.375rem;
  padding: 0.75rem 0.875rem;
  border-radius: 1rem;
  background: var(--surface-raised);
  font-size: 0.9375rem;
  line-height: 1.4;
}

.m-field + .m-evidence {
  margin-top: 0.875rem;
}

/* Habits: each card carries its own accent, as in the app */

.m-habit {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 0.875rem 1rem;
  border: 1px solid var(--habit);
  border-radius: 1.5rem;
  background: var(--surface);
}

.m-habit.sage {
  --habit: var(--habit-sage);
  --habit-wash: var(--habit-sage-wash);
}

.m-habit.indigo {
  --habit: var(--habit-indigo);
  --habit-wash: var(--habit-indigo-wash);
}

.m-habit.clay {
  --habit: var(--habit-clay);
  --habit-wash: var(--habit-clay-wash);
}

/* Only the sage card is ever "done": muted text is measured on its wash and on no other. */
.m-habit.sage.done {
  background: var(--habit-wash);
}

.m-habit-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 1rem;
  background: var(--habit-wash);
}

.m-habit-icon .i,
.m-check .i {
  stroke: var(--habit);
}

.m-habit.done .m-habit-icon {
  background: var(--surface);
}

.m-habit-name {
  font-size: 0.9375rem;
  line-height: 1.4;
  font-weight: 600;
}

.m-check {
  display: grid;
  place-items: center;
  flex: none;
  width: 2rem;
  height: 2rem;
  margin-left: auto;
  border: 2px solid var(--habit);
  border-radius: 50%;
}

.m-check .i {
  width: 1rem;
  height: 1rem;
  stroke-width: 2.2;
}

.m-habit.done .m-check {
  background: var(--habit);
}

.m-habit.done .m-check .i {
  stroke: var(--surface);
}

/* Insight */

.m-why {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin-top: 0.875rem;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-muted);
}

.m-why .i {
  width: 0.875rem;
  height: 0.875rem;
}

.m-metrics {
  margin-top: 0.75rem;
  padding: 0.875rem;
  border-radius: 1rem;
  background: var(--surface-raised);
  font-size: 0.75rem;
  line-height: 1.5;
}

.m-metrics > p:first-child {
  color: var(--text-muted);
}

.m-metric {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.25rem 1rem;
  margin-top: 0.5rem;
}

.m-metric span:first-child {
  color: var(--text-muted);
}

/* History */

.m-month-head {
  font-size: 1.0625rem;
  font-weight: 600;
}

.m-week,
.m-days {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.375rem;
}

.m-week {
  margin-top: 1rem;
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 500;
  text-align: center;
}

.m-days {
  margin-top: 0.5rem;
}

.m-day {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  border-radius: 0.75rem;
  font-size: 0.75rem;
  font-weight: 500;
}

.m-day.f0 {
  background: var(--flow-0);
  color: var(--text-muted);
}

.m-day.f1 {
  background: var(--flow-1);
}

.m-day.f2 {
  background: var(--flow-2);
}

.m-day.f3 {
  background: var(--flow-3);
}

.m-day.f4 {
  background: var(--flow-4);
  color: var(--button-text);
}

/* A real date with nothing logged: an outline, never the lowest tint. They mean different things. */
.m-day.hollow {
  border: 1px solid var(--border);
  color: var(--text-muted);
}

.m-day.later {
  color: var(--text-muted);
}

.m-day.today {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

/* Connected Context */

.m-status {
  flex: none;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--accent-text);
}

.m-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 0.875rem;
  padding: 0.875rem;
  border-radius: 1.25rem;
  background: var(--surface-raised);
}

.m-toggle-title {
  font-size: 0.9375rem;
  line-height: 1.4;
  font-weight: 500;
}

.m-switch {
  position: relative;
  flex: none;
  width: 3rem;
  height: 1.75rem;
  border-radius: 999px;
  background: var(--border);
}

.m-switch::after {
  content: "";
  position: absolute;
  top: 0.1875rem;
  left: 0.1875rem;
  width: 1.375rem;
  height: 1.375rem;
  border-radius: 50%;
  background: var(--surface);
}

.m-switch.on {
  background: var(--accent);
}

.m-switch.on::after {
  left: auto;
  right: 0.1875rem;
}
```

Then, inside the existing `@media (prefers-reduced-motion: no-preference)` block at the end of the file, add the ring's one animation, and after that block add its keyframes, so the end of the file reads:

```css
@media (prefers-reduced-motion: no-preference) {
  html {
    scroll-behavior: smooth;
  }

  /* The ring draws in once, as it does in the app. */
  .ring-progress {
    animation: ring-draw 900ms ease-out both;
  }
}

@keyframes ring-draw {
  from {
    stroke-dashoffset: 490.09;
  }
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pnpm --filter @synitheia/web test`
Expected: PASS. 106 tests. That includes Task 1's two rules about colour, which now cover every mock style, and Task 5's count of "Sample data" labels, which is now eight against eight figures.

- [ ] **Step 6: Look at each one, in both themes**

```bash
SHOTS=$(mktemp -d)
node apps/web/scripts/preview.mjs &
PREVIEW=$!
for name in today your-day expense-draft habits suggestion insight month source; do
  for scheme in light dark; do
    node apps/web/scripts/shoot.mjs --url http://127.0.0.1:4173/ --width 390 --height 844 --dpr 2 --scheme "$scheme" --selector "#mock-$name" --out "$SHOTS/mock-$name-$scheme.png" > /dev/null
  done
done
node apps/web/scripts/shoot.mjs --url http://127.0.0.1:4173/ --width 1280 --height 900 --full --out "$SHOTS/page-1280-light.png"
kill $PREVIEW
ls "$SHOTS"
```

Expected: sixteen mock screenshots and one page screenshot, and the page report shows `"overflowsSideways": false` and `"consoleErrors": []`.

Open all seventeen. The design screens in `assets/` and the components named in Step 3 are the reference for how each should look. Each of these must be true, and anything that is not is fixed in the stylesheet before committing:

- **Today:** a phone-shaped frame; the avatar and two round icon buttons on one row; the date in small capitals; the ring 72 percent drawn in sage on a pale track with "72%" centred inside it; two pill chips; a card with a "detected" tag, a title, one line of evidence and two equal buttons.
- **Your Day:** three parts divided by hairlines, each with its coloured dots, its name in small capitals and a one-line summary; the rows under Afternoon and Evening align in three columns (time, dot, sentence).
- **Expense draft:** the amount and an "Adding" chip on one row, the quoted line it was read from, two filled fields, three category chips with Food filled, and the "92% sure" line.
- **Habits:** three cards in three different colours. Read is filled with its wash and shows a tick in a filled circle; Walk and Meditate show a plus in an outlined circle.
- **Suggestion:** tag, question, one line of evidence, two equal buttons.
- **Insight:** title, sentence, the "Why am I seeing this?" line with its icon, and an inset panel holding the basis and one metric row.
- **History:** seven columns; day 1 sits under the fourth column (Thursday); days 1 to 8 are tinted in visibly different strengths, day 4 is an outline, day 9 is ringed, and days 10 to 31 are plain numerals.
- **Source:** the name and "Connected" on one row, three lines of description, then two inset rows each ending in a switch: the first on, the second off.
- **In dark, for all eight:** panels are a step lighter than the page, nothing has a shadow, every word is easy to read, and the filled buttons and chips are sage with dark text.
- **On the page at 1280px:** each mock sits beside its text; in the hero the large faint mark passes behind the phone and behind no text; the two tracker mocks sit side by side.

- [ ] **Step 7: Commit**

```bash
git add apps/web/public/index.html apps/web/public/styles.css apps/web/test/mocks.test.mjs
git commit -m "feat(web): the app's screens, rebuilt in HTML from its own colours

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The whole page, the way visitors will meet it

**Files:**
- Create: `apps/web/test/weight.test.mjs`
- Modify: `apps/web/public/styles.css`, `apps/web/public/index.html` (only if a check below fails)

**Interfaces:**
- Consumes: everything from Tasks 1 to 6.
- Produces: nothing new. This task is the evidence that the page is right at the widths, themes and conditions the spec names.

- [ ] **Step 1: Write the weight test**

`apps/web/test/weight.test.mjs`:

```js
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
```

- [ ] **Step 2: See it fail, then see it pass**

This test guards a budget the page already meets, so it would pass the first time it ran. Run it once against a budget it cannot meet, to prove it measures something:

Run: `WEIGHT_BUDGET=1000 pnpm --filter @synitheia/web test`
Expected: FAIL, one test: `first load is NNNNN bytes; the budget is 1000`. Note the number; it should be near 100,000.

Run: `pnpm --filter @synitheia/web test`
Expected: PASS. 108 tests.

- [ ] **Step 3: Start the preview and make a scratch folder**

```bash
SHOTS=$(mktemp -d)
node apps/web/scripts/preview.mjs &
PREVIEW=$!
```

Every command below is `node apps/web/scripts/shoot.mjs --url http://127.0.0.1:4173/` plus the flags shown. Fix what fails in the stylesheet or the page, re-run `pnpm --filter @synitheia/web test`, and repeat the check.

- [ ] **Step 4: A narrow phone**

Flags: `--width 320 --height 640 --full --out "$SHOTS/320-light.png"`
Expected: `"overflowsSideways": false`. In the screenshot, the header's name and Download button fit on one line, the hero buttons are stacked, and no word is cut off at the right edge.

- [ ] **Step 5: Both themes at both widths**

Flags, four runs: `--width 390 --height 844 --full` and `--width 1280 --height 900 --full`, each with `--scheme light` and `--scheme dark`, each with its own `--out`.
Expected in all four: `"overflowsSideways": false`, `"consoleErrors": []`, `fontsLoaded` names `Manrope`. Read each screenshot top to bottom against the spec's table of ten parts: every part is present, in order, and readable.

- [ ] **Step 6: Scripts off**

Flags: `--width 390 --height 844 --no-js --full --out "$SHOTS/390-no-js.png"`
Expected: the screenshot shows every section and all eight mocks, exactly as with scripts on, except that the three release lines read `Latest release`.

- [ ] **Step 7: GitHub unreachable**

Flags: `--width 390 --height 844 --block "*api.github.com*" --eval "[...document.querySelectorAll('[data-release]')].map((el) => el.textContent)"`
Expected: `evalResult` is `["Latest release", "Latest release", "Latest release"]`; `failedRequests` has exactly one entry, which Chrome names `inspector` (its reason for a request blocked through the debugging interface); `consoleErrors` is empty.

Then the same without `--block`:
Expected: `evalResult` is three strings that each begin with the latest release's tag, `v0.2.0` at the time of writing; the second and third end in `MB`.

- [ ] **Step 8: Reduced motion**

Flags: `--width 390 --height 844 --reduced-motion --eval "getComputedStyle(document.querySelector('.ring-progress')).animationName"`
Expected: `"evalResult": "none"`.

The same without `--reduced-motion`:
Expected: `"evalResult": "ring-draw"`.

- [ ] **Step 9: The keyboard**

Flags: `--width 1280 --height 900 --tabs 1 --out "$SHOTS/tab-1.png"`
Expected: `"focused": "Skip to content"`, and the screenshot shows that link at the top left of the page.

Flags: `--width 1280 --height 900 --tabs 4 --out "$SHOTS/tab-4.png"`
Expected: `"focused": "Your data"`, and the screenshot shows a clearly visible outline around that link in the header. (The order is: skip link, the name, Features, Your data.)

Flags: `--width 1280 --height 900 --scheme dark --tabs 5 --out "$SHOTS/tab-5-dark.png"`
Expected: `"focused": "Download"`, with an outline that is just as visible on the dark page.

- [ ] **Step 10: Lighthouse**

Lighthouse is run with `npx`, which downloads it into npm's cache. Nothing is added to `package.json` or the lockfile.

```bash
npx --yes lighthouse@12 http://127.0.0.1:4173/ --only-categories=accessibility,best-practices,seo --chrome-flags="--headless=new" --output=json --output-path="$SHOTS/lighthouse.json" --quiet
node -e "const r = require(process.argv[1]); for (const [name, c] of Object.entries(r.categories)) console.log(name, c.score); for (const a of Object.values(r.audits)) if (a.score !== null && a.score < 1) console.log('  not passing:', a.id, '-', a.title);" "$SHOTS/lighthouse.json"
```

Expected: `accessibility 1`, and `best-practices` and `seo` at 0.9 or above. For every line that begins `not passing`, either fix it or record, as a ruling, why it stands. If this machine cannot reach the npm registry, record that Lighthouse was not run; do not report its scores.

- [ ] **Step 11: Stop the preview**

```bash
kill $PREVIEW
```

- [ ] **Step 12: Commit**

```bash
git add apps/web/test/weight.test.mjs apps/web/public
git commit -m "test(web): a first-load budget, and the page checked at the widths and themes it must hold

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Documentation and the full check

**Files:**
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`

**Interfaces:**
- Consumes: the finished package.
- Produces: nothing code depends on.

- [ ] **Step 1: README**

In `README.md`, the layout block near the top reads:

```
apps/
  api/       Node 22 · Fastify · TypeScript · Mongoose
  mobile/    React Native · Expo (custom dev client) · Expo Router
packages/
```

Add one line so that it reads:

```
apps/
  api/       Node 22 · Fastify · TypeScript · Mongoose
  mobile/    React Native · Expo (custom dev client) · Expo Router
  web/       The public page · plain HTML and CSS, no build step
packages/
```

In the "Running it" section, after the fenced block that ends with `pnpm mobile`, add:

````markdown
The public page needs none of that:

```bash
pnpm --filter @synitheia/web preview   # http://127.0.0.1:4173, with production's response headers
```
````

- [ ] **Step 2: ARCHITECTURE**

In `ARCHITECTURE.md`, in the tree under "### Monorepo", replace:

```
│   ├── mobile/           # React Native (Expo, custom dev client)
│   └── api/              # Node + Fastify + TypeScript
```

with:

```
│   ├── mobile/           # React Native (Expo, custom dev client)
│   ├── api/              # Node + Fastify + TypeScript
│   └── web/              # The public page: static files, no build (§11)
```

Then append to the end of the file:

```markdown

---

## 11. The public page (added October 2026)

`apps/web` is the page people are sent to: what the app does, what it has and has not been
shown to do, and the two downloads. It is a folder of static files that Vercel serves as it
stands. There is no framework and no build step, because one page needs neither, and no
dependency, so the lockfile gains nothing.

Three decisions shape it:

- **The app's screens are rebuilt in HTML**, from the same colour values as
  `apps/mobile/src/theme`, rather than shown as screenshots. They follow the visitor's light
  or dark setting, weigh almost nothing, and each is exposed to a screen reader as one
  described picture, so sample data is never read out as fact.
- **The download buttons are plain links to `releases/latest/download/…`.** They follow every
  release with no redeploy and work with JavaScript off. A test reads the artifact names out
  of the build workflows, so renaming one there fails here instead of leaving a dead button.
- **The page's claims are held by tests.** `test/copy.test.mjs` requires each "not yet
  verified" statement and forbids the claims the project cannot back. When a statement stops
  being true, the sentence and the test change together.

The only request the page makes to another host is one call to GitHub's public API, for the
latest release's version, date and file sizes. The content-security policy in `vercel.json`
allows that and nothing else. `scripts/preview.mjs` serves the page locally with the same
headers, so a violation shows up before a deploy rather than after, and `scripts/shoot.mjs`
loads it in a throwaway headless Chrome at a chosen width and theme.

Deploys are by hand, with the Vercel CLI, from `apps/web`.
```

- [ ] **Step 3: The full check**

Run: `pnpm check`
Expected: exit 0. Type checks and lint are clean for the packages that have them (the site has neither), and tests pass in all four packages that have tests: shared 222, mobile 395, api 238, web 108.

- [ ] **Step 4: Commit**

```bash
git add README.md ARCHITECTURE.md
git commit -m "docs: the public page, and how to run it locally

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## After this plan: deploy

Not a task for whoever executes the plan, because it publishes. It happens once the branch has been reviewed and has landed on `main`, from a checkout of `main`.

1. **The user signs in.** The Vercel CLI on this Mac reports "Logged out", so the user runs `vercel login`. Nothing below can happen before that.
2. **Create the project and deploy.** From `apps/web`:

   ```bash
   vercel link --yes --project synitheia
   vercel deploy --prod
   ```

   The outcome that matters is a project named `synitheia` whose root is `apps/web`, serving `public/`. If the CLI's prompts differ from this, answer them to reach that outcome. The link step writes `apps/web/.vercel/`, which is ignored.
3. **Note the address.** The deploy prints the production address. The plan assumes `https://synitheia.vercel.app`. If Vercel assigned something else, replace `synitheia.vercel.app` with it in `apps/web/public/index.html` (the canonical link, `og:url` and `og:image`) and in `ALLOWED` in `apps/web/test/hosts.test.mjs`, run `pnpm --filter @synitheia/web test`, commit, and deploy again.
4. **Check production.**

   ```bash
   curl -sI https://synitheia.vercel.app/ | grep -i -E "^HTTP|content-security-policy|x-content-type-options|x-frame-options"
   curl -sI https://synitheia.vercel.app/fonts/manrope-latin.woff2 | grep -i -E "^HTTP|cache-control|content-type"
   curl -sI https://synitheia.vercel.app/og.png | grep -i -E "^HTTP|content-type"
   node apps/web/scripts/shoot.mjs --url https://synitheia.vercel.app/ --width 390 --height 844 --full --out "$(mktemp -d)/live-390.png" --eval "[...document.querySelectorAll('[data-release]')].map((el) => el.textContent)"
   curl -sIL https://github.com/tmonga2208/synitheia/releases/latest/download/Synitheia.apk | grep -i -E "^HTTP|^content-length"
   curl -sIL https://github.com/tmonga2208/synitheia/releases/latest/download/Synitheia-unsigned.ipa | grep -i -E "^HTTP|^content-length"
   ```

   Expected: `200` everywhere after redirects; the policy from `vercel.json` on the page; a year's cache on the font; the live page with no console errors, no sideways overflow and three release lines that begin with the latest tag; the two files at the sizes GitHub lists for the latest release.
5. **Point the repository at it:** `gh repo edit tmonga2208/synitheia --homepage https://synitheia.vercel.app`
6. **Say where it is.** Add one line to `README.md`, under the line that links `ARCHITECTURE.md`: `The public page, with the downloads: **https://synitheia.vercel.app**`. Commit it. Pushing `main` is the user's call.

Later changes to the page are redeployed the same way. The download buttons never need it.

## Spec coverage

| Spec section | Where it is implemented |
|---|---|
| Decisions: Vercel, HTML-rebuilt screens, plain files, `apps/web`, system theme | Tasks 1, 4, 5, 6; "After this plan: deploy" |
| The page: ten parts, in order | Task 5 (nine sections and the footer), Task 6 (their mocks) |
| Trackers, the six rules, the sources table, download blocks | Task 5, held by `copy.test.mjs` and `downloads.test.mjs` |
| Copy rules: must be stated, must not appear | Task 5, `copy.test.mjs` |
| Look: tokens, type, shape, mark, layout, motion | Tasks 1, 2, 5, 6; checked by eye in Tasks 5, 6, 7 |
| Accessibility: contrast, focus, tap targets, mocks as images, works without scripts | Task 1 (`contrast.test.mjs`), Task 5 (`structure.test.mjs`), Task 6 (`mocks.test.mjs`), Task 7 (steps 6 and 9) |
| How it is built: files, release details, nothing else leaves the page, headers, weight | Tasks 3, 4, 5, 7 |
| Deployment | "After this plan: deploy" |
| Testing: the seven automated areas | `downloads`, `hosts` + `headers`, `contrast`, `copy`, `structure`, `release`, `weight` tests |
| Testing: by hand, in Chrome | Task 7; production in "After this plan: deploy" |
| Files touched | Tasks 1 to 8 |



