/**
 * SSH keys: generate, import (OpenSSH and PEM), export (OpenSSH), fingerprint and sign in the SSH wire format.
 * Supports Ed25519 and RSA, the two key types OpenSSH recommends. All crypto uses Node's built-in `crypto`.
 */
import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

export type SshKeyType = 'ed25519' | 'rsa2048' | 'rsa3072' | 'rsa4096';

export interface SshKeyInfo {
  /** OpenSSH-format private key ("-----BEGIN OPENSSH PRIVATE KEY-----"), unencrypted; it is protected by the vault. */
  privateKey: string;
  /** authorized_keys line: "<type> <base64> <comment>". */
  publicKey: string;
  /** "SHA256:..." as shown by ssh-keygen -l. */
  fingerprint: string;
  /** e.g. "Ed25519" or "RSA 3072-bit". */
  keyType: string;
}

// ---------- SSH wire encoding ----------

const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
export const sshString = (b: Buffer | string) => { const v = typeof b === 'string' ? Buffer.from(b) : b; return Buffer.concat([u32(v.length), v]); };
const mpint = (b: Buffer) => {
  let v = b;
  while (v.length > 1 && v[0] === 0 && !(v[1] & 0x80)) v = v.subarray(1);
  if (v[0] & 0x80) v = Buffer.concat([Buffer.from([0]), v]);
  return sshString(v);
};

export class SshReader {
  private off = 0;
  constructor(private buf: Buffer) {}
  get remaining() { return this.buf.length - this.off; }
  u32(): number { if (this.remaining < 4) throw new Error('Truncated SSH data.'); const v = this.buf.readUInt32BE(this.off); this.off += 4; return v; }
  u8(): number { if (this.remaining < 1) throw new Error('Truncated SSH data.'); return this.buf[this.off++]; }
  bytes(n: number): Buffer { if (this.remaining < n) throw new Error('Truncated SSH data.'); const v = this.buf.subarray(this.off, this.off + n); this.off += n; return v; }
  string(): Buffer { return this.bytes(this.u32()); }
  text(): string { return this.string().toString('utf8'); }
  mpint(): Buffer { const v = this.string(); return v[0] === 0 ? v.subarray(1) : v; }
}

const b64u = (s: string) => Buffer.from(s, 'base64url');
const toB64u = (b: Buffer) => b.toString('base64url');
const big = (b: Buffer) => BigInt(`0x${b.toString('hex') || '0'}`);
const unbig = (n: bigint) => { let h = n.toString(16); if (h.length % 2) h = `0${h}`; return Buffer.from(h, 'hex'); };

// ---------- key <-> parts ----------

interface Ed25519Parts { kind: 'ed25519'; pub: Buffer; seed: Buffer }
interface RsaParts { kind: 'rsa'; n: Buffer; e: Buffer; d: Buffer; p: Buffer; q: Buffer; iqmp: Buffer }
type Parts = Ed25519Parts | RsaParts;

function partsFromKeyObject(key: KeyObject): Parts {
  const jwk = key.export({ format: 'jwk' }) as Record<string, string>;
  if (jwk.kty === 'OKP' && jwk.crv === 'Ed25519') return { kind: 'ed25519', pub: b64u(jwk.x), seed: b64u(jwk.d) };
  if (jwk.kty === 'RSA') return { kind: 'rsa', n: b64u(jwk.n), e: b64u(jwk.e), d: b64u(jwk.d), p: b64u(jwk.p), q: b64u(jwk.q), iqmp: b64u(jwk.qi) };
  throw new Error('Only Ed25519 and RSA keys are supported. ECDSA and DSA keys are not.');
}

function keyObjectFromParts(p: Parts): KeyObject {
  if (p.kind === 'ed25519') return createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', x: toB64u(p.pub), d: toB64u(p.seed) }, format: 'jwk' });
  const d = big(p.d), pp = big(p.p), q = big(p.q);
  return createPrivateKey({
    key: {
      kty: 'RSA', n: toB64u(p.n), e: toB64u(p.e), d: toB64u(p.d), p: toB64u(p.p), q: toB64u(p.q),
      dp: toB64u(unbig(d % (pp - 1n))), dq: toB64u(unbig(d % (q - 1n))), qi: toB64u(p.iqmp),
    },
    format: 'jwk',
  });
}

function publicBlob(p: Parts): Buffer {
  return p.kind === 'ed25519'
    ? Buffer.concat([sshString('ssh-ed25519'), sshString(p.pub)])
    : Buffer.concat([sshString('ssh-rsa'), mpint(p.e), mpint(p.n)]);
}

const wireType = (p: Parts) => (p.kind === 'ed25519' ? 'ssh-ed25519' : 'ssh-rsa');

// ---------- OpenSSH private key format ----------

const MAGIC = Buffer.from('openssh-key-v1\0');

function encodeOpenSsh(p: Parts, comment: string): string {
  const check = randomBytes(4);
  const priv = p.kind === 'ed25519'
    ? Buffer.concat([sshString('ssh-ed25519'), sshString(p.pub), sshString(Buffer.concat([p.seed, p.pub]))])
    : Buffer.concat([sshString('ssh-rsa'), mpint(p.n), mpint(p.e), mpint(p.d), mpint(p.iqmp), mpint(p.p), mpint(p.q)]);
  let section = Buffer.concat([check, check, priv, sshString(comment)]);
  const pad = (8 - (section.length % 8)) % 8;
  section = Buffer.concat([section, Buffer.from(Array.from({ length: pad }, (_, i) => i + 1))]);
  const body = Buffer.concat([MAGIC, sshString('none'), sshString('none'), sshString(''), u32(1), sshString(publicBlob(p)), sshString(section)]);
  const b64 = body.toString('base64').replace(/.{70}/g, '$&\n');
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${b64}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

function decodeOpenSsh(pem: string): { parts: Parts; comment: string } {
  const b64 = pem.replace(/-----(BEGIN|END) OPENSSH PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const buf = Buffer.from(b64, 'base64');
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('This is not an OpenSSH private key.');
  const r = new SshReader(buf.subarray(MAGIC.length));
  const cipher = r.text();
  r.text(); r.string(); // kdf name, kdf options
  if (cipher !== 'none') {
    throw new Error('This key is protected with a passphrase. Remove it first with: ssh-keygen -p -f <keyfile> (leave the new passphrase empty), then import it. Strongroom keeps it encrypted in your vault.');
  }
  if (r.u32() !== 1) throw new Error('Files with more than one key are not supported.');
  r.string(); // public blob
  const s = new SshReader(r.string());
  if (s.u32() !== s.u32()) throw new Error('This key file is corrupted.');
  const type = s.text();
  let parts: Parts;
  if (type === 'ssh-ed25519') {
    const pub = s.string();
    const priv = s.string();
    parts = { kind: 'ed25519', pub, seed: priv.subarray(0, 32) };
  } else if (type === 'ssh-rsa') {
    const n = s.mpint(), e = s.mpint(), d = s.mpint(), iqmp = s.mpint(), p = s.mpint(), q = s.mpint();
    parts = { kind: 'rsa', n, e, d, p, q, iqmp };
  } else {
    throw new Error(`${type} keys are not supported. Use Ed25519 or RSA.`);
  }
  return { parts, comment: s.text() };
}

// ---------- PKCS#8 Ed25519 ----------

const ED25519_OID = Buffer.from('06032b6570', 'hex');
const PKCS8_V1_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/**
 * Reads an unencrypted Ed25519 PKCS#8 key, including the v2 layout with an embedded public key
 * (what 1Password exports). Electron's BoringSSL rejects v2, so this pulls out the 32-byte seed and
 * rebuilds a v1 key. Returns null for anything that is not an Ed25519 PKCS#8 key.
 */
function ed25519FromPkcs8(pem: string): Ed25519Parts | null {
  const m = /-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/.exec(pem);
  if (!m) return null;
  const der = Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
  const oidAt = der.indexOf(ED25519_OID);
  if (oidAt < 0 || oidAt > 16) return null;
  // privateKey is OCTET STRING { OCTET STRING (32-byte seed) }: 04 22 04 20 <seed>
  const at = der.indexOf(Buffer.from('04220420', 'hex'), oidAt + ED25519_OID.length);
  if (at < 0 || der.length < at + 4 + 32) return null;
  const seed = der.subarray(at + 4, at + 36);
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_V1_ED25519_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const parts = partsFromKeyObject(key) as Ed25519Parts;
  // v2 keys carry the public key too: [1] BIT STRING (0x81 0x21 0x00 <32 bytes>). Check it matches.
  const pubAt = der.indexOf(Buffer.from('812100', 'hex'), at + 36);
  if (pubAt >= 0 && !der.subarray(pubAt + 3, pubAt + 35).equals(parts.pub)) throw new Error('This key file is corrupted: its public key does not match the private key.');
  return parts;
}

// ---------- public API ----------

function describe(p: Parts, comment: string): SshKeyInfo {
  const blob = publicBlob(p);
  return {
    privateKey: encodeOpenSsh(p, comment),
    publicKey: `${wireType(p)} ${blob.toString('base64')}${comment ? ` ${comment}` : ''}`,
    fingerprint: `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`,
    keyType: p.kind === 'ed25519' ? 'Ed25519' : `RSA ${p.n.length * 8}-bit`,
  };
}

export function generateSshKey(type: SshKeyType, comment = ''): SshKeyInfo {
  const key = type === 'ed25519'
    ? generateKeyPairSync('ed25519').privateKey
    : generateKeyPairSync('rsa', { modulusLength: Number(type.slice(3)), publicExponent: 0x10001 }).privateKey;
  return describe(partsFromKeyObject(key), comment);
}

/** Imports an OpenSSH or PEM (PKCS#1/PKCS#8, optionally encrypted) private key. */
export function importSshKey(text: string, passphrase?: string, comment?: string): SshKeyInfo {
  const t = text.trim();
  if (t.includes('BEGIN OPENSSH PRIVATE KEY')) {
    const { parts, comment: c } = decodeOpenSsh(t);
    return describe(parts, comment ?? c);
  }
  if (/BEGIN (RSA |ENCRYPTED )?PRIVATE KEY/.test(t)) {
    const ed = ed25519FromPkcs8(t);
    if (ed) return describe(ed, comment ?? '');
    let key: KeyObject;
    try { key = createPrivateKey({ key: t, format: 'pem', passphrase: passphrase || undefined }); }
    catch (e) {
      const msg = (e as Error).message;
      throw new Error(/passphrase|decrypt|bad decrypt/i.test(msg) ? 'Wrong or missing passphrase for this key.' : `Could not read this key: ${msg}`);
    }
    return describe(partsFromKeyObject(key), comment ?? '');
  }
  if (/^(ssh-|ecdsa-)/.test(t)) throw new Error('That is a public key. Import the private key file (the one without .pub).');
  throw new Error('Unrecognized key. Paste an OpenSSH or PEM private key.');
}

/** Wire-format public key blob for a stored private key (what the SSH agent advertises). */
export function sshPublicBlob(privateKey: string): Buffer {
  return publicBlob(decodeOpenSsh(privateKey).parts);
}

export const SSH_AGENT_RSA_SHA2_256 = 2;
export const SSH_AGENT_RSA_SHA2_512 = 4;

/** Signs `data` for the SSH agent protocol. Returns the signature blob (string algorithm, string signature). */
export function sshSign(privateKey: string, data: Buffer, flags = 0): Buffer {
  const { parts } = decodeOpenSsh(privateKey);
  const key = keyObjectFromParts(parts);
  if (parts.kind === 'ed25519') return Buffer.concat([sshString('ssh-ed25519'), sshString(sign(null, data, key))]);
  const [alg, hash] = flags & SSH_AGENT_RSA_SHA2_512 ? ['rsa-sha2-512', 'sha512'] : flags & SSH_AGENT_RSA_SHA2_256 ? ['rsa-sha2-256', 'sha256'] : ['ssh-rsa', 'sha1'];
  return Buffer.concat([sshString(alg), sshString(sign(hash, data, key))]);
}
