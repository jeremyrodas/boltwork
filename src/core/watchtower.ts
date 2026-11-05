import { createHash } from 'node:crypto';
import { baseDomain, domainOf } from './search';
import { allFields, fieldByPurpose } from './templates';
import { isWeak } from './strength';
import type { Item, VaultData, WatchtowerCheck, WatchtowerIssue, WatchtowerReport } from './types';

/** Popular sites known to support authenticator-app (TOTP) 2FA. Extended online from 2fa.directory when enabled. */
export const BUILTIN_2FA_DOMAINS = new Set(`
google.com gmail.com youtube.com microsoft.com live.com outlook.com office.com apple.com icloud.com amazon.com aws.amazon.com
facebook.com instagram.com twitter.com x.com linkedin.com github.com gitlab.com bitbucket.org dropbox.com box.com slack.com
discord.com reddit.com twitch.tv paypal.com stripe.com coinbase.com binance.com kraken.com gemini.com robinhood.com
wellsfargo.com chase.com bankofamerica.com capitalone.com americanexpress.com fidelity.com schwab.com vanguard.com
cloudflare.com digitalocean.com heroku.com linode.com vultr.com godaddy.com namecheap.com hover.com porkbun.com
atlassian.com notion.so evernote.com zoom.us salesforce.com hubspot.com shopify.com squarespace.com wix.com wordpress.com
mailchimp.com sendgrid.com twilio.com okta.com adobe.com autodesk.com epicgames.com steampowered.com ea.com ubisoft.com
playstation.com xbox.com nintendo.com battle.net blizzard.com roblox.com tumblr.com pinterest.com snapchat.com tiktok.com
yahoo.com aol.com protonmail.com proton.me fastmail.com zoho.com tutanota.com docusign.com intuit.com
turbotax.com quickbooks.com xero.com wise.com revolut.com venmo.com etsy.com ebay.com patreon.com kickstarter.com
npmjs.com pypi.org docker.com vercel.com netlify.com sentry.io figma.com
canva.com trello.com asana.com monday.com airtable.com miro.com mega.nz backblaze.com sync.com pcloud.com
`.trim().split(/\s+/));

export interface OnlineChecks {
  /** Times this SHA-1 (upper hex) appears in Have I Been Pwned's Pwned Passwords (k-anonymity range lookup). */
  pwnedCount?: (sha1: string) => Promise<number>;
  /** Public breaches with their domain and breach date. */
  breaches?: () => Promise<{ domain: string; breachDate: string; name: string }[]>;
  /** Extra domains supporting TOTP. */
  twoFactorDomains?: () => Promise<Set<string>>;
}

const sha1 = (s: string) => createHash('sha1').update(s, 'utf8').digest('hex').toUpperCase();
const WEIGHTS: Record<WatchtowerCheck, number> = {
  compromisedWebsite: 5, vulnerable: 5, reused: 3, weak: 3, unsecured: 1, inactive2fa: 1, expiring: 1, duplicate: 0.5,
};
const DAY = 86_400_000;

function isPrivateHost(host: string): boolean {
  return host === 'localhost' || host.endsWith('.local') || host.endsWith('.lan') || /^(10|127)\./.test(host)
    || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

/** Parses expiry formats: YYYY-MM-DD, YYYY-MM, MM/YY, MM/YYYY. Returns the last millisecond of that day or month (UTC). */
export function parseExpiry(v: string): number | null {
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3] + 1) - 1;
  m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return Date.UTC(+m[1], +m[2], 1) - 1;
  m = s.match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/);
  if (m) {
    const y = m[2].length === 2 ? 2000 + +m[2] : +m[2];
    return Date.UTC(y, +m[1], 1) - 1;
  }
  return null;
}

export async function runWatchtower(
  data: VaultData,
  online: OnlineChecks = {},
  now = Date.now(),
  onPwned?: (sha1: string, count: number) => void,
): Promise<WatchtowerReport> {
  const active = data.items.filter(i => i.state === 'active');
  const issues: WatchtowerIssue[] = [];
  const add = (item: Item, check: WatchtowerCheck, detail: string) => {
    if (!item.watchtowerIgnore.includes(check)) issues.push({ check, itemId: item.id, detail });
  };

  // Passwords: weak, reused, vulnerable
  const byPassword = new Map<string, Item[]>();
  for (const item of active) {
    const pw = fieldByPurpose(item, 'password')?.value;
    if (!pw) continue;
    byPassword.set(pw, [...(byPassword.get(pw) ?? []), item]);
    if (isWeak(pw)) add(item, 'weak', 'This password is easy to guess.');
  }
  for (const items of byPassword.values()) {
    if (items.length > 1) {
      const others = items.length - 1;
      items.forEach(i => add(i, 'reused', `This password is also used by ${others} other item${others > 1 ? 's' : ''}.`));
    }
  }
  let vulnerableOnline = false;
  if (online.pwnedCount) {
    vulnerableOnline = true;
    for (const [pw, items] of byPassword) {
      const h = sha1(pw);
      let count: number | undefined = data.pwnedCache[h];
      if (count === undefined) {
        try {
          count = await online.pwnedCount(h);
          onPwned?.(h, count);
        } catch {
          vulnerableOnline = false;
          continue;
        }
      }
      const n = count;
      if (n > 0) items.forEach(i => add(i, 'vulnerable', `This password has appeared in ${n.toLocaleString('en-US')} data breaches.`));
    }
  }

  // Websites: unsecured, compromised, 2FA
  let breaches: { domain: string; breachDate: string; name: string }[] = [];
  let compromisedOnline = false;
  if (online.breaches) {
    try { breaches = (await online.breaches()).filter(b => b.domain); compromisedOnline = true; } catch { /* offline */ }
  }
  let twoFa = BUILTIN_2FA_DOMAINS;
  let twoFaOnline = false;
  if (online.twoFactorDomains) {
    try { twoFa = new Set([...BUILTIN_2FA_DOMAINS, ...(await online.twoFactorDomains())]); twoFaOnline = true; } catch { /* offline */ }
  }
  const breachByDomain = new Map(breaches.map(b => [b.domain.toLowerCase(), b]));

  for (const item of active) {
    const hosts = item.urls.map(u => ({ raw: u.url, host: domainOf(u.url) })).filter(h => h.host);
    if (hosts.some(h => /^http:\/\//i.test(h.raw) && !isPrivateHost(h.host))) {
      add(item, 'unsecured', 'This website address uses HTTP, which is not encrypted.');
    }
    if (item.category !== 'login') continue;
    const hasOtp = allFields(item).some(f => f.type === 'totp' && f.value);
    if (!hasOtp && hosts.some(h => twoFa.has(h.host) || twoFa.has(baseDomain(h.host)))) {
      add(item, 'inactive2fa', 'This website supports two-factor authentication with one-time passwords.');
    }
    for (const h of hosts) {
      const b = breachByDomain.get(baseDomain(h.host)) ?? breachByDomain.get(h.host);
      if (b && (item.passwordChangedAt ?? item.createdAt) < Date.parse(b.breachDate)) {
        add(item, 'compromisedWebsite', `${b.name} reported a breach on ${b.breachDate}. Change this password.`);
        break;
      }
    }
  }

  // Expiring within 30 days, or already expired
  for (const item of active) {
    const exp = allFields(item).find(f => f.purpose === 'expiry' && f.value);
    const t = exp ? parseExpiry(exp.value) : null;
    if (t !== null && t < now + 30 * DAY) {
      add(item, 'expiring', t < now ? 'This item has expired.' : `This item expires in ${Math.ceil((t - now) / DAY)} days.`);
    }
  }

  // Duplicates: same category + site + username
  const seen = new Map<string, Item>();
  for (const item of active) {
    const user = fieldByPurpose(item, 'username')?.value?.toLowerCase();
    const host = item.urls[0] ? baseDomain(domainOf(item.urls[0].url)) : '';
    if (!user || !host) continue;
    const k = `${item.category}|${host}|${user}`;
    const first = seen.get(k);
    if (first) add(item, 'duplicate', `This looks like a duplicate of "${first.title}".`);
    else seen.set(k, item);
  }

  const counts = Object.fromEntries(Object.keys(WEIGHTS).map(k => [k, 0])) as Record<WatchtowerCheck, number>;
  issues.forEach(i => counts[i.check]++);
  const scorable = Math.max(1, active.filter(i => fieldByPurpose(i, 'password')).length);
  const penalty = issues.reduce((s, i) => s + WEIGHTS[i.check], 0);
  const score = Math.max(0, Math.round(1000 * (1 - penalty / (scorable * 8))));
  const scoreLabel = score > 900 ? 'Excellent' : score > 800 ? 'Very Good' : score > 600 ? 'Good' : score > 400 ? 'Fair' : 'Poor';
  return {
    score, scoreLabel, issues, counts, checkedAt: now,
    online: { vulnerable: vulnerableOnline, compromisedWebsite: compromisedOnline, twoFactor: twoFaOnline },
  };
}
