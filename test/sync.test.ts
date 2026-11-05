import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ready, generateSecretKey, KDF_FAST_FOR_TESTS } from '../src/core/crypto';
import { VaultStore, WrongPasswordError } from '../src/core/store';
import { blankContent } from '../src/core/templates';
import { SyncClient, SyncError, signIn, syncOnce, normalizeServerUrl } from '../src/core/sync';
import { startServer } from '../server/src/server';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sr-sync-'));
const PW = 'correct horse battery';
let server: Awaited<ReturnType<typeof startServer>>;
let dataDir: string;

before(async () => {
  await ready();
  dataDir = tmp();
  server = await startServer({ port: 0, dataDir, signups: 'first', log: () => {} });
});
after(() => server.close());

const note = (title: string, notes = '') => ({ ...blankContent('secureNote'), title, notes });

test('two devices sync items, edits, deletes and conflicts through the server', async () => {
  // Device A: an existing local vault turns on sync (creates the account).
  const sk = generateSecretKey();
  const a = await VaultStore.create(tmp(), PW, sk, KDF_FAST_FOR_TESTS);
  const vaultId = a.snapshot().vaults[0].id;
  const n1 = a.saveItem({ ...note('Wi-Fi', 'hunter2'), vaultId }).id;
  const n2 = a.saveItem({ ...note('Alarm code', '1234'), vaultId }).id;
  const ca = new SyncClient(server.url);
  await ca.signup('me@example.com', await a.authKey(PW, sk), a.keyset(), 'Laptop');
  a.syncState = { serverUrl: server.url, email: 'me@example.com', cursor: 0 };
  assert.deepEqual(await syncOnce(a, ca), { pulled: 0, pushed: 3, conflicts: 0, filesUp: 0, filesDown: 0 });

  // The server holds no plaintext.
  const dbBytes = fs.readFileSync(path.join(dataDir, 'strongroom.db')).toString('latin1') + (fs.existsSync(path.join(dataDir, 'strongroom.db-wal')) ? fs.readFileSync(path.join(dataDir, 'strongroom.db-wal')).toString('latin1') : '');
  assert.ok(!dbBytes.includes('hunter2') && !dbBytes.includes('Wi-Fi'));

  // Sign-ups close after the first account.
  await assert.rejects(new SyncClient(server.url).signup('other@example.com', new Uint8Array(32), a.keyset(), 'X'), (e: SyncError) => e.status === 403);

  // Wrong password or Secret Key can't sign in.
  await assert.rejects(signIn(new SyncClient(server.url), 'me@example.com', 'wrong password!', sk, 'Phone'), (e: SyncError) => e.status === 401);
  await assert.rejects(signIn(new SyncClient(server.url), 'me@example.com', PW, generateSecretKey(), 'Phone'), (e: SyncError) => e.status === 401);

  // Device B: signs in with email, password and Secret Key, and gets everything.
  const cb = new SyncClient(server.url);
  const remote = await signIn(cb, 'me@example.com', PW, sk, 'Desktop');
  const bDir = tmp();
  const b = await VaultStore.createFromRemote(bDir, PW, sk, remote, { serverUrl: server.url, email: 'me@example.com', cursor: 0 });
  await syncOnce(b, cb);
  assert.deepEqual(b.snapshot().items.map(i => i.title).sort(), ['Alarm code', 'Wi-Fi']);
  assert.equal(b.snapshot().vaults[0].id, vaultId);

  // B can lock and unlock its own copy offline with the same password.
  b.lock();
  const b2 = await VaultStore.unlock(bDir, PW, sk);
  assert.equal(b2.snapshot().items.length, 2);

  // Edit on A, delete on B, then both sync.
  const i1 = a.getItem(n1);
  a.saveItem({ ...i1, notes: 'new-wifi-pass', id: n1, vaultId });
  b2.trash(n2); b2.purge(n2);
  await syncOnce(a, ca); await syncOnce(b2, cb); await syncOnce(a, ca);
  assert.equal(a.snapshot().items.length, 1, 'delete reached A');
  assert.equal(b2.getItem(n1).notes, 'new-wifi-pass', 'edit reached B');

  // Conflict: both edit the same item before syncing. The later edit wins; the other is kept in history.
  const ia = a.getItem(n1);
  a.saveItem({ ...ia, notes: 'from A', id: n1, vaultId });
  await new Promise(r => setTimeout(r, 15));
  const ib = b2.getItem(n1);
  b2.saveItem({ ...ib, notes: 'from B (later)', id: n1, vaultId });
  await syncOnce(a, ca);
  const r = await syncOnce(b2, cb);
  assert.equal(r.conflicts, 1);
  await syncOnce(a, ca);
  for (const s of [a, b2]) {
    const it = s.getItem(n1);
    assert.equal(it.notes, 'from B (later)');
    assert.ok(it.history.some(h => h.content.notes === 'from A'), 'losing edit kept in history');
  }

  // Nothing left to send; a quiet sync moves nothing.
  assert.deepEqual(await syncOnce(a, ca), { pulled: 0, pushed: 0, conflicts: 0, filesUp: 0, filesDown: 0 });
  assert.deepEqual(await syncOnce(b2, cb), { pulled: 0, pushed: 0, conflicts: 0, filesUp: 0, filesDown: 0 });

  // Password change on A updates the server; B's old session is signed out, and the new password works.
  const newAuth = await a.changePassword(PW, 'a brand new password', sk, KDF_FAST_FOR_TESTS);
  const ks = a.keyset();
  await ca.updateKeys(newAuth, ks.kdf, ks.wrappedKey);
  await assert.rejects(syncOnce(b2, cb), (e: SyncError) => e.status === 401);
  await assert.rejects(signIn(new SyncClient(server.url), 'me@example.com', PW, sk, 'Phone'), (e: SyncError) => e.status === 401);
  const fresh = await signIn(new SyncClient(server.url), 'me@example.com', 'a brand new password', sk, 'Phone');
  await assert.rejects(VaultStore.createFromRemote(tmp(), PW, sk, fresh, { serverUrl: server.url, email: 'me@example.com', cursor: 0 }), WrongPasswordError);
  const c = await VaultStore.createFromRemote(tmp(), 'a brand new password', sk, fresh, { serverUrl: server.url, email: 'me@example.com', cursor: 0 });
  await syncOnce(c, new SyncClient(server.url, (fresh as { token: string }).token));
  assert.equal(c.getItem(n1).notes, 'from B (later)');
});

test('a server that swaps records between items is caught', async () => {
  const dir = tmp();
  const srv = await startServer({ port: 0, dataDir: dir, log: () => {} });
  try {
    const sk = generateSecretKey();
    const a = await VaultStore.create(tmp(), PW, sk, KDF_FAST_FOR_TESTS);
    const vaultId = a.snapshot().vaults[0].id;
    const x = a.saveItem({ ...note('X', 'x'), vaultId }).id;
    a.saveItem({ ...note('Y', 'y'), vaultId });
    const ca = new SyncClient(srv.url);
    await ca.signup('me@example.com', await a.authKey(PW, sk), a.keyset(), 'Laptop');
    a.syncState = { serverUrl: srv.url, email: 'me@example.com', cursor: 0 };
    await syncOnce(a, ca);
    // A malicious server serves item X's slot with item Y's ciphertext.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path.join(dir, 'strongroom.db'));
    const y = db.prepare("SELECT data FROM records WHERE kind = 'item' AND id != ?").get(x) as { data: string };
    db.prepare('UPDATE records SET data = ?, rev = 999 WHERE id = ?').run(y.data, x);
    db.close();
    const remote = await signIn(new SyncClient(srv.url), 'me@example.com', PW, sk, 'B');
    const b = await VaultStore.createFromRemote(tmp(), PW, sk, remote, { serverUrl: srv.url, email: 'me@example.com', cursor: 0 });
    await assert.rejects(syncOnce(b, new SyncClient(srv.url, (remote as { token: string }).token)));
  } finally { await srv.close(); }
});

test('server URLs: https required except for localhost', () => {
  assert.equal(normalizeServerUrl('vault.example.com/'), 'https://vault.example.com');
  assert.equal(normalizeServerUrl('http://localhost:8787'), 'http://localhost:8787');
  assert.throws(() => normalizeServerUrl('http://vault.example.com'));
});

test('attachments sync as sealed files, and removed ones are cleaned up', async () => {
  const dir = tmp();
  const srv = await startServer({ port: 0, dataDir: dir, signups: 'open', log: () => {} });
  try {
    const sk = generateSecretKey();
    const a = await VaultStore.create(tmp(), PW, sk, KDF_FAST_FOR_TESTS);
    const vaultId = a.snapshot().vaults[0].id;
    const itemId = a.saveItem({ ...note('Passport scan'), vaultId }).id;
    const secret = Buffer.from('%PDF-1.7 top-secret-scan '.repeat(2000));
    const att = a.addAttachment(itemId, 'passport.pdf', 'application/pdf', secret);

    const ca = new SyncClient(srv.url);
    await ca.signup('files@example.com', await a.authKey(PW, sk), a.keyset(), 'Laptop');
    a.syncState = { serverUrl: srv.url, email: 'files@example.com', cursor: 0 };
    const r1 = await syncOnce(a, ca);
    assert.equal(r1.filesUp, 1);

    // The server holds the file only in sealed form.
    const stored = fs.readFileSync(path.join(dir, 'blobs', a.accountId, att.id));
    assert.ok(!stored.toString('latin1').includes('top-secret-scan'));

    // A new device gets the item and the file.
    const cb = new SyncClient(srv.url);
    const b = await VaultStore.createFromRemote(tmp(), PW, sk, await signIn(cb, 'files@example.com', PW, sk, 'Desktop'), { serverUrl: srv.url, email: 'files@example.com', cursor: 0 });
    const r2 = await syncOnce(b, cb);
    assert.equal(r2.filesDown, 1);
    assert.deepEqual(Buffer.from(b.readAttachment(itemId, att.id).bytes), secret);

    // B adds a file; A gets it.
    const att2 = b.addAttachment(itemId, 'notes.txt', 'text/plain', Buffer.from('second file'));
    assert.equal((await syncOnce(b, cb)).filesUp, 1);
    assert.equal((await syncOnce(a, ca)).filesDown, 1);
    assert.equal(Buffer.from(a.readAttachment(itemId, att2.id).bytes).toString(), 'second file');

    // A tampered file from the server is refused: a file sealed for one id can't pass as another.
    assert.throws(() => b.writeAttachmentBlob(att.id, Buffer.from('{"n":"AAAA","c":"BBBB"}')), /damaged/);
    assert.throws(() => b.writeAttachmentBlob(att.id, b.readAttachmentBlob(att2.id)), /damaged/);

    // Edits on both sides at once: both devices' files survive the conflict.
    const att3 = a.addAttachment(itemId, 'a.txt', 'text/plain', Buffer.from('from A'));
    await new Promise(r => setTimeout(r, 15));
    const att4 = b.addAttachment(itemId, 'b.txt', 'text/plain', Buffer.from('from B'));
    await syncOnce(a, ca); await syncOnce(b, cb); await syncOnce(a, ca); await syncOnce(b, cb);
    for (const s of [a, b]) {
      assert.deepEqual(s.getItem(itemId).attachments.map(x => x.id).sort(), [att.id, att2.id, att3.id, att4.id].sort());
      assert.equal(Buffer.from(s.readAttachment(itemId, att3.id).bytes).toString(), 'from A');
      assert.equal(Buffer.from(s.readAttachment(itemId, att4.id).bytes).toString(), 'from B');
    }

    // Removing a file on A removes it from B and, once past the grace period, from the server.
    a.removeAttachment(itemId, att.id);
    await syncOnce(a, ca, { orphanGraceMs: 0 });
    await syncOnce(b, cb, { orphanGraceMs: 0 });
    assert.equal(b.hasAttachmentFile(att.id), false);
    assert.ok(!(await cb.listBlobs()).blobs.some(x => x.id === att.id));
    assert.equal(fs.existsSync(path.join(dir, 'blobs', a.accountId, att.id)), false);

    // Without the grace period passing, a file no item refers to yet is left alone (another device may be mid-upload).
    await cb.putBlob('pendingUpload1', Buffer.from('x'));
    await syncOnce(b, cb);
    assert.ok((await cb.listBlobs()).blobs.some(x => x.id === 'pendingUpload1'));

    // Other accounts can't read this account's files.
    const other = new SyncClient(srv.url);
    const o = await VaultStore.create(tmp(), PW, sk, KDF_FAST_FOR_TESTS);
    await other.signup('other@example.com', await o.authKey(PW, sk), o.keyset(), 'X');
    assert.equal(await other.getBlob(att2.id), null);

    // Deleting the account deletes its files.
    await ca.deleteAccount();
    assert.equal(fs.existsSync(path.join(dir, 'blobs', a.accountId)), false);
  } finally {
    await srv.close();
  }
});
