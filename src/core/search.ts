import { allFields, subtitleOf, TEMPLATE_BY_CATEGORY } from './templates';
import type { Item, Vault } from './types';

/**
 * Smart search. Plain words match titles, usernames, URLs, tags, notes and non-secret fields.
 * Filters: tag:x  -tag:x  vault:x  category:x (or type:x)  is:favorite  is:archived  is:deleted
 *          has:otp  has:attachment  has:passkey  url:x. Quote phrases: "my bank".
 */
export interface ParsedQuery {
  terms: string[];
  tags: string[];
  notTags: string[];
  vaults: string[];
  categories: string[];
  is: string[];
  has: string[];
  urls: string[];
}

export function parseQuery(q: string): ParsedQuery {
  const out: ParsedQuery = { terms: [], tags: [], notTags: [], vaults: [], categories: [], is: [], has: [], urls: [] };
  const tokens = q.match(/-?\w+:"[^"]*"|-?\w+:\S+|"[^"]*"|\S+/g) ?? [];
  for (const raw of tokens) {
    const m = raw.match(/^(-?)(\w+):(.*)$/);
    const val = (s: string) => s.replace(/^"|"$/g, '').toLowerCase();
    if (m) {
      const [, neg, key, rest] = m;
      const v = val(rest);
      if (key === 'tag') (neg ? out.notTags : out.tags).push(v);
      else if (key === 'vault') out.vaults.push(v);
      else if (key === 'category' || key === 'type') out.categories.push(v);
      else if (key === 'is') out.is.push(v);
      else if (key === 'has') out.has.push(v);
      else if (key === 'url') out.urls.push(v);
      else out.terms.push(val(raw));
    } else out.terms.push(val(raw));
  }
  return out;
}

function haystack(item: Item): { title: string; rest: string } {
  const parts = [
    subtitleOf(item), item.notes, ...item.tags, ...item.urls.map(u => u.url),
    ...allFields(item).filter(f => f.type !== 'concealed' && f.type !== 'totp').map(f => f.value),
    ...item.attachments.map(a => a.name), TEMPLATE_BY_CATEGORY[item.category].name,
  ];
  return { title: item.title.toLowerCase(), rest: parts.join('\n').toLowerCase() };
}

const tagMatches = (tags: string[], wanted: string) => tags.some(t => t.toLowerCase() === wanted || t.toLowerCase().startsWith(`${wanted}/`));

export function searchItems(items: Item[], vaults: Vault[], query: string): Item[] {
  const q = parseQuery(query);
  const vaultName = new Map(vaults.map(v => [v.id, v.name.toLowerCase()]));
  const wantState = q.is.includes('deleted') ? 'deleted' : q.is.includes('archived') ? 'archived' : 'active';
  const scored: [Item, number][] = [];
  for (const item of items) {
    if (item.state !== wantState) continue;
    if (q.is.includes('favorite') && !item.favorite) continue;
    if (q.tags.some(t => !tagMatches(item.tags, t))) continue;
    if (q.notTags.some(t => tagMatches(item.tags, t))) continue;
    if (q.vaults.length && !q.vaults.some(v => (vaultName.get(item.vaultId) ?? '').includes(v))) continue;
    if (q.categories.length && !q.categories.some(c => item.category.toLowerCase().includes(c) || TEMPLATE_BY_CATEGORY[item.category].name.toLowerCase().includes(c))) continue;
    if (q.has.includes('otp') && !allFields(item).some(f => f.type === 'totp' && f.value)) continue;
    if (q.has.includes('attachment') && !item.attachments.length) continue;
    if (q.has.includes('passkey') && !item.passkeys?.length) continue;
    if (q.urls.length && !q.urls.some(u => item.urls.some(x => x.url.toLowerCase().includes(u)))) continue;
    const { title, rest } = haystack(item);
    let score = 0, ok = true;
    for (const t of q.terms) {
      if (title.startsWith(t)) score += 10;
      else if (title.includes(t)) score += 6;
      else if (rest.includes(t)) score += 2;
      else { ok = false; break; }
    }
    if (!ok) continue;
    score += item.favorite ? 1 : 0;
    score += Math.min(item.useCount, 20) / 10;
    scored.push([item, score]);
  }
  return scored.sort((a, b) => b[1] - a[1] || a[0].title.localeCompare(b[0].title)).map(([i]) => i);
}

/** Hostname without "www.", used to match items to websites. */
export function domainOf(url: string): string {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/** Registrable-ish domain: last two labels, or three for common second-level suffixes like co.uk. */
export function baseDomain(host: string): string {
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const sld = parts.slice(-2).join('.');
  return /^(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/.test(sld) ? parts.slice(-3).join('.') : sld;
}
