/**
 * Key derivation and authenticated encryption.
 *
 * Two-secret key derivation: the account password is stretched with Argon2id, then mixed with a
 * random 128-bit Secret Key through keyed BLAKE2b. A stolen vault file is useless without both
 * the password and the Secret Key, and the Secret Key makes offline guessing infeasible even for
 * weak passwords. All data is sealed with XChaCha20-Poly1305 and bound to its purpose via AAD.
 */
import sodium from 'libsodium-wrappers-sumo';
import { argon2id } from 'hash-wasm';

export interface KdfParams {
  alg: 'argon2id13';
  salt: string;
  ops: number;
  mem: number;
}

export interface Sealed {
  n: string;
  c: string;
}

export async function ready(): Promise<typeof sodium> {
  await sodium.ready;
  return sodium;
}

/** Argon2id cost: 3 passes over 128 MiB (about 0.6 s on a typical laptop). */
export const KDF_STRONG = { ops: 3, mem: 128 * 1024 * 1024 };
export const KDF_FAST_FOR_TESTS = { ops: 2, mem: 16 * 1024 * 1024 };

const b64 = (u: Uint8Array) => sodium.to_base64(u, sodium.base64_variants.ORIGINAL);
const unb64 = (s: string) => sodium.from_base64(s, sodium.base64_variants.ORIGINAL);
export { b64, unb64 };

export function newKdfParams(cost = KDF_STRONG): KdfParams {
  return { alg: 'argon2id13', salt: b64(sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES)), ...cost };
}

// Crockford base32 without I, L, O, U to avoid look-alikes.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Secret Key: "SR1-" + 26 base32 chars (128 bits), grouped for readability. */
export function generateSecretKey(): string {
  const bytes = sodium.randombytes_buf(16);
  let bits = 0, value = 0, out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  const groups = [out.slice(0, 6), out.slice(6, 11), out.slice(11, 16), out.slice(16, 21), out.slice(21)];
  return `SR1-${groups.join('-')}`;
}

export function normalizeSecretKey(input: string): string {
  const raw = input.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^SR1/, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1');
  if (raw.length !== 26 || [...raw].some(c => !B32.includes(c))) throw new Error('That Secret Key is not valid. It starts with SR1- and has 26 more characters.');
  return `SR1-${raw.slice(0, 6)}-${raw.slice(6, 11)}-${raw.slice(11, 16)}-${raw.slice(16, 21)}-${raw.slice(21)}`;
}

function secretKeyBytes(secretKey: string): Uint8Array {
  return sodium.from_string(normalizeSecretKey(secretKey));
}

async function stretch(password: string, p: KdfParams): Promise<Uint8Array> {
  return argon2id({
    password: password.normalize('NFKD'), salt: unb64(p.salt), iterations: p.ops, memorySize: p.mem / 1024,
    parallelism: 1, hashLength: 32, outputType: 'binary',
  });
}

/** Derives the key-encryption key from password + Secret Key. */
export async function deriveKek(password: string, secretKey: string, p: KdfParams): Promise<Uint8Array> {
  const stretched = await stretch(password, p);
  const kek = sodium.crypto_generichash(32, stretched, secretKeyBytes(secretKey));
  sodium.memzero(stretched);
  return kek;
}

/**
 * Key used to sign in to a sync server: a one-way derivative of the account key, so the server
 * (which stores only a hash of it) learns nothing that can decrypt the vault.
 */
export function authKeyFrom(kek: Uint8Array): Uint8Array {
  return sodium.crypto_generichash(32, sodium.from_string('strongroom:sync-auth:v1'), kek);
}

/** Keyed BLAKE2b-256. */
export function keyedHash(key: Uint8Array, message: Uint8Array): Uint8Array {
  return sodium.crypto_generichash(32, message, key);
}

/** Password-only key (used for encrypted exports, where no Secret Key is involved). */
export function derivePasswordKey(password: string, p: KdfParams): Promise<Uint8Array> {
  return stretch(password, p);
}

export function randomKey(): Uint8Array {
  return sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
}

export function seal(key: Uint8Array, plaintext: Uint8Array, aad: string): Sealed {
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const c = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, sodium.from_string(aad), null, nonce, key);
  return { n: b64(nonce), c: b64(c) };
}

/** Throws if the key is wrong or the data was tampered with. */
export function open(key: Uint8Array, sealed: Sealed, aad: string): Uint8Array {
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, unb64(sealed.c), sodium.from_string(aad), unb64(sealed.n), key);
}

export function sealJson(key: Uint8Array, value: unknown, aad: string): Sealed {
  return seal(key, sodium.from_string(JSON.stringify(value)), aad);
}

export function openJson<T>(key: Uint8Array, sealed: Sealed, aad: string): T {
  return JSON.parse(sodium.to_string(open(key, sealed, aad))) as T;
}

export function wipe(buf: Uint8Array | null | undefined): void {
  if (buf) sodium.memzero(buf);
}

export function randomId(): string {
  return sodium.to_hex(sodium.randombytes_buf(12));
}
