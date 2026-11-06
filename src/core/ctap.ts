/**
 * CTAP2 for the Windows passkey provider. Windows' WebAuthn platform sends the plugin authenticatorMakeCredential
 * and authenticatorGetAssertion requests as CTAP2 CBOR; the browser and Windows have already built the client
 * data and checked the site's origin against the RP ID, so a request carries only the client data hash.
 * We decode just what we use and answer with the CTAP2 response map.
 */
import { cbor, newCredential, PasskeyError, signAssertion, STRONGROOM_AAGUID, type Cbor, type Passkey } from './passkeys';

// ---------- CBOR decoding (definite lengths; what CTAP2 uses) ----------

export type CborValue = number | bigint | string | Uint8Array | boolean | null | undefined | CborValue[] | Map<CborValue, CborValue>;

export function cborDecode(buf: Uint8Array): CborValue {
  let i = 0;
  const need = (n: number) => { if (i + n > buf.length) throw new Error('CBOR: truncated'); };
  const len = (info: number): number => {
    if (info < 24) return info;
    if (info === 24) { need(1); return buf[i++]; }
    if (info === 25) { need(2); const v = (buf[i] << 8) | buf[i + 1]; i += 2; return v; }
    if (info === 26) { need(4); const v = ((buf[i] << 24) >>> 0) + (buf[i + 1] << 16) + (buf[i + 2] << 8) + buf[i + 3]; i += 4; return v; }
    if (info === 27) { need(8); let v = 0; for (let k = 0; k < 8; k++) v = v * 256 + buf[i + k]; i += 8; return v; }
    throw new Error('CBOR: indefinite lengths are not supported');
  };
  const item = (depth: number): CborValue => {
    if (depth > 16) throw new Error('CBOR: nested too deeply');
    need(1);
    const b = buf[i++], major = b >> 5, info = b & 31;
    switch (major) {
      case 0: return len(info);
      case 1: return -1 - len(info);
      case 2: { const n = len(info); need(n); const v = buf.slice(i, i + n); i += n; return v; }
      case 3: { const n = len(info); need(n); const v = Buffer.from(buf.slice(i, i + n)).toString('utf8'); i += n; return v; }
      case 4: { const n = len(info); const a: CborValue[] = []; for (let k = 0; k < n; k++) a.push(item(depth + 1)); return a; }
      case 5: { const n = len(info); const m = new Map<CborValue, CborValue>(); for (let k = 0; k < n; k++) { const key = item(depth + 1); m.set(key, item(depth + 1)); } return m; }
      case 6: len(info); return item(depth + 1); // tags: ignore the tag
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        if (info === 23) return undefined;
        throw new Error('CBOR: floats are not used in CTAP2');
    }
    throw new Error('CBOR: bad item');
  };
  const v = item(0);
  if (i !== buf.length) throw new Error('CBOR: trailing bytes');
  return v;
}

const asMap = (v: CborValue): Map<CborValue, CborValue> => { if (v instanceof Map) return v; throw new PasskeyError('NotAllowedError', 'Bad request from Windows.'); };
const asBytes = (v: CborValue): Uint8Array => { if (v instanceof Uint8Array) return v; throw new PasskeyError('NotAllowedError', 'Bad request from Windows.'); };
const asText = (v: CborValue): string => (typeof v === 'string' ? v : '');

/** Windows may send the CTAP command byte in front of the CBOR; replies then carry a status byte. */
function unwrap(raw: Uint8Array): { body: Uint8Array; framed: boolean } {
  return raw.length && raw[0] < 0x20 ? { body: raw.subarray(1), framed: true } : { body: raw, framed: false };
}
const wrap = (body: Buffer, framed: boolean) => (framed ? Buffer.concat([Buffer.from([0x00]), body]) : body);

// ---------- requests ----------

export interface CtapMakeCredential {
  clientDataHash: Uint8Array;
  rpId: string;
  rpName?: string;
  user: { id: Uint8Array; name: string; displayName?: string };
  algorithms: number[];
  excludeIds: string[];   // base64url
  framed: boolean;
}

export interface CtapGetAssertion {
  rpId: string;
  clientDataHash: Uint8Array;
  allowIds: string[];     // base64url; empty = any discoverable passkey for the RP
  framed: boolean;
}

const b64u = (u: Uint8Array) => Buffer.from(u).toString('base64url');
const idsOf = (v: CborValue): string[] => (Array.isArray(v) ? v.map(c => b64u(asBytes(asMap(c).get('id')))) : []);

export function parseMakeCredential(raw: Uint8Array): CtapMakeCredential {
  const { body, framed } = unwrap(raw);
  const m = asMap(cborDecode(body));
  const rp = asMap(m.get(2)), user = asMap(m.get(3));
  const rpId = asText(rp.get('id'));
  if (!rpId) throw new PasskeyError('NotAllowedError', 'The request has no site.');
  return {
    clientDataHash: asBytes(m.get(1)), rpId, rpName: asText(rp.get('name')) || undefined,
    user: { id: asBytes(user.get('id')), name: asText(user.get('name')), displayName: asText(user.get('displayName')) || undefined },
    algorithms: Array.isArray(m.get(4)) ? (m.get(4) as CborValue[]).map(p => Number(asMap(p).get('alg'))) : [],
    excludeIds: idsOf(m.get(5)), framed,
  };
}

export function parseGetAssertion(raw: Uint8Array): CtapGetAssertion {
  const { body, framed } = unwrap(raw);
  const m = asMap(cborDecode(body));
  const rpId = asText(m.get(1));
  if (!rpId) throw new PasskeyError('NotAllowedError', 'The request has no site.');
  return { rpId, clientDataHash: asBytes(m.get(2)), allowIds: idsOf(m.get(3)), framed };
}

// ---------- responses ----------

/** Makes the passkey and the authenticatorMakeCredential response (packed "none" attestation). */
export function makeCredentialResponse(req: CtapMakeCredential, now = Date.now()): { passkey: Passkey; response: Buffer } {
  if (!req.algorithms.includes(-7)) throw new PasskeyError('NotSupportedError', 'This site doesn’t accept the passkey type Strongroom makes.');
  const { passkey, authData } = newCredential(req.rpId, req.rpName, req.user, now);
  const response = cbor(new Map<number, Cbor>([[1, 'none'], [2, authData], [3, new Map()]]));
  return { passkey, response: wrap(response, req.framed) };
}

/** The authenticatorGetAssertion response for the passkey the user chose. */
export function getAssertionResponse(req: CtapGetAssertion, passkey: Passkey): Buffer {
  const { authData, signature } = signAssertion(passkey, req.rpId, req.clientDataHash);
  const userId = Buffer.from(passkey.userHandle, 'base64url');
  const user = new Map<string, Cbor>([['id', userId]]);
  if (passkey.userName) user.set('name', passkey.userName);
  if (passkey.userDisplayName) user.set('displayName', passkey.userDisplayName);
  const response = cbor(new Map<number, Cbor>([
    [1, new Map<string, Cbor>([['id', Buffer.from(passkey.credentialId, 'base64url')], ['type', 'public-key']])],
    [2, authData], [3, signature], [4, user],
  ]));
  return wrap(response, req.framed);
}

/** authenticatorGetInfo, which Windows keeps to know what Strongroom supports. */
export function authenticatorInfo(): Buffer {
  return cbor(new Map<number, Cbor>([
    [1, ['FIDO_2_0', 'FIDO_2_1']],
    [3, STRONGROOM_AAGUID],
    [4, new Map<string, Cbor>([['rk', true], ['up', true], ['uv', true]])],
    [9, ['internal']],
    [10, [new Map<string, Cbor>([['alg', -7], ['type', 'public-key']])]],
  ]));
}
