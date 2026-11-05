import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ready, generateSecretKey, KDF_FAST_FOR_TESTS, deriveKek, newKdfParams, randomKey, sealJson, randomId } from '../src/core/crypto';
import { VaultStore } from '../src/core/store';
import { blankContent } from '../src/core/templates';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sr-rec-'));
const readFile = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, 'vault.json'), 'utf8'));
const PW = 'correct horse battery';

async function storeWithItems(n = 2) {
  await ready();
  const dir = tmp();
  const sk = generateSecretKey();
  const s = await VaultStore.create(dir, PW, sk, KDF_FAST_FOR_TESTS);
  const vaultId = s.snapshot().vaults[0].id;
  const ids = Array.from({ length: n }, (_, i) => { const c = blankContent('secureNote'); c.title = `Note ${i}`; c.notes = `secret ${i}`; return s.saveItem({ ...c, vaultId }).id; });
  return { dir, sk, s, ids, vaultId };
}

test('each item is its own sealed record; nothing readable on disk', async () => {
  const { dir, ids } = await storeWithItems();
  const raw = fs.readFileSync(path.join(dir, 'vault.json'), 'utf8');
  assert.ok(!raw.includes('secret 0') && !raw.includes('Note 0'));
  const f = readFile(dir);
  assert.equal(f.version, 2);
  for (const id of ids) assert.ok(f.records.some((r: { id: string; kind: string }) => r.id === id && r.kind === 'item'));
});

test('swapping two records’ ciphertexts is detected', async () => {
  const { dir, sk, s, ids } = await storeWithItems();
  s.lock();
  const f = readFile(dir);
  const a = f.records.find((r: { id: string }) => r.id === ids[0]);
  const b = f.records.find((r: { id: string }) => r.id === ids[1]);
  [a.data, b.data] = [b.data, a.data];
  fs.writeFileSync(path.join(dir, 'vault.json'), JSON.stringify(f));
  await assert.rejects(() => VaultStore.unlock(dir, PW, sk));
});

test('only changed records are re-sealed and marked dirty; deletes leave tombstones', async () => {
  const { dir, sk, s, ids, vaultId } = await storeWithItems(3);
  for (const r of s.records.all()) s.records.markSynced(r.id, 1, r.updatedAt);
  s.writeFile();
  const before = readFile(dir).records;
  const item = s.getItem(ids[1]);
  s.saveItem({ ...item, title: 'Renamed', id: item.id, vaultId });
  s.trash(ids[2]);
  s.purge(ids[2]);
  const after = readFile(dir).records;
  const byId = (rs: { id: string }[], id: string) => rs.find(r => r.id === id) as unknown as { data?: { c: string }; dirty: boolean; deleted?: boolean };
  assert.equal(byId(after, ids[0]).data!.c, byId(before, ids[0]).data!.c, 'untouched item keeps its ciphertext');
  assert.equal(byId(after, ids[0]).dirty, false);
  assert.notEqual(byId(after, ids[1]).data!.c, byId(before, ids[1]).data!.c);
  assert.equal(byId(after, ids[1]).dirty, true);
  assert.equal(byId(after, ids[2]).deleted, true);
  assert.equal(byId(after, ids[2]).data, undefined);
  s.lock();
  const again = await VaultStore.unlock(dir, PW, sk);
  assert.deepEqual(again.snapshot().items.map(i => i.title).sort(), ['Note 0', 'Renamed']);
});

test('a version 1 vault is upgraded on unlock, with the original kept', async () => {
  await ready();
  const dir = tmp();
  const sk = generateSecretKey();
  const kdf = newKdfParams(KDF_FAST_FOR_TESTS);
  const kek = await deriveKek(PW, sk, kdf);
  const key = randomKey();
  const now = Date.now();
  const note = { ...blankContent('secureNote'), title: 'Old note', notes: 'from v1', id: randomId(), vaultId: 'v1', favorite: true, state: 'active',
    createdAt: now, updatedAt: now, useCount: 0, attachments: [], history: [], watchtowerIgnore: [] };
  const data = { vaults: [{ id: 'v1', name: 'Personal', description: '', icon: '🏠', color: '#000', createdAt: now }], items: [note], collections: [], pwnedCache: { abc: 3 }, searchHistory: ['git'] };
  fs.writeFileSync(path.join(dir, 'vault.json'), JSON.stringify({
    format: 'strongroom-vault', version: 1, kdf, wrappedKey: sealJson(kek, Array.from(key), 'strongroom:master-key:v1'),
    data: sealJson(key, data, 'strongroom:vault-data:v1'), savedAt: now,
  }));
  const s = await VaultStore.unlock(dir, PW, sk);
  assert.equal(readFile(dir).version, 2);
  assert.ok(fs.existsSync(path.join(dir, 'vault.v1-backup.json')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'vault.v1-backup.json'), 'utf8')).version, 1);
  s.lock();
  const again = await VaultStore.unlock(dir, PW, sk);
  const snap = again.snapshot();
  assert.equal(snap.items[0].title, 'Old note');
  assert.equal(snap.items[0].favorite, true);
  assert.deepEqual(snap.pwnedCache, { abc: 3 });
  assert.deepEqual(snap.searchHistory, ['git']);
});
