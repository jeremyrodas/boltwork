/**
 * Fetches a website's logo from the website itself, so no icon service learns which sites are in the vault.
 * Reads the homepage's icon links (core/siteIcon.ts) and returns the first one that is an image. The renderer
 * decodes it and scales it to a small PNG, which is what gets saved on the item.
 */
import { net } from 'electron';
import { iconCandidates, siteHome } from '../core/siteIcon';

const PAGE_LIMIT = 1024 * 1024;
const ICON_LIMIT = 512 * 1024;
const TIMEOUT_MS = 8000;

/** The body, up to `limit` bytes, or null if it's bigger. */
async function readLimited(res: Response, limit: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get('content-length') ?? NaN);
  if (declared > limit) return null;
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { void reader.cancel(); return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

const get = (url: string, accept: string) => net.fetch(url, {
  headers: { accept },
  redirect: 'follow',
  credentials: 'omit',
  signal: AbortSignal.timeout(TIMEOUT_MS),
} as RequestInit);

/** What the image bytes look like, so a server's wrong content-type doesn't matter. */
function sniff(b: Uint8Array): string | null {
  const s = (n: number) => String.fromCharCode(...b.subarray(0, n));
  if (b[0] === 0x89 && s(4).slice(1) === 'PNG') return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0 && b[1] === 0 && (b[2] === 1 || b[2] === 2) && b[3] === 0) return 'image/x-icon';
  if (s(4) === 'GIF8') return 'image/gif';
  if (s(4) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'image/webp';
  if (s(2) === 'BM') return 'image/bmp';
  const text = new TextDecoder().decode(b.subarray(0, 512)).trimStart().toLowerCase();
  if (text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg'))) return 'image/svg+xml';
  return null;
}

function fromDataUrl(url: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:(image\/[a-z0-9.+-]+)(;base64)?,(.*)$/is.exec(url);
  if (!m) return null;
  const bytes = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
  return bytes.length && bytes.length <= ICON_LIMIT ? { mime: sniff(bytes) ?? m[1], bytes: new Uint8Array(bytes) } : null;
}

/** The website's logo as image bytes, or null if it has none that can be read. */
export async function fetchSiteIcon(url: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
  const home = siteHome(url);
  if (!home) return null;
  let candidates = [new URL('/favicon.ico', home).href];
  try {
    const res = await get(home.href, 'text/html,application/xhtml+xml');
    if (res.ok && /html/i.test(res.headers.get('content-type') ?? 'text/html')) {
      const body = await readLimited(res, PAGE_LIMIT);
      // After redirects (example.com → www.example.com), links resolve against the page that was actually served.
      if (body) candidates = iconCandidates(new TextDecoder().decode(body), res.url || home.href);
    }
  } catch { /* unreachable homepage: still try /favicon.ico */ }

  for (const candidate of candidates.slice(0, 6)) {
    if (candidate.startsWith('data:')) { const d = fromDataUrl(candidate); if (d) return d; continue; }
    try {
      const res = await get(candidate, 'image/*');
      if (!res.ok) continue;
      const bytes = await readLimited(res, ICON_LIMIT);
      const mime = bytes?.length ? sniff(bytes) : null;
      if (bytes && mime) return { mime, bytes };
    } catch { /* try the next one */ }
  }
  return null;
}
