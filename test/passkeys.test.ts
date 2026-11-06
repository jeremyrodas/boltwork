import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { assertPasskey, cbor, checkOrigin, checkRpId, createPasskey, PasskeyError, usablePasskeys, type CreateRequest } from '../src/core/passkeys';

const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const challenge = () => b64u(randomBytes(32));

const createReq = (over: Partial<CreateRequest> = {}): CreateRequest => ({
  rp: { id: 'example.com', name: 'Example' },
  user: { id: b64u(Buffer.from('user-123')), name: 'octo@example.com', displayName: 'Octo' },
  challenge: challenge(),
  pubKeyCredParams: [{ type: 'public-key', alg: -8 }, { type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
  extensions: { credProps: true },
  ...over,
});

test('a new passkey passes a real relying party’s registration check, and signs in', async () => {
  const origin = checkOrigin('https://login.example.com/signup');
  const req = createReq();
  const { passkey, response } = createPasskey(req, origin);

  const reg = await verifyRegistrationResponse({
    response: response as never, expectedChallenge: req.challenge, expectedOrigin: 'https://login.example.com',
    expectedRPID: 'example.com', requireUserVerification: true,
  });
  assert.equal(reg.verified, true);
  const info = reg.registrationInfo!;
  assert.equal(info.credentialDeviceType, 'multiDevice', 'reported as a synced passkey');
  assert.equal(info.credentialBackedUp, true);
  assert.equal(info.credential.id, passkey.credentialId);
  assert.equal(response.clientExtensionResults.credProps?.rk, true);

  // Two sign-ins in a row, each verified as the site would.
  for (let i = 0; i < 2; i++) {
    const getReq = { rpId: 'example.com', challenge: challenge(), allowCredentials: [{ id: passkey.credentialId }] };
    const resp = assertPasskey(passkey, getReq, checkOrigin('https://example.com/login'));
    const auth = await verifyAuthenticationResponse({
      response: resp as never, expectedChallenge: getReq.challenge, expectedOrigin: 'https://example.com', expectedRPID: 'example.com',
      credential: { id: info.credential.id, publicKey: info.credential.publicKey, counter: 0 }, requireUserVerification: true,
    });
    assert.equal(auth.verified, true);
    assert.equal(Buffer.from(resp.response.userHandle, 'base64url').toString(), 'user-123');
  }
});

test('a signature for one challenge or origin does not verify for another', async () => {
  const o = checkOrigin('https://example.com');
  const req = createReq();
  const { passkey, response } = createPasskey(req, o);
  const reg = await verifyRegistrationResponse({ response: response as never, expectedChallenge: req.challenge, expectedOrigin: o.origin, expectedRPID: 'example.com' });
  const getReq = { challenge: challenge() };
  const resp = assertPasskey(passkey, getReq, o);
  const cred = { id: reg.registrationInfo!.credential.id, publicKey: reg.registrationInfo!.credential.publicKey, counter: 0 };
  await assert.rejects(verifyAuthenticationResponse({ response: resp as never, expectedChallenge: challenge(), expectedOrigin: o.origin, expectedRPID: 'example.com', credential: cred }));
  await assert.rejects(verifyAuthenticationResponse({ response: resp as never, expectedChallenge: getReq.challenge, expectedOrigin: 'https://evil.example', expectedRPID: 'example.com', credential: cred }));
});

test('pages may only use passkeys for their own site', () => {
  const rejects = (url: string, rpId?: string) => assert.throws(() => checkRpId(checkOrigin(url), rpId), PasskeyError, `${url} → ${rpId}`);
  assert.equal(checkRpId(checkOrigin('https://accounts.example.co.uk'), 'example.co.uk'), 'example.co.uk');
  assert.equal(checkRpId(checkOrigin('https://github.com')), 'github.com');
  assert.equal(checkRpId(checkOrigin('http://localhost:3000')), 'localhost');
  rejects('https://example.co.uk', 'co.uk');            // a public suffix
  rejects('https://evil.com', 'github.com');            // someone else's domain
  rejects('https://notgithub.com', 'github.com');       // suffix match without a dot
  rejects('https://example.com', 'login.example.com');  // a child of the page's host
  rejects('https://someone.github.io', 'github.io');    // a private public suffix (each user owns a subdomain)
  assert.throws(() => checkOrigin('http://example.com'), PasskeyError, 'plain http');
  assert.throws(() => checkOrigin('file:///C:/x.html'), PasskeyError);
});

test('requests Boltwork can’t serve are refused clearly', () => {
  const o = checkOrigin('https://example.com');
  assert.throws(() => createPasskey(createReq({ pubKeyCredParams: [{ type: 'public-key', alg: -257 }] }), o), (e: PasskeyError) => e.domName === 'NotSupportedError');
  assert.throws(() => createPasskey(createReq({ challenge: 'short' }), o), (e: PasskeyError) => e.domName === 'NotAllowedError');
  assert.throws(() => createPasskey(createReq({ user: { id: '', name: 'x' } }), o));
});

test('only passkeys for the requested site (and allowed IDs) are offered', () => {
  const o = checkOrigin('https://example.com');
  const a = { passkey: createPasskey(createReq(), o).passkey };
  const b = { passkey: createPasskey(createReq(), o).passkey };
  const other = { passkey: createPasskey(createReq({ rp: { id: 'other.com' } }), checkOrigin('https://other.com')).passkey };
  assert.deepEqual(usablePasskeys([a, b, other], { challenge: challenge() }, o).length, 2);
  assert.deepEqual(usablePasskeys([a, b, other], { challenge: challenge(), allowCredentials: [{ id: b.passkey.credentialId }] }, o), [b]);
  assert.throws(() => assertPasskey(other.passkey, { challenge: challenge() }, o));
});

test('CBOR encodes the values WebAuthn uses', () => {
  assert.equal(cbor(10).toString('hex'), '0a');
  assert.equal(cbor(-7).toString('hex'), '26');
  assert.equal(cbor(500).toString('hex'), '1901f4');
  assert.equal(cbor('fmt').toString('hex'), '63666d74');
  assert.equal(cbor(new Uint8Array([1, 2])).toString('hex'), '420102');
  assert.equal(cbor(new Map()).toString('hex'), 'a0');
});

test('passkeys are saved on the matching login, or a new one, and survive conflicting edits', async () => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const { ready, generateSecretKey, KDF_FAST_FOR_TESTS } = await import('../src/core/crypto');
  const { VaultStore } = await import('../src/core/store');
  const { blankContent } = await import('../src/core/templates');
  await ready();
  const s = await VaultStore.create(fs.mkdtempSync(path.join(os.tmpdir(), 'sr-pk-')), 'correct horse battery', generateSecretKey(), KDF_FAST_FOR_TESTS);
  const vaultId = s.snapshot().vaults[0].id;
  const login = blankContent('login');
  login.title = 'GitHub'; login.urls = [{ label: 'website', url: 'https://github.com/login' }];
  login.fields.find(f => f.purpose === 'username')!.value = 'octo';
  const gh = s.saveItem({ ...login, vaultId });

  const o = checkOrigin('https://github.com');
  const pk1 = createPasskey(createReq({ rp: { id: 'github.com', name: 'GitHub' }, user: { id: b64u(Buffer.from('1')), name: 'octo' } }), o).passkey;
  assert.equal(s.addPasskey(pk1).id, gh.id, 'attached to the existing GitHub login for that user');
  const pk2 = createPasskey(createReq({ rp: { id: 'github.com', name: 'GitHub' }, user: { id: b64u(Buffer.from('2')), name: 'second-account' } }), o).passkey;
  const other = s.addPasskey(pk2);
  assert.notEqual(other.id, gh.id, 'a different account gets its own login');
  assert.equal(other.title, 'GitHub');
  assert.equal(s.passkeysFor('github.com').length, 2);
  assert.equal(s.passkeysFor('gitlab.com').length, 0);
  assert.ok(s.passkeyIds().has(pk1.credentialId));

  // What the prompt offers: the site's logins, the same account first and suggested; "new" when none match.
  const t = s.passkeyTargets('github.com', 'octo');
  assert.equal(t.suggested, gh.id);
  assert.equal(t.targets[0].itemId, gh.id);
  assert.ok(t.targets[0].sameAccount);
  assert.equal(t.targets[0].passkeys, 1);
  assert.equal(s.passkeyTargets('github.com', 'someone-else').suggested, 'new');
  assert.deepEqual(s.passkeyTargets('gitlab.com', 'octo'), { targets: [], suggested: 'new' });
  // The user's choice wins: onto a chosen login (even another account's), or a new login.
  const pk3 = createPasskey(createReq({ rp: { id: 'github.com', name: 'GitHub' }, user: { id: b64u(Buffer.from('3')), name: 'third' } }), o).passkey;
  assert.equal(s.addPasskey(pk3, undefined, gh.id).id, gh.id);
  const pk4 = createPasskey(createReq({ rp: { id: 'github.com', name: 'GitHub' }, user: { id: b64u(Buffer.from('4')), name: 'octo' } }), o).passkey;
  const fresh = s.addPasskey(pk4, undefined, 'new');
  assert.ok(fresh.id !== gh.id && fresh.id !== other.id);
  assert.throws(() => s.addPasskey(pk4, undefined, 'not-an-item'), /no longer in your vault/);
  s.removePasskey(gh.id, pk3.credentialId);
  s.trash(fresh.id);

  // Editing the login in the editor (which doesn't know about passkeys) keeps them.
  const edited = s.getItem(gh.id);
  s.saveItem({ ...edited, notes: 'edited', id: gh.id, vaultId });
  assert.equal(s.getItem(gh.id).passkeys?.length, 1);

  s.markPasskeyUsed(gh.id, pk1.credentialId);
  assert.ok(s.getItem(gh.id).passkeys![0].lastUsedAt);
  s.removePasskey(gh.id, pk1.credentialId);
  assert.equal(s.getItem(gh.id).passkeys?.length, 0);
  assert.equal(s.passkeysFor('github.com').length, 1);
  // Restoring an older version of the item doesn't bring a removed passkey back.
  s.restoreVersion(gh.id, 0);
  assert.equal(s.getItem(gh.id).passkeys?.length, 0);
});
