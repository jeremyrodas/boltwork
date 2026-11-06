import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createPublicKey, verify, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateSshKey, importSshKey, sshPublicBlob, sshSign, sshString, SshReader, SSH_AGENT_RSA_SHA2_256 } from '../src/core/ssh';
import { startAgent, type AgentKey } from '../src/core/sshAgent';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'boltwork-ssh-'));
const WIN_OPENSSH = 'C:\\Windows\\System32\\OpenSSH';
const sshKeygen = process.platform === 'win32' && fs.existsSync(`${WIN_OPENSSH}\\ssh-keygen.exe`) ? `${WIN_OPENSSH}\\ssh-keygen.exe` : 'ssh-keygen';
const sshAdd = process.platform === 'win32' && fs.existsSync(`${WIN_OPENSSH}\\ssh-add.exe`) ? `${WIN_OPENSSH}\\ssh-add.exe` : 'ssh-add';
const hasOpenSsh = (() => { try { execFileSync(sshKeygen, ['-?'], { stdio: 'ignore' }); return true; } catch (e) { return (e as { status?: number }).status !== undefined; } })();

/** Restricts a key file to the current user so OpenSSH accepts it. */
function lockDown(file: string) {
  if (process.platform === 'win32') execFileSync('icacls', [file, '/inheritance:r', '/grant:r', `${os.userInfo().username}:F`], { stdio: 'ignore' });
  else fs.chmodSync(file, 0o600);
}

for (const type of ['ed25519', 'rsa3072'] as const) {
  test(`${type}: generated key round-trips and its signatures verify`, () => {
    const k = generateSshKey(type, 'me@laptop');
    assert.match(k.privateKey, /^-----BEGIN OPENSSH PRIVATE KEY-----/);
    assert.ok(k.publicKey.endsWith(' me@laptop'));
    assert.match(k.fingerprint, /^SHA256:[A-Za-z0-9+/]{43}$/);
    const again = importSshKey(k.privateKey);
    assert.equal(again.publicKey, k.publicKey);
    assert.equal(again.fingerprint, k.fingerprint);

    const data = randomBytes(64);
    const sig = new SshReader(sshSign(k.privateKey, data, SSH_AGENT_RSA_SHA2_256));
    const alg = sig.text();
    const raw = sig.string();
    const pem = createPublicKey(importToPem(k.privateKey));
    if (type === 'ed25519') { assert.equal(alg, 'ssh-ed25519'); assert.ok(verify(null, data, pem, raw)); }
    else { assert.equal(alg, 'rsa-sha2-256'); assert.ok(verify('sha256', data, pem, raw)); }
  });
}

/** Public key (as JWK) rebuilt from the SSH wire-format blob. */
function importToPem(openssh: string) {
  const r = new SshReader(sshPublicBlob(openssh));
  const t = r.text();
  if (t === 'ssh-ed25519') return { key: { kty: 'OKP', crv: 'Ed25519', x: r.string().toString('base64url') }, format: 'jwk' as const };
  const e = r.mpint(), n = r.mpint();
  return { key: { kty: 'RSA', e: e.toString('base64url'), n: n.toString('base64url') }, format: 'jwk' as const };
}

test('OpenSSH tools accept our keys, and we accept theirs', { skip: !hasOpenSsh && 'OpenSSH not installed' }, () => {
  const dir = tmp();
  for (const type of ['ed25519', 'rsa3072'] as const) {
    // ours -> ssh-keygen
    const k = generateSshKey(type, 'ours');
    const f = path.join(dir, `ours_${type}`);
    fs.writeFileSync(f, k.privateKey);
    lockDown(f);
    const derived = execFileSync(sshKeygen, ['-y', '-f', f]).toString().trim();
    assert.equal(derived.split(' ').slice(0, 2).join(' '), k.publicKey.split(' ').slice(0, 2).join(' '));

    // ssh-keygen -> ours
    const g = path.join(dir, `theirs_${type}`);
    execFileSync(sshKeygen, ['-q', '-t', type === 'ed25519' ? 'ed25519' : 'rsa', ...(type === 'rsa3072' ? ['-b', '3072'] : []), '-N', '', '-C', 'theirs', '-f', g]);
    const imported = importSshKey(fs.readFileSync(g, 'utf8'));
    assert.equal(imported.publicKey, fs.readFileSync(`${g}.pub`, 'utf8').trim());
    const fp = execFileSync(sshKeygen, ['-l', '-f', `${g}.pub`]).toString().split(' ')[1];
    assert.equal(imported.fingerprint, fp);
  }
});

test('passphrase-protected OpenSSH keys give a clear message', { skip: !hasOpenSsh && 'OpenSSH not installed' }, () => {
  const g = path.join(tmp(), 'locked');
  execFileSync(sshKeygen, ['-q', '-t', 'ed25519', '-N', 'secret phrase', '-f', g]);
  assert.throws(() => importSshKey(fs.readFileSync(g, 'utf8')), /passphrase/);
  assert.throws(() => importSshKey(fs.readFileSync(`${g}.pub`, 'utf8')), /public key/);
});

test('SSH agent lists keys and signs for real OpenSSH clients; denial is respected', { skip: !hasOpenSsh && 'OpenSSH not installed' }, async () => {
  const dir = tmp();
  const ed = generateSshKey('ed25519', 'agent-ed');
  const rsa = generateSshKey('rsa2048', 'agent-rsa');
  const keys: AgentKey[] = [ed, rsa].map((k, i) => ({ id: String(i), blob: sshPublicBlob(k.privateKey), comment: k.publicKey.split(' ')[2] }));
  let allow = true;
  const sock = process.platform === 'win32' ? `\\\\.\\pipe\\boltwork-test-${randomBytes(4).toString('hex')}` : path.join(dir, 'agent.sock');
  const server = await startAgent(sock, {
    listKeys: async () => keys,
    sign: async (key, data, flags) => (allow ? sshSign([ed, rsa][Number(key.id)].privateKey, data, flags) : null),
  });
  const env = { ...process.env, SSH_AUTH_SOCK: sock };
  const run = (cmd: string, args: string[], input?: Buffer) => new Promise<string>((resolve, reject) => {
    const { execFile } = require('node:child_process') as typeof import('node:child_process');
    const child = execFile(cmd, args, { env }, (err, stdout, stderr) => (err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve(stdout)));
    if (input) child.stdin!.end(input); else child.stdin!.end();
  });
  try {
    const listed = await run(sshAdd, ['-L']);
    assert.ok(listed.includes(ed.publicKey) && listed.includes(rsa.publicKey), listed);

    for (const k of [ed, rsa]) {
      const pubFile = path.join(dir, `k${k.keyType[0]}.pub`);
      const msgFile = path.join(dir, 'msg.txt');
      fs.writeFileSync(pubFile, `${k.publicKey}\n`);
      fs.writeFileSync(msgFile, 'hello from boltwork');
      await run(sshKeygen, ['-Y', 'sign', '-f', pubFile, '-n', 'file', msgFile]);
      const out = await run(sshKeygen, ['-Y', 'check-novalidate', '-n', 'file', '-f', pubFile, '-s', `${msgFile}.sig`], fs.readFileSync(msgFile));
      assert.match(out, /Good "file" signature/);
      fs.rmSync(`${msgFile}.sig`);
    }

    allow = false;
    fs.writeFileSync(path.join(dir, 'k.pub'), `${ed.publicKey}\n`);
    await assert.rejects(run(sshKeygen, ['-Y', 'sign', '-f', path.join(dir, 'k.pub'), '-n', 'file', path.join(dir, 'msg.txt')]));
  } finally {
    server.close();
  }
});

test('imports SSH keys from a 1Password .1pux export', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const { zipSync, strToU8 } = await import('fflate');
  const { importFile } = await import('../src/core/importexport');
  const pem = generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const zip = zipSync({ 'export.data': strToU8(JSON.stringify({ accounts: [{ vaults: [{ attrs: { name: 'Private' }, items: [
    { categoryUuid: '114', overview: { title: 'Work laptop key' }, details: { sections: [{ title: '', fields: [{ title: 'private key', id: 'private_key', value: { sshKey: { privateKey: pem, metadata: {} } } }] }] } },
  ] }] }] })) });
  const r = await importFile('export.1pux', zip);
  const f = (id: string) => r.items[0].fields.find(x => x.id === id)!.value;
  assert.equal(r.items[0].category, 'sshKey');
  assert.match(f('privateKey'), /BEGIN OPENSSH PRIVATE KEY/);
  assert.match(f('publicKey'), /^ssh-ed25519 \S+ Work laptop key$/);
  assert.equal(f('keyType'), 'Ed25519');
});

test('imports Ed25519 PKCS#8 v2 keys with an embedded public key (1Password format)', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const jwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' }) as { x: string; d: string };
  const seed = Buffer.from(jwk.d, 'base64url'), pub = Buffer.from(jwk.x, 'base64url');
  const der = Buffer.concat([Buffer.from('3051020101300506032b657004220420', 'hex'), seed, Buffer.from('812100', 'hex'), pub]);
  const pem = `-----BEGIN PRIVATE KEY-----\r\n${der.toString('base64').replace(/.{64}/g, '$&\r\n')}\r\n-----END PRIVATE KEY-----\r\n`;
  const info = importSshKey(pem, undefined, 'homelab');
  assert.equal(info.keyType, 'Ed25519');
  assert.equal(info.publicKey, `ssh-ed25519 ${Buffer.concat([sshString('ssh-ed25519'), sshString(pub)]).toString('base64')} homelab`);
  const sig = new SshReader(sshSign(info.privateKey, Buffer.from('hi')));
  assert.equal(sig.text(), 'ssh-ed25519');
  const bad = Buffer.from(der); bad[bad.length - 1] ^= 1;
  assert.throws(() => importSshKey(`-----BEGIN PRIVATE KEY-----\n${bad.toString('base64')}\n-----END PRIVATE KEY-----`), /does not match/);
});

test('repairSshItems reads keys an older import left raw, orders fields and drops exported passphrases', async () => {
  const { VaultStore } = await import('../src/core/store');
  const { generateSecretKey, KDF_FAST_FOR_TESTS, ready } = await import('../src/core/crypto');
  const { blankContent } = await import('../src/core/templates');
  const { repairSshItems } = await import('../src/core/sshRepair');
  await ready();
  const { generateKeyPairSync } = await import('node:crypto');
  const pem = generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const s = await VaultStore.create(fs.mkdtempSync(path.join(os.tmpdir(), 'sr-')), 'correct horse battery', generateSecretKey(), KDF_FAST_FOR_TESTS);
  const vaultId = s.snapshot().vaults[0].id;
  const c = blankContent('sshKey'); c.title = 'Homelab';
  c.fields = [c.fields.find(f => f.id === 'privateKey')!, ...c.fields.filter(f => f.id !== 'privateKey')]; // old field order
  c.sections = [
    { id: 's0', title: '', fields: [{ id: 'pux0', label: 'private key', type: 'concealed', value: pem }] },
    { id: 's1', title: 'Exported passphrases', fields: [{ id: 'pux1', label: 'exported on 2026-08-26', type: 'concealed', value: 'x' }] },
  ];
  const id = s.saveItem({ ...c, vaultId }).id;
  assert.equal(repairSshItems(s), 1);
  const item = s.getItem(id);
  assert.deepEqual(item.fields.map(f => f.id), ['publicKey', 'fingerprint', 'privateKey', 'keyType']);
  assert.match(item.fields[0].value, /^ssh-ed25519 /);
  assert.equal(item.sections.length, 0);
  assert.equal(item.history.length, 1);
  assert.equal(repairSshItems(s), 0);
});
