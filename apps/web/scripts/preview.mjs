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
