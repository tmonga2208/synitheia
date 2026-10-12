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
