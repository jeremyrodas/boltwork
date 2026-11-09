/**
 * The synchronous hashing and randomness shared code takes from node:crypto, for the web vault.
 * SHA-256 and SHA-512 come from libsodium (the bridge waits for it before anything runs); SHA-1 is only
 * used for one-time codes and Pwned Passwords lookups. Key generation and signing (SSH keys, passkeys)
 * stay in the apps.
 */
import sodium from 'libsodium-wrappers-sumo';

type Alg = 'sha1' | 'sha256' | 'sha512';
const BLOCK: Record<Alg, number> = { sha1: 64, sha256: 64, sha512: 128 };

function sha1(msg: Uint8Array): Uint8Array {
  const len = msg.length;
  const words = new Uint32Array((((len + 8) >> 6) + 1) * 16);
  for (let i = 0; i < len; i++) words[i >> 2] |= msg[i] << (24 - (i % 4) * 8);
  words[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
  words[words.length - 1] = len * 8;
  words[words.length - 2] = Math.floor((len * 8) / 2 ** 32);
  let [a0, b0, c0, d0, e0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Uint32Array(80);
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));
  for (let i = 0; i < words.length; i += 16) {
    for (let t = 0; t < 80; t++) w[t] = t < 16 ? words[i + t] : rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    let [a, b, c, d, e] = [a0, b0, c0, d0, e0];
    for (let t = 0; t < 80; t++) {
      const f = t < 20 ? (b & c) | (~b & d) : t < 40 ? b ^ c ^ d : t < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const tmp = (rotl(a, 5) + f + e + k + w[t]) >>> 0;
      [e, d, c, b, a] = [d, c, rotl(b, 30) >>> 0, a, tmp];
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0; e0 = (e0 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const view = new DataView(out.buffer);
  [a0, b0, c0, d0, e0].forEach((v, i) => view.setUint32(i * 4, v));
  return out;
}

function digestOf(alg: Alg, msg: Uint8Array): Uint8Array {
  if (alg === 'sha1') return sha1(msg);
  return alg === 'sha256' ? sodium.crypto_hash_sha256(msg) : sodium.crypto_hash_sha512(msg);
}

const bytesOf = (data: string | Uint8Array) => (typeof data === 'string' ? new TextEncoder().encode(data) : data);
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

function checkAlg(alg: string): Alg {
  const a = alg.toLowerCase().replace('-', '');
  if (a !== 'sha1' && a !== 'sha256' && a !== 'sha512') throw new Error(`Unsupported hash ${alg}.`);
  return a;
}

class Hasher {
  private parts: Uint8Array[] = [];
  constructor(private finish: (msg: Uint8Array) => Uint8Array) {}
  update(data: string | Uint8Array, _enc?: string) { this.parts.push(bytesOf(data)); return this; }
  digest(): Uint8Array;
  digest(enc: 'hex' | 'base64' | 'base64url'): string;
  digest(enc?: 'hex' | 'base64' | 'base64url'): Uint8Array | string {
    const out = this.finish(concat(this.parts));
    return enc ? Buffer.from(out).toString(enc) : Buffer.from(out);
  }
}

export function createHash(alg: string) {
  const a = checkAlg(alg);
  return new Hasher(msg => digestOf(a, msg));
}

export function createHmac(alg: string, keyIn: string | Uint8Array) {
  const a = checkAlg(alg);
  return new Hasher(msg => {
    let key = bytesOf(keyIn);
    if (key.length > BLOCK[a]) key = digestOf(a, key);
    const pad = (x: number) => { const p = new Uint8Array(BLOCK[a]).fill(x); key.forEach((b, i) => { p[i] ^= b; }); return p; };
    return digestOf(a, concat([pad(0x5c), digestOf(a, concat([pad(0x36), msg]))]));
  });
}

export function randomBytes(n: number): Uint8Array { return Buffer.from(sodium.randombytes_buf(n)); }

/** A uniform integer in [min, max), like Node's randomInt. */
export function randomInt(minOrMax: number, max?: number): number {
  const [lo, hi] = max === undefined ? [0, minOrMax] : [minOrMax, max];
  return lo + sodium.randombytes_uniform(hi - lo);
}

const appsOnly = () => { throw new Error('SSH keys and passkeys are created in the Boltwork apps, not the web vault.'); };
export const createPrivateKey = appsOnly;
export const createPublicKey = appsOnly;
export const createSign = appsOnly;
export const generateKeyPairSync = appsOnly;
export const sign = appsOnly;
export type KeyObject = never;
