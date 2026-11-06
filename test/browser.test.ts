import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ready, generateSecretKey, KDF_FAST_FOR_TESTS } from '../src/core/crypto';
import { VaultStore } from '../src/core/store';
import { blankContent } from '../src/core/templates';
import { BrowserBridge, matchLogins } from '../src/core/browserBridge';
import { EXTENSION_ID } from '../src/core/extensionId';
import { startBrowserHost, stopBrowserHost } from '../src/main/browserHost';

async function setup(approve = true, passkeyDecision: () => import('../src/core/browserBridge').PasskeyDecision = () => ({ action: 'ok', index: 0 })) {
  await ready();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-br-'));
  const store = await VaultStore.create(dir, 'correct horse battery', generateSecretKey(), KDF_FAST_FOR_TESTS);
  const vaultId = store.snapshot().vaults[0].id;
  const login = (title: string, url: string, user: string, pw: string, totp = '') => {
    const c = blankContent('login');
    c.title = title;
    c.urls = [{ label: 'website', url, primary: true }];
    c.fields.find(f => f.purpose === 'username')!.value = user;
    c.fields.find(f => f.purpose === 'password')!.value = pw;
    c.fields.find(f => f.purpose === 'totp')!.value = totp;
    return store.saveItem({ ...c, vaultId }).id;
  };
  let locked = false;
  const prompts: import('../src/core/browserBridge').PasskeyPrompt[] = [];
  const bridge = new BrowserBridge({
    store: () => (locked ? null : store), pairingsFile: path.join(dir, 'pairings.json'),
    approvePairing: async () => approve, showMain: () => {}, onChanged: () => {}, version: 'test',
    approvePasskey: async p => { prompts.push(p); return passkeyDecision(); },
    waitForUnlock: async () => !locked,
  });
  return { store, bridge, login, dir, prompts, lock: (v: boolean) => { locked = v; } };
}

const ORIGIN = `chrome-extension://${EXTENSION_ID}/`;

function frame(m: object): Buffer {
  const body = Buffer.from(JSON.stringify(m));
  const len = Buffer.alloc(4);
  len.writeUInt32LE(body.length);
  return Buffer.concat([len, body]);
}

/** Runs the native host like Chrome does and collects one reply per message. */
function talk(origin: string, sock: string, msgs: object[]): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve('dist/nmhost.js'), origin], { env: { ...process.env, BOLTWORK_BROWSER_SOCK: sock } });
    let out = Buffer.alloc(0);
    const replies: Record<string, unknown>[] = [];
    const timer = setTimeout(() => { child.kill(); reject(new Error('timeout')); }, 10_000);
    child.stdout.on('data', (d: Buffer) => {
      out = Buffer.concat([out, d]);
      while (out.length >= 4 && out.length >= 4 + out.readUInt32LE(0)) {
        const len = out.readUInt32LE(0);
        replies.push(JSON.parse(out.subarray(4, 4 + len).toString()));
        out = out.subarray(4 + len);
      }
      if (replies.length >= msgs.length) { clearTimeout(timer); child.stdin.end(); resolve(replies); }
    });
    child.on('error', reject);
    for (const m of msgs) child.stdin.write(frame(m));
  });
}

test('matchLogins: same site only, exact host first, http(s) only', async () => {
  const { store, login } = await setup();
  login('Example main', 'https://example.com', 'a', '1');
  login('Example accounts', 'https://accounts.example.com/login', 'b', '2');
  login('Evil', 'https://example.com.evil.net', 'c', '3');
  login('Other', 'https://other.org', 'd', '4');
  const items = store.snapshot().items;
  assert.deepEqual(matchLogins(items, 'https://accounts.example.com/signin').map(m => m.title), ['Example accounts', 'Example main']);
  assert.deepEqual(matchLogins(items, 'https://www.example.com/').map(m => m.title), ['Example main', 'Example accounts']);
  assert.deepEqual(matchLogins(items, 'https://example.com.evil.net/').map(m => m.title), ['Evil']);
  assert.deepEqual(matchLogins(items, 'file:///C:/example.com.html'), []);
});

test('bridge: pairing, locked state, fill domain check, save and update', async () => {
  const { bridge, login, lock, store } = await setup();
  const gh = login('GitHub', 'https://github.com', 'octo', 'old-pass', 'JBSWY3DPEHPK3PXP');
  assert.deepEqual(await bridge.handle({ type: 'status' }, ORIGIN), { error: 'unpaired' });
  assert.deepEqual(await bridge.handle({ type: 'status', token: 'made-up' }, ORIGIN), { error: 'unpaired' });
  const { token } = await bridge.handle({ type: 'pair', code: 'ABC-123', name: 'Chrome' }, ORIGIN) as { token: string };
  assert.ok(token.length > 20);
  const call = (m: object) => bridge.handle({ ...m, token } as never, ORIGIN) as Promise<Record<string, unknown>>;

  assert.deepEqual(await call({ type: 'status' }), { locked: false, version: 'test' });
  lock(true);
  assert.deepEqual(await call({ type: 'matches', url: 'https://github.com/login' }), { locked: true });
  lock(false);

  const m = await call({ type: 'matches', url: 'https://github.com/login' }) as { items: Record<string, unknown>[] };
  assert.equal(m.items[0].id, gh);
  assert.equal(m.items[0].hasTotp, true);
  assert.equal(m.items[0].password, undefined, 'matches never include passwords');

  const filled = await call({ type: 'fill', id: gh, url: 'https://github.com/login' });
  assert.equal(filled.password, 'old-pass');
  assert.match(String(filled.totp), /^\d{6}$/);
  assert.deepEqual(await call({ type: 'fill', id: gh, url: 'https://github.com.evil.net/login' }), { error: 'domain-mismatch' });
  assert.equal((await call({ type: 'fill', id: gh, url: 'https://evil.net', explicit: true })).password, 'old-pass');

  assert.equal((await call({ type: 'checkSave', url: 'https://github.com/session', username: 'octo', password: 'old-pass' })).status, 'same');
  assert.deepEqual(await call({ type: 'checkSave', url: 'https://github.com/session', username: 'octo', password: 'new-pass' }), { status: 'update', id: gh, title: 'GitHub' });
  assert.equal((await call({ type: 'checkSave', url: 'https://github.com/session', username: 'someone-else', password: 'x' })).status, 'new');

  await call({ type: 'update', id: gh, username: 'octo', password: 'new-pass' });
  assert.equal(store.getItem(gh).fields.find(f => f.purpose === 'password')!.value, 'new-pass');
  assert.equal(store.getItem(gh).history.length, 1, 'old password kept in history');

  const saved = await call({ type: 'save', url: 'https://news.example.org/login?next=/', username: 'me', password: 'pw' });
  const item = store.getItem(String(saved.id));
  assert.equal(item.title, 'news.example.org');
  assert.equal(item.urls[0].url, 'https://news.example.org');
});

test('bridge: declined pairing gives no token', async () => {
  const { bridge } = await setup(false);
  assert.deepEqual(await bridge.handle({ type: 'pair', code: 'X', name: 'Chrome' }, ORIGIN), { error: 'denied' });
});

test('native host relays Chrome-framed messages to the app pipe, and only for our extension', async () => {
  const { store, dir } = await setup();
  const sock = process.platform === 'win32' ? `\\\\.\\pipe\\boltwork-test-${process.pid}` : path.join(dir, 'b.sock');
  process.env.BOLTWORK_BROWSER_SOCK = sock;
  let approvals = 0;
  await startBrowserHost({
    store: () => store, pairingsFile: path.join(dir, 'pairings.json'), version: 'test',
    approvePairing: async () => { approvals++; return true; }, showMain: () => {}, onChanged: () => {},
    approvePasskey: async () => ({ action: 'cancel' }), waitForUnlock: async () => true,
  });
  try {
    const [paired] = await talk(ORIGIN, sock, [{ id: 1, msg: { type: 'pair', code: 'A', name: 'Chrome' } }]);
    const token = (paired.body as { token: string }).token;
    assert.ok(token);
    const [st] = await talk(ORIGIN, sock, [{ id: 7, msg: { type: 'status', token } }]);
    assert.deepEqual(st, { id: 7, body: { locked: false, version: 'test' } });
    const [other] = await talk('chrome-extension://abcdefghijklmnopabcdefghijklmnop/', sock, [{ id: 2, msg: { type: 'pair', code: 'A', name: 'Evil' } }]);
    assert.deepEqual(other, { id: 2, body: { error: 'unknown-extension' } });
    assert.equal(approvals, 1, 'other extensions never reach the approval prompt');
  } finally {
    stopBrowserHost();
  }
  // With the app gone, the host answers instead of hanging.
  const [gone] = await talk(ORIGIN, sock, [{ id: 3, msg: { type: 'status' } }]);
  assert.deepEqual(gone, { id: 3, body: { error: 'not-running' } });
});

test('passkeys through the bridge: create and sign in with approval, verified like a real site', async () => {
  const { verifyAuthenticationResponse, verifyRegistrationResponse } = await import('@simplewebauthn/server');
  let decision: import('../src/core/browserBridge').PasskeyDecision = { action: 'ok', index: 0 };
  const { bridge, store, prompts, lock } = await setup(true, () => decision);
  const { token } = await bridge.handle({ type: 'pair', code: 'X', name: 'Chrome' }, ORIGIN) as { token: string };
  const ch = () => Buffer.from(Array.from({ length: 32 }, () => Math.floor(Math.random() * 256))).toString('base64url');
  const createReq = { rp: { id: 'example.com', name: 'Example' }, user: { id: 'dXNlci0x', name: 'octo' }, challenge: ch(), pubKeyCredParams: [{ type: 'public-key', alg: -7 }] };

  const made = await bridge.handle({ token, type: 'passkeyCreate', url: 'https://www.example.com/settings', request: createReq }, ORIGIN) as { response: never };
  assert.equal(prompts.at(-1)?.kind, 'create');
  assert.match(prompts.at(-1)!.site, /example\.com/);
  const reg = await verifyRegistrationResponse({ response: made.response, expectedChallenge: createReq.challenge, expectedOrigin: 'https://www.example.com', expectedRPID: 'example.com' });
  assert.ok(reg.verified);
  assert.equal(store.passkeysFor('example.com').length, 1);

  // The same account again: excluded.
  const again = await bridge.handle({ token, type: 'passkeyCreate', url: 'https://example.com', request: { ...createReq, challenge: ch(), excludeCredentials: [{ id: reg.registrationInfo!.credential.id }] } }, ORIGIN) as { error: { name: string } };
  assert.equal(again.error.name, 'InvalidStateError');

  const getReq = { rpId: 'example.com', challenge: ch() };
  const got = await bridge.handle({ token, type: 'passkeyGet', url: 'https://example.com/login', request: getReq }, ORIGIN) as { response: never };
  assert.equal(prompts.at(-1)?.kind, 'get');
  assert.deepEqual(prompts.at(-1)?.accounts, ['octo']);
  const auth = await verifyAuthenticationResponse({ response: got.response, expectedChallenge: getReq.challenge, expectedOrigin: 'https://example.com', expectedRPID: 'example.com',
    credential: { id: reg.registrationInfo!.credential.id, publicKey: reg.registrationInfo!.credential.publicKey, counter: 0 } });
  assert.ok(auth.verified);

  // The in-page menu: lists accounts without keys, and a picked passkey signs in without another prompt.
  const list = await bridge.handle({ token, type: 'passkeyList', url: 'https://example.com/login', rpId: 'example.com' }, ORIGIN) as { passkeys: { credentialId: string; userName: string }[] };
  assert.deepEqual(list.passkeys.map(p => p.userName), ['octo']);
  assert.ok(!JSON.stringify(list).includes('privateKey'));
  const before = prompts.length;
  const picked = await bridge.handle({ token, type: 'passkeyGet', url: 'https://example.com/login', request: { challenge: ch() }, conditional: true, credentialId: list.passkeys[0].credentialId }, ORIGIN) as { response?: unknown };
  assert.ok(picked.response);
  assert.equal(prompts.length, before);

  // "Use another device" and Cancel.
  decision = { action: 'fallback' };
  assert.deepEqual(await bridge.handle({ token, type: 'passkeyGet', url: 'https://example.com', request: { challenge: ch() } }, ORIGIN), { fallback: true });
  decision = { action: 'cancel' };
  assert.equal((await bridge.handle({ token, type: 'passkeyGet', url: 'https://example.com', request: { challenge: ch() } }, ORIGIN) as { error: { name: string } }).error.name, 'NotAllowedError');

  // A site Boltwork has no passkey for goes to the browser, with no prompt.
  const n = prompts.length;
  assert.deepEqual(await bridge.handle({ token, type: 'passkeyGet', url: 'https://other.com', request: { challenge: ch() } }, ORIGIN), { fallback: true });
  assert.equal(prompts.length, n);

  // Another site can't ask for example.com's passkeys, and plain http is refused.
  assert.equal((await bridge.handle({ token, type: 'passkeyGet', url: 'https://evil.com', request: { rpId: 'example.com', challenge: ch() } }, ORIGIN) as { error: { name: string } }).error.name, 'SecurityError');
  assert.equal((await bridge.handle({ token, type: 'passkeyCreate', url: 'http://example.com', request: createReq }, ORIGIN) as { error: { name: string } }).error.name, 'SecurityError');

  // Locked: silent autofill requests don't pop up the lock screen.
  lock(true);
  assert.deepEqual(await bridge.handle({ token, type: 'passkeyGet', url: 'https://example.com', request: { challenge: ch() }, conditional: true }, ORIGIN), { fallback: true });
  // An unpaired extension gets nothing.
  assert.deepEqual(await bridge.handle({ token: 'nope', type: 'passkeyList', url: 'https://example.com' } as never, ORIGIN), { error: 'unpaired' });
});
