/**
 * Website logos: the main process fetches a site's own icon (main/siteIcon.ts); here it's decoded and scaled to a
 * 64 px PNG, small enough to keep on the item, where it syncs, exports and shows offline like the rest of it.
 */
import { useEffect, useState } from 'react';
import { domainOf } from '../core/search';
import type { Item } from '../core/types';
import { api } from './api';
import { useApp } from './state';

const SIZE = 64;

/** The logo for a website address as a PNG data URL, or null if the site has none Boltwork can read. */
export async function siteIconFor(url: string): Promise<string | null> {
  const r = await api.fetchSiteIcon(url).catch(() => null);
  if (!r) return null;
  const src = URL.createObjectURL(new Blob([r.bytes as Uint8Array<ArrayBuffer>], { type: r.mime }));
  try {
    // An <img> decodes every format sites use (ICO, PNG, SVG, WebP…), and runs no script in an SVG.
    const img = new Image();
    img.src = src;
    await img.decode();
    const w = img.naturalWidth || SIZE, h = img.naturalHeight || SIZE;
    if (w < 8 || h < 8) return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    const draw = (box: number) => {
      const scale = box / Math.max(w, h);
      ctx.drawImage(img, (SIZE - w * scale) / 2, (SIZE - h * scale) / 2, w * scale, h * scale);
    };
    draw(SIZE);
    const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
    let opaque = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 16) opaque++;
    // A blank image (fully transparent) is no logo.
    if (!opaque) return null;
    // A logo with see-through parts (GitHub's black cat) could vanish on a dark theme, so it goes on a white tile,
    // inset a little, the way logos sit on app icons. Logos that fill their square keep their own background.
    if (opaque < SIZE * SIZE * 0.9) {
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, SIZE, SIZE);
      draw(SIZE * 0.72);
    }
    return canvas.toDataURL('image/png');
  } catch { return null; } finally { URL.revokeObjectURL(src); }
}

/** The host whose logo an item should show: its first website's. */
export const iconHostOf = (item: Pick<Item, 'urls'>) => (item.urls[0]?.url.trim() ? domainOf(item.urls[0].url) : '');

// Sites with no readable logo, so they aren't asked again for a week. Kept per device; it's only a hint.
const MISSES_KEY = 'siteIconMisses';
const WEEK = 7 * 24 * 3600_000;
function misses(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(MISSES_KEY) ?? '{}') as Record<string, number>; } catch { return {}; }
}
function noteMiss(host: string) {
  try {
    const m = misses();
    m[host] = Date.now();
    for (const [h, at] of Object.entries(m)) if (Date.now() - at > WEEK) delete m[h];
    localStorage.setItem(MISSES_KEY, JSON.stringify(m));
  } catch { /* storage unavailable: just ask again next time */ }
}

let running = false;

/**
 * While Website logos is on, fetches logos for logins that don't have one yet, a few sites at a time.
 * New and edited logins get theirs in the editor; this covers everything saved before.
 */
export function useSiteIconBackfill() {
  const { data, settings, app } = useApp();
  const on = !!settings?.downloadIcons && app?.platform !== 'web' && !app?.locked;
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!on || !data || running) return;
    const recent = misses();
    const byHost = new Map<string, Item[]>();
    for (const item of data.items) {
      if (item.state === 'deleted' || (item.icon && !item.iconHost)) continue;
      const host = iconHostOf(item);
      if (!host || item.iconHost === host || Date.now() - (recent[host] ?? 0) < WEEK) continue;
      byHost.set(host, [...(byHost.get(host) ?? []), item]);
    }
    if (!byHost.size) return;
    running = true;
    const queue = [...byHost].slice(0, 40);
    const more = byHost.size > queue.length;
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const [host, items] = next;
        const icon = await siteIconFor(items[0].urls[0].url);
        if (!icon) { noteMiss(host); continue; }
        for (const item of items) await api.setSiteIcon(item.id, host, icon).catch(() => undefined);
      }
    };
    void Promise.all([worker(), worker(), worker()]).finally(() => { running = false; if (more) setRound(r => r + 1); });
  }, [on, data, round]);
}
