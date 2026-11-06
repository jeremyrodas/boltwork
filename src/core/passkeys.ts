/**
 * Passkeys: Boltwork acts as a WebAuthn authenticator. The browser extension hands us a site's
 * request together with the page origin Chrome reported (never one the page claims), and we answer
 * the way a platform authenticator would. The private key lives in the vault, so it syncs.
 *
 * - Algorithm: ES256 (ECDSA P-256 with SHA-256), the one every relying party accepts.
 * - Attestation: "none". Flags: user present + verified (the vault is unlocked and the user approved),
 *   backup eligible + backed up (synced passkeys). Sign count stays 0, as for other synced passkeys.
 */
import { createHash, createPrivateKey, createPublicKey, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { parse as parseDomain } from 'tldts';

/** A passkey as kept on a login item. */
export interface Passkey {
  credentialId: string;   // base64url
  rpId: string;
  rpName?: string;
  userHandle: string;     // base64url (the site's user.id)
  userName: string;
  userDisplayName?: string;
  privateKey: string;     // PKCS#8 DER, base64url
  algorithm: -7;
  createdAt: number;
  lastUsedAt?: number;
}

/** Identifies Boltwork passkeys to relying parties that show which manager holds them. */
export const BOLTWORK_AAGUID = Buffer.from('5d7a6c1e9b3f4c2aa8e15c0d3b7f9e21', 'hex');

export const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
export const unb64u = (s: string) => Buffer.from(s, 'base64url');
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest();

export class PasskeyError extends Error {
  /** DOMException name to raise in the page. */
  constructor(public domName: 'NotAllowedError' | 'SecurityError' | 'InvalidStateError' | 'NotSupportedError', message: string) { super(message); }
}

// ---------- CBOR (only what WebAuthn needs: ints, bytes, text, maps) ----------

export type Cbor = number | boolean | Uint8Array | string | Cbor[] | Map<number | string, Cbor> | Record<string, never>;

function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  if (n < 0x10000) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
}

export function cbor(v: Cbor): Buffer {
  if (typeof v === 'boolean') return Buffer.from([v ? 0xf5 : 0xf4]);
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
  if (typeof v === 'string') { const s = Buffer.from(v, 'utf8'); return Buffer.concat([head(3, s.length), s]); }
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)]);
  // Canonical CTAP2 order: callers pass map entries already sorted; an empty object is {}.
  const entries = v instanceof Map ? [...v.entries()] : [];
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}

// ---------- relying party checks ----------

export interface Origin { origin: string; host: string }

/** The page origin Chrome reported, if it may use passkeys at all: https, or http on localhost. */
export function checkOrigin(url: string): Origin {
  let u: URL;
  try { u = new URL(url); } catch { throw new PasskeyError('SecurityError', 'This page has no usable address.'); }
  const local = u.hostname === 'localhost' || u.hostname.endsWith('.localhost');
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new PasskeyError('SecurityError', 'Passkeys need a secure (https) page.');
  return { origin: u.origin, host: u.hostname.toLowerCase() };
}

/**
 * The relying party ID a page may use: its own host or a registrable parent of it, but never a public
 * suffix (so example.co.uk can't claim "co.uk", and nothing can claim "com").
 */
export function checkRpId(o: Origin, requested?: string): string {
  const rpId = (requested ?? o.host).toLowerCase();
  if (rpId !== o.host && !o.host.endsWith(`.${rpId}`)) throw new PasskeyError('SecurityError', `This page can’t use passkeys for ${rpId}.`);
  if (rpId === 'localhost' || rpId.endsWith('.localhost')) return rpId;
  const p = parseDomain(rpId, { allowPrivateDomains: true });
  if (p.isIp) { if (rpId !== o.host) throw new PasskeyError('SecurityError', 'Bad relying party.'); return rpId; }
  if (!p.domain || p.publicSuffix === rpId) throw new PasskeyError('SecurityError', `${rpId} isn’t a domain a site can own.`);
  return rpId;
}

// ---------- requests and responses (binary values as base64url) ----------

export interface CreateRequest {
  rp: { id?: string; name?: string };
  user: { id: string; name: string; displayName?: string };
  challenge: string;
  pubKeyCredParams: { type: string; alg: number }[];
  excludeCredentials?: { id: string }[];
  extensions?: { credProps?: boolean };
}

export interface GetRequest {
  rpId?: string;
  challenge: string;
  allowCredentials?: { id: string }[];
}

export interface CreateResponse {
  id: string; rawId: string; type: 'public-key'; authenticatorAttachment: 'platform';
  response: { clientDataJSON: string; attestationObject: string; authenticatorData: string; publicKey: string; publicKeyAlgorithm: -7; transports: string[] };
  clientExtensionResults: { credProps?: { rk: boolean } };
}

export interface GetResponse {
  id: string; rawId: string; type: 'public-key'; authenticatorAttachment: 'platform';
  response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle: string };
  clientExtensionResults: Record<string, never>;
}

const FLAG_UP = 0x01, FLAG_UV = 0x04, FLAG_BE = 0x08, FLAG_BS = 0x10, FLAG_AT = 0x40;

function clientData(type: 'webauthn.create' | 'webauthn.get', challenge: string, origin: string): Buffer {
  // Field order as the WebAuthn spec serializes it.
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8');
}

function validChallenge(c: unknown): string {
  if (typeof c !== 'string' || unb64u(c).length < 16) throw new PasskeyError('NotAllowedError', 'The site sent a bad challenge.');
  return c;
}

/**
 * The authenticator half of making a passkey, shared by the browser extension and the Windows provider:
 * a new key pair and credential ID, and the authenticator data that registers it for `rpId`.
 */
export function newCredential(rpId: string, rpName: string | undefined, user: { id: Uint8Array; name: string; displayName?: string }, now = Date.now()):
  { passkey: Passkey; authData: Buffer; publicKeySpki: Buffer } {
  if (user.id.length < 1 || user.id.length > 64) throw new PasskeyError('NotAllowedError', 'The site sent a bad user ID.');
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const credId = randomBytes(16);
  const cose = cbor(new Map<number, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, unb64u(jwk.x)], [-3, unb64u(jwk.y)]]));
  const idLen = Buffer.alloc(2); idLen.writeUInt16BE(credId.length);
  const authData = Buffer.concat([
    sha256(rpId), Buffer.from([FLAG_UP | FLAG_UV | FLAG_BE | FLAG_BS | FLAG_AT]), Buffer.alloc(4),
    BOLTWORK_AAGUID, idLen, credId, cose,
  ]);
  const passkey: Passkey = {
    credentialId: b64u(credId), rpId, rpName: rpName ? String(rpName).slice(0, 200) : undefined,
    userHandle: b64u(user.id), userName: String(user.name ?? '').slice(0, 200),
    userDisplayName: user.displayName ? String(user.displayName).slice(0, 200) : undefined,
    privateKey: b64u(privateKey.export({ format: 'der', type: 'pkcs8' })), algorithm: -7, createdAt: now,
  };
  return { passkey, authData, publicKeySpki: publicKey.export({ format: 'der', type: 'spki' }) };
}

/** The authenticator half of signing in: authenticator data and its signature over it plus the client data hash. */
export function signAssertion(passkey: Passkey, rpId: string, clientDataHash: Uint8Array): { authData: Buffer; signature: Buffer } {
  if (passkey.rpId !== rpId) throw new PasskeyError('NotAllowedError', 'That passkey is for a different site.');
  const authData = Buffer.concat([sha256(rpId), Buffer.from([FLAG_UP | FLAG_UV | FLAG_BE | FLAG_BS]), Buffer.alloc(4)]);
  const key = createPrivateKey({ key: unb64u(passkey.privateKey), format: 'der', type: 'pkcs8' });
  const signature = createSign('SHA256').update(Buffer.concat([authData, clientDataHash])).sign(key); // DER, as WebAuthn wants
  return { authData, signature };
}

/** Makes a new passkey. The caller asks the user first and saves `passkey` on an item. */
export function createPasskey(req: CreateRequest, o: Origin, now = Date.now()): { passkey: Passkey; response: CreateResponse } {
  const rpId = checkRpId(o, req.rp?.id);
  if (!req.pubKeyCredParams?.some(p => p.type === 'public-key' && p.alg === -7)) throw new PasskeyError('NotSupportedError', 'This site doesn’t accept the passkey type Boltwork makes.');
  const challenge = validChallenge(req.challenge);
  const { passkey, authData, publicKeySpki } = newCredential(rpId, req.rp?.name, { id: unb64u(String(req.user?.id ?? '')), name: req.user?.name, displayName: req.user?.displayName }, now);
  const attestationObject = cbor(new Map<string, Cbor>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
  const cd = clientData('webauthn.create', challenge, o.origin);
  return {
    passkey,
    response: {
      id: passkey.credentialId, rawId: passkey.credentialId, type: 'public-key', authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: b64u(cd), attestationObject: b64u(attestationObject), authenticatorData: b64u(authData),
        publicKey: b64u(publicKeySpki), publicKeyAlgorithm: -7, transports: ['hybrid', 'internal'],
      },
      clientExtensionResults: req.extensions?.credProps ? { credProps: { rk: true } } : {},
    },
  };
}

/** Which of these passkeys the request may use: same RP ID, and in allowCredentials if the site listed any. */
export function usablePasskeys<T extends { passkey: Passkey }>(all: T[], req: GetRequest, o: Origin): T[] {
  const rpId = checkRpId(o, req.rpId);
  const allowed = req.allowCredentials?.length ? new Set(req.allowCredentials.map(c => c.id)) : null;
  return all.filter(x => x.passkey.rpId === rpId && (!allowed || allowed.has(x.passkey.credentialId)));
}

/** Signs in with a passkey the user picked. */
export function assertPasskey(passkey: Passkey, req: GetRequest, o: Origin): GetResponse {
  const rpId = checkRpId(o, req.rpId);
  const challenge = validChallenge(req.challenge);
  const cd = clientData('webauthn.get', challenge, o.origin);
  const { authData, signature } = signAssertion(passkey, rpId, sha256(cd));
  return {
    id: passkey.credentialId, rawId: passkey.credentialId, type: 'public-key', authenticatorAttachment: 'platform',
    response: { clientDataJSON: b64u(cd), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: passkey.userHandle },
    clientExtensionResults: {},
  };
}

/** The public key of a stored passkey (SPKI DER), e.g. to show or verify. */
export function passkeyPublicKey(p: Passkey): Buffer {
  return createPublicKey(createPrivateKey({ key: unb64u(p.privateKey), format: 'der', type: 'pkcs8' })).export({ format: 'der', type: 'spki' });
}
