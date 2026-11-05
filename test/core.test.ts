import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { ready, generateSecretKey, normalizeSecretKey, KDF_FAST_FOR_TESTS } from '../src/core/crypto';
import { VaultStore, WrongPasswordError } from '../src/core/store';
import { blankContent } from '../src/core/templates';
import { previousPasswords } from '../src/core/passwordHistory';
import { generatePassword, DEFAULT_GENERATOR } from '../src/core/generator';
import { rateStrength } from '../src/core/strength';
import { totpAt, parseTotp, base32Decode } from '../src/core/totp';
import { runWatchtower, parseExpiry } from '../src/core/watchtower';
import { searchItems, parseQuery } from '../src/core/search';
import { importFile, parseCsv, buildExport, encryptExport, exportCsv, NeedsPasswordError } from '../src/core/importexport';
import type { ItemContent } from '../src/core/types';

before(async () => { await ready(); });

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'strongroom-test-'));

function login(title: string, username: string, password: string, url: string): ItemContent {
  const c = blankContent('login');
  c.title = title;
  c.fields.find(f => f.purpose === 'username')!.value = username;
  c.fields.find(f => f.purpose === 'password')!.value = password;
  c.urls = [{ label: 'website', url, primary: true }];
  return c;
}

test('secret key format round-trips and tolerates typos of look-alike characters', async () => {
  const k = generateSecretKey();
  assert.match(k, /^SR1-[0-9A-Z]{6}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}$/);
  assert.equal(normalizeSecretKey(k.toLowerCase().replace(/-/g, ' ')), k);
  assert.throws(() => normalizeSecretKey('SR1-ABC'));
});

test('vault create, unlock, wrong password, wrong secret key, persistence', async () => {
  const dir = tmp();
  const sk = generateSecretKey();
  const s = await VaultStore.create(dir, 'correct horse battery', sk, KDF_FAST_FOR_TESTS);
  const vaultId = s.snapshot().vaults[0].id;
  s.saveItem({ ...login('GitHub', 'me', 'hunter2hunter2', 'https://github.com'), vaultId });
  s.lock();
  assert.throws(() => s.snapshot(), /locked/);

  const raw = fs.readFileSync(path.join(dir, 'vault.json'), 'utf8');
  assert.ok(!raw.includes('GitHub') && !raw.includes('hunter2'), 'vault file must not contain plaintext');

  await assert.rejects(() => VaultStore.unlock(dir, 'wrong password!!', sk), WrongPasswordError);
  await assert.rejects(() => VaultStore.unlock(dir, 'correct horse battery', generateSecretKey()), WrongPasswordError);
  const s2 = await VaultStore.unlock(dir, 'correct horse battery', sk);
  assert.equal(s2.snapshot().items[0].title, 'GitHub');
});

test('tampered vault file is rejected', async () => {
  const dir = tmp();
  const sk = generateSecretKey();
  (await VaultStore.create(dir, 'correct horse battery', sk, KDF_FAST_FOR_TESTS)).lock();
  const file = JSON.parse(fs.readFileSync(path.join(dir, 'vault.json'), 'utf8'));
  const rec = file.records.find((r: { kind: string }) => r.kind === 'vault');
  const c = Buffer.from(rec.data.c, 'base64');
  c[5] ^= 1;
  rec.data.c = c.toString('base64');
  fs.writeFileSync(path.join(dir, 'vault.json'), JSON.stringify(file));
  await assert.rejects(() => VaultStore.unlock(dir, 'correct horse battery', sk));
});

test('item history, password change tracking, trash, restore, purge, attachments', async () => {
  const dir = tmp();
  const sk = generateSecretKey();
  const s = await VaultStore.create(dir, 'correct horse battery', sk, KDF_FAST_FOR_TESTS);
  const vaultId = s.snapshot().vaults[0].id;
  const item = s.saveItem({ ...login('Bank', 'me', 'first-password-1', 'https://bank.example'), vaultId });
  const edited = structuredClone(item);
  edited.fields.find(f => f.purpose === 'password')!.value = 'second-password-2';
  const saved = s.saveItem(edited);
  assert.equal(saved.history.length, 1);
  assert.equal(saved.history[0].content.fields.find(f => f.purpose === 'password')!.value, 'first-password-1');
  const restored = s.restoreVersion(item.id, 0);
  assert.equal(restored.fields.find(f => f.purpose === 'password')!.value, 'first-password-1');
  assert.equal(restored.history.length, 2);

  const att = s.addAttachment(item.id, 'scan.txt', 'text/plain', new TextEncoder().encode('secret scan'));
  assert.ok(!fs.readFileSync(path.join(dir, 'attachments', att.id), 'utf8').includes('secret scan'));
  assert.equal(new TextDecoder().decode(s.readAttachment(item.id, att.id).bytes), 'secret scan');

  s.trash(item.id);
  assert.equal(s.getItem(item.id).state, 'deleted');
  s.restore(item.id);
  assert.equal(s.getItem(item.id).state, 'active');
  s.trash(item.id);
  assert.equal(s.emptyTrash(0), 1);
  assert.equal(s.snapshot().items.length, 0);
  assert.ok(!fs.existsSync(path.join(dir, 'attachments', att.id)));
});

test('change password re-wraps key; old password stops working', async () => {
  const dir = tmp();
  const sk = generateSecretKey();
  const s = await VaultStore.create(dir, 'old password 123', sk, KDF_FAST_FOR_TESTS);
  await assert.rejects(() => s.changePassword('nope nope nope', 'new password 456', sk), WrongPasswordError);
  await s.changePassword('old password 123', 'new password 456', sk);
  await assert.rejects(() => VaultStore.unlock(dir, 'old password 123', sk), WrongPasswordError);
  assert.ok(await VaultStore.unlock(dir, 'new password 456', sk));
});

test('generator respects options', async () => {
  const p = generatePassword({ ...DEFAULT_GENERATOR, length: 32 });
  assert.equal(p.length, 32);
  assert.match(p, /[a-z]/); assert.match(p, /[A-Z]/); assert.match(p, /\d/);
  const noSym = generatePassword({ ...DEFAULT_GENERATOR, symbols: false, digits: false, length: 50 });
  assert.match(noSym, /^[A-Za-z]+$/);
  const words = generatePassword({ ...DEFAULT_GENERATOR, mode: 'words', wordCount: 5, separator: 'hyphens' });
  assert.equal(words.split('-').length, 5);
  assert.match(generatePassword({ ...DEFAULT_GENERATOR, mode: 'pin', pinLength: 8 }), /^\d{8}$/);
});

test('strength ratings are ordered sensibly', async () => {
  assert.equal(rateStrength('').label, 'None');
  assert.ok(rateStrength('password').level <= 2);
  assert.ok(rateStrength('Tr0ub4dor&3').level < rateStrength('vY8#qL2!mZ9@wR4$kT6^').level);
  assert.ok(rateStrength('vY8#qL2!mZ9@wR4$kT6^').level >= 6);
});

test('TOTP matches RFC 6238 test vectors', async () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // "12345678901234567890"
  assert.deepEqual(Buffer.from(base32Decode(secret)).toString(), '12345678901234567890');
  const p = { ...parseTotp(secret), digits: 8 };
  assert.equal(totpAt(p, 59_000), '94287082');
  assert.equal(totpAt(p, 1_111_111_109_000), '07081804');
  const uri = parseTotp('otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example&digits=6&period=30');
  assert.equal(uri.issuer, 'Example');
  assert.equal(uri.account, 'alice@example.com');
});

test('watchtower finds weak, reused, unsecured, 2FA, expiring, duplicate, vulnerable and compromised', async () => {
  const dir = tmp();
  const s = await VaultStore.create(dir, 'correct horse battery', generateSecretKey(), KDF_FAST_FOR_TESTS);
  const vaultId = s.snapshot().vaults[0].id;
  const a = s.saveItem({ ...login('GitHub', 'me', 'password', 'https://github.com'), vaultId });
  const b = s.saveItem({ ...login('GitHub 2', 'me', 'password', 'http://github.com/login'), vaultId });
  const strong = s.saveItem({ ...login('Breached', 'x', 'vY8#qL2!mZ9@wR4$kT6^', 'https://breached.example'), vaultId });
  const card = blankContent('creditCard');
  card.title = 'Old card';
  card.fields.find(f => f.id === 'expiry')!.value = '2020-01';
  const c = s.saveItem({ ...card, vaultId });

  const report = await runWatchtower(s.snapshot(), {
    pwnedCount: async () => 42,
    breaches: async () => [{ domain: 'breached.example', breachDate: '2999-01-01', name: 'Breached Inc' }],
  });
  const has = (id: string, check: string) => report.issues.some(i => i.itemId === id && i.check === check);
  assert.ok(has(a.id, 'weak'));
  assert.ok(has(a.id, 'reused') && has(b.id, 'reused'));
  assert.ok(has(b.id, 'unsecured'));
  assert.ok(has(a.id, 'inactive2fa'));
  assert.ok(has(b.id, 'duplicate'));
  assert.ok(has(a.id, 'vulnerable'));
  assert.ok(has(strong.id, 'compromisedWebsite'));
  assert.ok(!has(strong.id, 'weak'));
  assert.ok(has(c.id, 'expiring'));
  assert.ok(report.score < 1000);

  s.setWatchtowerIgnore(a.id, ['weak']);
  const r2 = await runWatchtower(s.snapshot());
  assert.ok(!r2.issues.some(i => i.itemId === a.id && i.check === 'weak'));
  assert.equal(parseExpiry('03/27'), Date.UTC(2027, 3, 1) - 1);
});

test('smart search filters and ranks', async () => {
  const dir = tmp();
  const s = await VaultStore.create(dir, 'correct horse battery', generateSecretKey(), KDF_FAST_FOR_TESTS);
  const vaultId = s.snapshot().vaults[0].id;
  const gh = s.saveItem({ ...login('GitHub', 'octo', 'x', 'https://github.com'), tags: ['work/dev'], vaultId });
  s.saveItem({ ...login('Gmail', 'me@gmail.com', 'y', 'https://mail.google.com'), tags: ['personal'], vaultId });
  s.setFavorite(gh.id, true);
  const { items, vaults } = s.snapshot();
  assert.deepEqual(searchItems(items, vaults, 'git').map(i => i.title), ['GitHub']);
  assert.deepEqual(searchItems(items, vaults, 'tag:work').map(i => i.title), ['GitHub']);
  assert.deepEqual(searchItems(items, vaults, '-tag:work').map(i => i.title), ['Gmail']);
  assert.deepEqual(searchItems(items, vaults, 'is:favorite').map(i => i.title), ['GitHub']);
  assert.deepEqual(searchItems(items, vaults, 'google').map(i => i.title), ['Gmail']);
  assert.equal(searchItems(items, vaults, 'x').length, 0, 'passwords are never searched');
  assert.deepEqual(parseQuery('vault:"My Stuff" bank').vaults, ['my stuff']);
});

test('CSV parser handles quotes, commas and newlines', async () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","multi\nline ""q"""\n'), [['a', 'b'], ['x, y', 'multi\nline "q"']]);
});

test('imports Chrome CSV, Bitwarden JSON and 1Password 1PUX', async () => {
  const chrome = await importFile('Chrome Passwords.csv', strToU8('name,url,username,password,note\nGitHub,https://github.com/,octo,pw1,hello\n'));
  assert.equal(chrome.items.length, 1);
  assert.equal(chrome.items[0].fields.find(f => f.purpose === 'password')!.value, 'pw1');
  assert.equal(chrome.items[0].notes, 'hello');

  const bw = await importFile('bw.json', strToU8(JSON.stringify({
    encrypted: false, folders: [{ id: 'f1', name: 'Work' }],
    items: [{ type: 1, name: 'Slack', folderId: 'f1', favorite: true, login: { username: 'u', password: 'p', totp: 'JBSWY3DPEHPK3PXP', uris: [{ uri: 'https://slack.com' }] } },
      { type: 3, name: 'Visa', card: { cardholderName: 'Me', number: '4111111111111111', expMonth: '4', expYear: '2030', code: '123' } }],
  })));
  assert.equal(bw.items.length, 2);
  assert.deepEqual(bw.items[0].tags, ['Work']);
  assert.equal(bw.items[0].favorite, true);
  assert.equal(bw.items[1].fields.find(f => f.id === 'expiry')!.value, '2030-04');

  const pux = zipSync({ 'export.data': strToU8(JSON.stringify({ accounts: [{ vaults: [{ attrs: { name: 'Private' }, items: [
    { categoryUuid: '001', favIndex: 1, overview: { title: 'Amazon', url: 'https://amazon.com', tags: ['shopping'] },
      details: { loginFields: [{ designation: 'username', value: 'buyer' }, { designation: 'password', value: 'secret' }], notesPlain: 'n',
        sections: [{ title: '', fields: [{ title: 'one-time password', value: { totp: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' } }, { title: 'PIN', value: { concealed: '9999' } }] }] } },
    { categoryUuid: '106', overview: { title: 'My passport' }, details: { sections: [{ title: '', fields: [{ title: 'number', value: { string: 'X123' } }] }] } },
  ] }] }] })) });
  const r = await importFile('export.1pux', pux);
  assert.equal(r.items.length, 2);
  const amazon = r.items[0];
  assert.equal(amazon.fields.find(f => f.purpose === 'username')!.value, 'buyer');
  assert.ok(amazon.fields.find(f => f.purpose === 'totp')!.value.startsWith('otpauth://'));
  assert.equal(amazon.sections[0].fields[0].label, 'PIN');
  assert.equal(r.items[1].fields.find(f => f.id === 'number')!.value, 'X123');
});

test('exports round-trip, including encrypted export', async () => {
  const dir = tmp();
  const s = await VaultStore.create(dir, 'correct horse battery', generateSecretKey(), KDF_FAST_FOR_TESTS);
  const vaultId = s.snapshot().vaults[0].id;
  s.saveItem({ ...login('Site', 'u', 'p', 'https://site.example'), vaultId });
  const { vaults, items } = s.snapshot();
  const exp = buildExport(vaults, items);
  const enc = JSON.stringify(await encryptExport(exp, 'export pass'));
  assert.ok(!enc.includes('site.example'));
  await assert.rejects(() => importFile('backup.json', strToU8(enc)), NeedsPasswordError);
  await assert.rejects(() => importFile('backup.json', strToU8(enc), 'wrong'), /Incorrect/);
  assert.equal((await importFile('backup.json', strToU8(enc), 'export pass')).items[0].title, 'Site');
  const csv = exportCsv(vaults, items);
  assert.equal((await importFile('x.csv', strToU8(csv))).items[0].fields.find(f => f.purpose === 'password')!.value, 'p');
});

test('importing the same items twice skips the ones already there', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-'));
  const s = await VaultStore.create(dir, 'correct horse battery', generateSecretKey(), KDF_FAST_FOR_TESTS);
  const vaultId = s.snapshot().vaults[0].id;
  const mk = (title: string, pw: string) => { const c = blankContent('login'); c.title = title; c.fields.find(f => f.purpose === 'password')!.value = pw; return c; };
  assert.equal(s.importItems([mk('A', 'one'), mk('B', 'two')], vaultId), 2);
  assert.equal(s.importItems([mk('A', 'one'), mk('B', 'two'), mk('B', 'changed'), mk('C', 'three')], vaultId), 2);
  assert.equal(s.snapshot().items.length, 4);
});

test('countNewItems matches what importItems adds', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-'));
  const s = await VaultStore.create(dir, 'correct horse battery', generateSecretKey(), KDF_FAST_FOR_TESTS);
  const vaultId = s.snapshot().vaults[0].id;
  const mk = (title: string) => { const c = blankContent('secureNote'); c.title = title; c.notes = title; return c; };
  s.importItems([mk('A')], vaultId);
  const batch = [mk('A'), mk('B'), mk('B'), mk('C')];
  assert.equal(s.countNewItems(batch), 2);
  assert.equal(s.importItems(batch, vaultId), 2);
});

test('previous passwords come from item history, newest first, each once', async () => {
  const store = await VaultStore.create(fs.mkdtempSync(path.join(os.tmpdir(), 'sr-pwh-')), 'correct horse battery', generateSecretKey(), KDF_FAST_FOR_TESTS);
  const vaultId = store.snapshot().vaults[0].id;
  const login = (pw: string, notes = '') => {
    const c = blankContent('login');
    c.title = 'Bank'; c.notes = notes;
    c.fields.find(f => f.purpose === 'password')!.value = pw;
    return c;
  };
  const tick = () => new Promise(r => setTimeout(r, 5));
  const id = store.saveItem({ ...login('first-pass'), vaultId }).id;
  await tick(); store.saveItem({ ...login('second-pass'), id, vaultId });
  await tick(); store.saveItem({ ...login('second-pass', 'only notes changed'), id, vaultId });
  await tick(); store.saveItem({ ...login('first-pass', 'only notes changed'), id, vaultId }); // reused
  await tick(); store.saveItem({ ...login('third-pass', 'only notes changed'), id, vaultId });

  const item = store.getItem(id);
  const prev = previousPasswords(item);
  assert.deepEqual(prev.map(p => p.value), ['first-pass', 'second-pass']);
  // Each one's date is when it was replaced, and newer replacements come first.
  assert.equal(prev[0].replacedAt, item.passwordChangedAt);
  assert.ok(prev[0].replacedAt > prev[1].replacedAt);
  assert.deepEqual(previousPasswords({ ...item, history: [] }), []);
});
