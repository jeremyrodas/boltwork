import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { authenticatorInfo, cborDecode, getAssertionResponse, makeCredentialResponse, parseGetAssertion, parseMakeCredential } from '../src/core/ctap';
import { cbor, BOLTWORK_AAGUID, type Cbor } from '../src/core/passkeys';

const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest();

/** What a browser builds and Windows hashes before calling the plugin. */
function clientData(type: string, challenge: string, origin: string) {
  const json = Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  return { json, hash: sha256(json) };
}

/** An authenticatorMakeCredential request as Windows sends it (optionally with the command byte). */
function makeReq(hash: Buffer, framed: boolean, exclude: Buffer[] = []) {
  const body = cbor(new Map<number, Cbor>([
    [1, hash],
    [2, new Map<string, Cbor>([['id', 'example.com'], ['name', 'Example']])],
    [3, new Map<string, Cbor>([['id', Buffer.from('user-42')], ['name', 'octo'], ['displayName', 'Octo Cat']])],
    [4, [new Map<string, Cbor>([['alg', -7], ['type', 'public-key']]), new Map<string, Cbor>([['alg', -257], ['type', 'public-key']])]],
    ...(exclude.length ? [[5, exclude.map(id => new Map<string, Cbor>([['id', id], ['type', 'public-key']]))] as [number, Cbor]] : []),
    [7, new Map<string, Cbor>([['rk', true], ['uv', true]])],
  ]));
  return framed ? Buffer.concat([Buffer.from([0x01]), body]) : body;
}

for (const framed of [false, true]) {
  test(`Windows provider: CTAP2 make and get, verified like a real site${framed ? ' (with command bytes)' : ''}`, async () => {
    const challenge = b64u(randomBytes(32));
    const cd = clientData('webauthn.create', challenge, 'https://example.com');
    const req = parseMakeCredential(makeReq(cd.hash, framed));
    assert.equal(req.rpId, 'example.com');
    assert.equal(req.user.name, 'octo');
    assert.deepEqual(req.algorithms, [-7, -257]);
    assert.equal(req.framed, framed);

    const { passkey, response } = makeCredentialResponse(req);
    if (framed) assert.equal(response[0], 0x00, 'status byte: success');
    const m = cborDecode(framed ? response.subarray(1) : response) as Map<number, unknown>;
    assert.equal(m.get(1), 'none');
    const authData = Buffer.from(m.get(2) as Uint8Array);

    // What the browser hands the site, rebuilt from the plugin's answer.
    const attestationObject = cbor(new Map<string, Cbor>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
    const reg = await verifyRegistrationResponse({
      response: { id: passkey.credentialId, rawId: passkey.credentialId, type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: b64u(cd.json), attestationObject: b64u(attestationObject) } },
      expectedChallenge: challenge, expectedOrigin: 'https://example.com', expectedRPID: 'example.com', requireUserVerification: true,
    });
    assert.ok(reg.verified);
    assert.equal(reg.registrationInfo!.aaguid, '5d7a6c1e-9b3f-4c2a-a8e1-5c0d3b7f9e21');

    const ch2 = b64u(randomBytes(32));
    const cd2 = clientData('webauthn.get', ch2, 'https://example.com');
    const getBody = cbor(new Map<number, Cbor>([[1, 'example.com'], [2, cd2.hash], [3, [new Map<string, Cbor>([['id', Buffer.from(passkey.credentialId, 'base64url')], ['type', 'public-key']])]]]));
    const getReq = parseGetAssertion(framed ? Buffer.concat([Buffer.from([0x02]), getBody]) : getBody);
    assert.deepEqual(getReq.allowIds, [passkey.credentialId]);
    const out = getAssertionResponse(getReq, passkey);
    const g = cborDecode(framed ? out.subarray(1) : out) as Map<number, Map<string, unknown> | Uint8Array>;
    const cred = g.get(1) as Map<string, unknown>, user = g.get(4) as Map<string, unknown>;
    assert.equal(b64u(cred.get('id') as Uint8Array), passkey.credentialId);
    assert.equal(Buffer.from(user.get('id') as Uint8Array).toString(), 'user-42');
    const auth = await verifyAuthenticationResponse({
      response: { id: passkey.credentialId, rawId: passkey.credentialId, type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: b64u(cd2.json), authenticatorData: b64u(g.get(2) as Uint8Array), signature: b64u(g.get(3) as Uint8Array), userHandle: b64u(user.get('id') as Uint8Array) } },
      expectedChallenge: ch2, expectedOrigin: 'https://example.com', expectedRPID: 'example.com',
      credential: { id: reg.registrationInfo!.credential.id, publicKey: reg.registrationInfo!.credential.publicKey, counter: 0 }, requireUserVerification: true,
    });
    assert.ok(auth.verified);
  });
}

test('Windows provider: exclude lists, unsupported algorithms and bad input', () => {
  const id = randomBytes(16);
  assert.deepEqual(parseMakeCredential(makeReq(randomBytes(32), false, [id])).excludeIds, [b64u(id)]);
  const rsaOnly = cbor(new Map<number, Cbor>([[1, randomBytes(32)], [2, new Map<string, Cbor>([['id', 'x.com']])], [3, new Map<string, Cbor>([['id', Buffer.from('u')], ['name', 'u']])], [4, [new Map<string, Cbor>([['alg', -257], ['type', 'public-key']])]]]));
  assert.throws(() => makeCredentialResponse(parseMakeCredential(rsaOnly)), (e: { domName: string }) => e.domName === 'NotSupportedError');
  assert.throws(() => parseMakeCredential(Buffer.from([0xa1, 0x01])), /truncated/);
  assert.throws(() => parseGetAssertion(cbor(new Map<number, Cbor>([[2, randomBytes(32)]]))));
});

test('Windows provider: authenticatorGetInfo matches the shape Microsoft’s sample registers', () => {
  // The sample's bytes without its extensions entry (key 2), with Boltwork's AAGUID.
  const expected = 'a5' + '0182684649444f5f325f30684649444f5f325f31' + '0350' + BOLTWORK_AAGUID.toString('hex')
    + '04a362726bf5627570f5627576f5098168696e7465726e616c0a81a263616c672664747970656a7075626c69632d6b6579';
  assert.equal(authenticatorInfo().toString('hex'), expected);
});

// The provider only starts on Windows (it serves a Windows named pipe).
test('Windows provider pipe: what the helper sends gets approved, answered and saved', { skip: process.platform !== 'win32' }, async () => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path'); const net = await import('node:net');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-prov-'));
  process.env.LOCALAPPDATA = tmp; // where it writes its launch details
  process.env.BOLTWORK_PASSKEY_SOCK = process.platform === 'win32' ? ['', '', '.', 'pipe', `boltwork-passkeys-test-${process.pid}`].join(String.fromCharCode(92)) : path.join(tmp, 'p.sock');
  const { ready, generateSecretKey, KDF_FAST_FOR_TESTS } = await import('../src/core/crypto');
  const { VaultStore } = await import('../src/core/store');
  const prov = await import('../src/main/passkeyProvider');
  await ready();
  const store = await VaultStore.create(path.join(tmp, 'v'), 'correct horse battery', generateSecretKey(), KDF_FAST_FOR_TESTS);
  let locked = false; let decision: { action: 'ok'; index: number } | { action: 'cancel' } = { action: 'ok', index: 0 };
  const prompts: { kind: string; allowFallback?: boolean; accounts: string[] }[] = [];
  prov.startPasskeyProvider({
    store: () => (locked ? null : store), approve: async p => { prompts.push(p); return decision; }, waitForUnlock: async () => !locked,
    onChanged: () => {}, userData: tmp, launch: { command: 'x', args: [], cwd: tmp },
  });
  await new Promise(r => setTimeout(r, 200));
  try {
  assert.ok(fs.existsSync(path.join(tmp, 'Boltwork', 'passkey-provider.json')), 'launch details saved for the helper');

  const ask = (msg: object) => new Promise<Record<string, string | boolean>>((resolve, reject) => {
    const c = net.connect(process.env.BOLTWORK_PASSKEY_SOCK!);
    let out = '';
    c.on('data', d => { out += d; }); c.on('end', () => resolve(JSON.parse(out))); c.on('error', reject);
    c.write(`${JSON.stringify(msg)}\n`);
  });

  assert.deepEqual(await ask({ op: 'lock' }), { locked: false });
  const challenge = b64u(randomBytes(32));
  const cd = clientData('webauthn.create', challenge, 'https://example.com');
  const made = await ask({ op: 'make', request: makeReq(cd.hash, false).toString('base64') });
  assert.ok(made.response, JSON.stringify(made));
  assert.equal(prompts.at(-1)!.allowFallback, false, 'no "Use another device": Windows already chose Boltwork');
  const saved = store.passkeysFor('example.com');
  assert.equal(saved.length, 1);

  // The same account again is refused as already existing.
  const again = await ask({ op: 'make', request: makeReq(cd.hash, false, [Buffer.from(saved[0].passkey.credentialId, 'base64url')]).toString('base64') });
  assert.equal(again.error, 'exists');

  const cd2 = clientData('webauthn.get', b64u(randomBytes(32)), 'https://example.com');
  const getReq = cbor(new Map<number, Cbor>([[1, 'example.com'], [2, cd2.hash]])).toString('base64');
  const got = await ask({ op: 'get', request: getReq });
  assert.ok(got.response);
  assert.deepEqual(prompts.at(-1)!.accounts, ['Octo Cat'].map(() => 'octo'));

  decision = { action: 'cancel' };
  assert.equal((await ask({ op: 'get', request: getReq })).error, 'cancelled');
  assert.equal((await ask({ op: 'get', request: cbor(new Map<number, Cbor>([[1, 'nowhere.com'], [2, cd2.hash]])).toString('base64') })).error, 'not-found');
  assert.equal((await ask({ op: 'make', request: Buffer.from('nonsense').toString('base64') })).error, 'failed');
  locked = true;
  assert.deepEqual(await ask({ op: 'lock' }), { locked: true });
  assert.equal((await ask({ op: 'get', request: getReq })).error, 'cancelled', 'locked and not unlocked: refused');
  } finally { prov.stopPasskeyProvider(); }

  // The logo Windows shows is a well-formed SVG in the chosen scheme.
  const svg = prov.markSvg('verdigris');
  assert.match(svg, /^<svg [^>]*viewBox="0 0 72 72">/);
  assert.ok(svg.includes('#5fb8a3') && svg.endsWith('</svg>'));
});
