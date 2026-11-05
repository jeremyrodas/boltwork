/**
 * Optional online lookups for Watchtower. Each one is off until the user turns it on in Settings > Privacy.
 * - Pwned Passwords uses k-anonymity: only the first 5 hex chars of a SHA-1 hash leave the device.
 * - The breach list and 2FA directory are public lists downloaded whole; nothing about your items is sent.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { OnlineChecks } from '../core/watchtower';

const UA = { 'User-Agent': 'Strongroom-Password-Manager' };
const DAY = 86_400_000;

async function cachedJson<T>(cacheDir: string, name: string, url: string): Promise<T> {
  const file = path.join(cacheDir, `${name}.json`);
  try {
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs < DAY) return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch { /* no cache yet */ }
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  const json = (await res.json()) as T;
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(json));
  return json;
}

export function onlineChecks(cacheDir: string, enabled: { vulnerable: boolean; compromised: boolean; twoFactor: boolean }): OnlineChecks {
  const checks: OnlineChecks = {};
  if (enabled.vulnerable) {
    const ranges = new Map<string, Map<string, number>>();
    checks.pwnedCount = async (sha1: string) => {
      const prefix = sha1.slice(0, 5), suffix = sha1.slice(5);
      let range = ranges.get(prefix);
      if (!range) {
        const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { ...UA, 'Add-Padding': 'true' }, signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`Pwned Passwords returned ${res.status}`);
        range = new Map((await res.text()).split('\n').map(l => {
          const [s, n] = l.trim().split(':');
          return [s, Number(n)] as [string, number];
        }));
        ranges.set(prefix, range);
      }
      return range.get(suffix) ?? 0;
    };
  }
  if (enabled.compromised) {
    checks.breaches = async () => {
      const list = await cachedJson<{ Name: string; Domain: string; BreachDate: string; IsVerified: boolean }[]>(cacheDir, 'hibp-breaches', 'https://haveibeenpwned.com/api/v3/breaches');
      return list.filter(b => b.IsVerified && b.Domain).map(b => ({ name: b.Name, domain: b.Domain, breachDate: b.BreachDate }));
    };
  }
  if (enabled.twoFactor) {
    checks.twoFactorDomains = async () => {
      const list = await cachedJson<[string, { domain: string; 'additional-domains'?: string[] }][]>(cacheDir, '2fa-directory', 'https://api.2fa.directory/v3/totp.json');
      return new Set(list.flatMap(([, e]) => [e.domain, ...(e['additional-domains'] ?? [])]));
    };
  }
  return checks;
}
