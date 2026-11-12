/**
 * Serves the web vault (the app's screens in a browser) from a folder built by `npm run build` (dist-web).
 * Off unless WEB_VAULT=on: whoever controls the server controls the code the browser runs, so a server owner
 * who doesn't want that in the picture keeps only the sync API.
 *
 * The files are read once at start (and gzipped) and served with a strict Content Security Policy: scripts
 * only from this server, and connections only to this server plus the optional Watchtower lookups.
 */
import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2',
};

const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://icons.duckduckgo.com",
  "font-src 'self'",
  "connect-src 'self' https://api.pwnedpasswords.com https://haveibeenpwned.com https://api.2fa.directory",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const HEADERS = {
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  // The camera is for scanning a setup code on the sign-in screen (Scan code → With the camera); only this page may use it.
  'permissions-policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
  // Always revalidate, so an updated server never runs next to an old page.
  'cache-control': 'no-cache',
};

interface WebFile { type: string; body: Buffer; gzip: Buffer; etag: string }

/** Returns a handler that answers requests for the web vault's files, or null if the folder has no index.html. */
export function webVault(dir: string): ((req: http.IncomingMessage, res: http.ServerResponse, pathname: string) => boolean) | null {
  if (!fs.existsSync(path.join(dir, 'index.html'))) return null;
  const files = new Map<string, WebFile>();
  for (const name of fs.readdirSync(dir)) {
    const type = TYPES[path.extname(name)];
    if (!type) continue;
    const body = fs.readFileSync(path.join(dir, name));
    files.set(`/${name}`, { type, body, gzip: gzipSync(body), etag: `"${createHash('sha256').update(body).digest('base64url').slice(0, 22)}"` });
  }
  files.set('/', files.get('/index.html')!);

  return (req, res, pathname) => {
    const file = files.get(pathname);
    if (!file || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
    if (req.headers['if-none-match'] === file.etag) {
      res.writeHead(304, { ...HEADERS, etag: file.etag });
      res.end();
      return true;
    }
    const gz = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
    const body = gz ? file.gzip : file.body;
    res.writeHead(200, {
      ...HEADERS, 'content-type': file.type, 'content-length': body.length, etag: file.etag, vary: 'accept-encoding',
      ...(gz ? { 'content-encoding': 'gzip' } : {}),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  };
}
