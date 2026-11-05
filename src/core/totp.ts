import { createHmac } from 'node:crypto';

export interface TotpParams {
  secret: Uint8Array;
  algorithm: 'SHA1' | 'SHA256' | 'SHA512';
  digits: number;
  period: number;
  issuer?: string;
  account?: string;
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Uint8Array {
  const s = input.toUpperCase().replace(/[\s=-]/g, '');
  if (!s || [...s].some(c => !B32.includes(c))) throw new Error('The one-time password secret is not valid base32.');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of s) {
    value = (value << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** Accepts an otpauth://totp/ URI or a bare base32 secret. */
export function parseTotp(input: string): TotpParams {
  const v = input.trim();
  if (v.toLowerCase().startsWith('otpauth://')) {
    const url = new URL(v);
    if (url.hostname.toLowerCase() !== 'totp') throw new Error('Only time-based (TOTP) codes are supported.');
    const q = url.searchParams;
    const label = decodeURIComponent(url.pathname.slice(1));
    const [issuerFromLabel, account] = label.includes(':') ? label.split(':', 2) : [undefined, label];
    const algorithm = (q.get('algorithm') ?? 'SHA1').toUpperCase() as TotpParams['algorithm'];
    if (!['SHA1', 'SHA256', 'SHA512'].includes(algorithm)) throw new Error(`Unsupported algorithm ${algorithm}.`);
    return {
      secret: base32Decode(q.get('secret') ?? ''), algorithm,
      digits: Number(q.get('digits') ?? 6), period: Number(q.get('period') ?? 30),
      issuer: q.get('issuer') ?? issuerFromLabel, account: account?.trim(),
    };
  }
  return { secret: base32Decode(v), algorithm: 'SHA1', digits: 6, period: 30 };
}

export function totpAt(p: TotpParams, timeMs: number): string {
  const counter = Math.floor(timeMs / 1000 / p.period);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac(p.algorithm.toLowerCase(), p.secret).update(buf).digest();
  const off = h[h.length - 1] & 15;
  const bin = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** p.digits).padStart(p.digits, '0');
}

export function currentTotp(input: string, now = Date.now()): { code: string; remaining: number; period: number } {
  const p = parseTotp(input);
  return { code: totpAt(p, now), remaining: p.period - (Math.floor(now / 1000) % p.period), period: p.period };
}
