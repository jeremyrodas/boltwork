/**
 * Optional online lookups for Watchtower. Each one is off until the user turns it on in Settings > Privacy.
 * - Pwned Passwords uses k-anonymity: only the first 5 hex chars of a SHA-1 hash leave the device.
 * - The breach list and 2FA directory are public lists downloaded whole; nothing about your items is sent.
 */
import type { OnlineChecks } from './watchtower';

/** Where the downloaded lists are kept for a day (a folder in the app, memory in the web vault). */
export interface ListCache {
  get(name: string): unknown | undefined;
  set(name: string, value: unknown): void;
}

const UA = { 'User-Agent': 'Boltwork-Password-Manager' };

async function cachedJson<T>(cache: ListCache, name: string, url: string): Promise<T> {
  const hit = cache.get(name);
  if (hit !== undefined) return hit as T;
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  const json = (await res.json()) as T;
  cache.set(name, json);
  return json;
}

export function onlineChecks(cache: ListCache, enabled: { vulnerable: boolean; compromised: boolean; twoFactor: boolean }): OnlineChecks {
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
      const list = await cachedJson<{ Name: string; Domain: string; BreachDate: string; IsVerified: boolean }[]>(cache, 'hibp-breaches', 'https://haveibeenpwned.com/api/v3/breaches');
      return list.filter(b => b.IsVerified && b.Domain).map(b => ({ name: b.Name, domain: b.Domain, breachDate: b.BreachDate }));
    };
  }
  if (enabled.twoFactor) {
    checks.twoFactorDomains = async () => {
      const list = await cachedJson<[string, { domain: string; 'additional-domains'?: string[] }][]>(cache, '2fa-directory', 'https://api.2fa.directory/v3/totp.json');
      return new Set(list.flatMap(([, e]) => [e.domain, ...(e['additional-domains'] ?? [])]));
    };
  }
  return checks;
}
