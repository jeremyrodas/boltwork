/**
 * Finding a website's logo: the icons its homepage links to, best first. The fetching happens in the main
 * process (main/siteIcon.ts) and the decoding in the renderer (renderer/siteIcon.ts); this part is plain
 * text handling so it can be tested.
 */

/** The page to read a site's icon links from: its homepage, over https unless the address says http. */
export function siteHome(url: string): URL | null {
  const raw = url.trim();
  if (!raw) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null;
    return new URL('/', u);
  } catch { return null; }
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
};

const decodeEntities = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/**
 * The icons a page links to, best first: large touch icons, then sized or scalable icons by size, then any
 * other icon, then /favicon.ico. Monochrome mask icons are skipped; they're drawn in a single color.
 */
export function iconCandidates(html: string, pageUrl: string): string[] {
  const head = html.slice(0, 256 * 1024);
  let base = pageUrl;
  const baseTag = /<base\s[^>]*>/i.exec(head)?.[0];
  const baseHref = baseTag && attr(baseTag, 'href');
  if (baseHref) { try { base = new URL(decodeEntities(baseHref), pageUrl).href; } catch { /* keep the page's */ } }

  const found: { url: string; score: number }[] = [];
  for (const [tag] of head.matchAll(/<link\s[^>]*>/gi)) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/);
    const href = attr(tag, 'href');
    if (!href || rel.includes('mask-icon')) continue;
    const touch = rel.some(r => r.startsWith('apple-touch-icon'));
    if (!touch && !rel.includes('icon')) continue;
    let url: string;
    try { url = new URL(decodeEntities(href.trim()), base).href; } catch { continue; }
    if (!/^(https?:|data:image\/)/i.test(url)) continue;
    const sizes = (attr(tag, 'sizes') ?? '').toLowerCase();
    const svg = sizes === 'any' || /svg/i.test(attr(tag, 'type') ?? '') || /\.svg(\?|#|$)/i.test(url);
    const px = Math.max(0, ...[...sizes.matchAll(/(\d+)x\d+/g)].map(m => Number(m[1])));
    // Big enough to look sharp at 64 px is what matters; past that, size adds nothing.
    const score = svg ? 900 : touch ? 800 + Math.min(px || 180, 512) / 10 : px ? Math.min(px, 512) : 100;
    found.push({ url, score });
  }
  const ordered = found.sort((a, b) => b.score - a.score).map(f => f.url);
  ordered.push(new URL('/favicon.ico', pageUrl).href);
  return [...new Set(ordered)];
}
