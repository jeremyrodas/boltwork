import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ready, generateSecretKey, KDF_FAST_FOR_TESTS } from '../src/core/crypto';
import { VaultStore } from '../src/core/store';
import { blankContent } from '../src/core/templates';
import { QuickUnlock, QuickUnlockError, MAX_PIN_FAILURES, PASSWORD_EVERY_MS, type DeviceProtector } from '../src/core/quickUnlock';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sr-quick-'));

/** Stand-in for DPAPI: a per-"user" key that never leaves this object. */
function protector(): DeviceProtector & { key: Buffer } {
  const key = randomBytes(32);
  return {
    key,
    encrypt: d => Buffer.concat([createHmac('sha256', key).update('tag').digest().subarray(0, 4), Buffer.from(d).map((b, i) => b ^ key[i % 32])]).toString('base64'),
    decrypt: s => {
      const raw = Buffer.from(s, 'base64');
      if (!raw.subarray(0, 4).equals(createHmac('sha256', key).update('tag').digest().subarray(0, 4))) throw new Error('not this user');
      return Uint8Array.from(raw.subarray(4).map((b, i) => b ^ key[i % 32]));
    },
  };
}

/** Stand-in for a Windows Hello key: deterministic signatures, like RSA PKCS#1 v1.5. */
const hello = (secret = randomBytes(32)) => async (challenge: Uint8Array) => Uint8Array.from(createHmac('sha512', secret).update(challenge).digest());

async function vault() {
  await ready();
  const dir = tmp();
  const s = await VaultStore.create(dir, 'correct horse battery', generateSecretKey(), KDF_FAST_FOR_TESTS);
  s.saveItem({ ...blankContent('secureNote'), title: 'Secret note', vaultId: s.snapshot().vaults[0].id });
  return { dir, s };
}

test('PIN unlock opens the vault; wrong PINs count down and then turn it off', async () => {
  const { dir, s } = await vault();
  const q = new QuickUnlock(path.join(dir, 'quick.json'), protector());
  await assert.rejects(q.enablePin(s.masterKeyCopy(), s.accountId, '12'), QuickUnlockError);
  await q.enablePin(s.masterKeyCopy(), s.accountId, '482916');
  assert.deepEqual(q.status(s.accountId), { method: 'pin' });
  assert.ok(!fs.readFileSync(path.join(dir, 'quick.json'), 'utf8').includes('482916'));
  s.lock();

  const opened = VaultStore.unlockWithKey(dir, await q.unlockWithPin(s.accountId, '482916'));
  assert.equal(opened.snapshot().items[0].title, 'Secret note');
  opened.lock();

  for (let i = 1; i < MAX_PIN_FAILURES; i++) {
    await assert.rejects(q.unlockWithPin(s.accountId, '000000'), (e: QuickUnlockError) => !e.disabled && e.message.includes(`${MAX_PIN_FAILURES - i}`));
  }
  // A right PIN resets the count...
  await q.unlockWithPin(s.accountId, '482916');
  for (let i = 1; i < MAX_PIN_FAILURES; i++) await assert.rejects(q.unlockWithPin(s.accountId, '000000'));
  // ...and the fifth wrong one in a row turns quick unlock off for good.
  await assert.rejects(q.unlockWithPin(s.accountId, '000000'), (e: QuickUnlockError) => e.disabled);
  assert.deepEqual(q.status(s.accountId), { method: null });
  await assert.rejects(q.unlockWithPin(s.accountId, '482916'), QuickUnlockError);
});

test('quick unlock needs the password again after 14 days; a password unlock restarts the clock', async () => {
  const { dir, s } = await vault();
  let now = Date.now();
  const q = new QuickUnlock(path.join(dir, 'quick.json'), protector(), () => now);
  await q.enablePin(s.masterKeyCopy(), s.accountId, '7777');
  now += PASSWORD_EVERY_MS + 1000;
  assert.ok(q.status(s.accountId).needsPassword);
  await assert.rejects(q.unlockWithPin(s.accountId, '7777'), (e: QuickUnlockError) => e.disabled);
  q.notePasswordUnlock(s.accountId);
  assert.deepEqual(q.status(s.accountId), { method: 'pin' });
  await q.unlockWithPin(s.accountId, '7777');
});

test('the stored copy is useless without this Windows user, and belongs to one vault', async () => {
  const { dir, s } = await vault();
  const file = path.join(dir, 'quick.json');
  await new QuickUnlock(file, protector()).enablePin(s.masterKeyCopy(), s.accountId, '482916');
  // Same file, different Windows user (different DPAPI key): the right PIN doesn't help.
  await assert.rejects(new QuickUnlock(file, protector()).unlockWithPin(s.accountId, '482916'));
  // A different vault on the same device doesn't see it.
  assert.deepEqual(new QuickUnlock(file, protector()).status('some-other-account'), { method: null });
});

test('Windows Hello unlock works with a repeatable signature and refuses a non-repeatable one', async () => {
  const { dir, s } = await vault();
  const q = new QuickUnlock(path.join(dir, 'quick.json'), protector());
  const sign = hello();
  await q.enableHello(s.masterKeyCopy(), s.accountId, sign);
  assert.deepEqual(q.status(s.accountId), { method: 'hello' });
  s.lock();
  const opened = VaultStore.unlockWithKey(dir, await q.unlockWithHello(s.accountId, sign));
  assert.equal(opened.snapshot().items.length, 1);
  // A different Hello key (e.g. Hello was reset) can't unlock.
  await assert.rejects(q.unlockWithHello(s.accountId, hello()), QuickUnlockError);
  // Hello that doesn't give the same signature twice can't be used at all.
  const q2 = new QuickUnlock(path.join(dir, 'quick2.json'), protector());
  await assert.rejects(q2.enableHello(opened.masterKeyCopy(), opened.accountId, async () => Uint8Array.from(randomBytes(256))), QuickUnlockError);
  // Cancelling the Hello prompt surfaces as an error and changes nothing.
  await assert.rejects(q.unlockWithHello(s.accountId, async () => { throw new Error('Windows Hello was cancelled.'); }), /cancelled/);
  assert.deepEqual(q.status(s.accountId), { method: 'hello' });
});

test('unlockWithKey rejects a key that isn’t this vault’s', async () => {
  const { dir, s } = await vault();
  s.lock();
  assert.throws(() => VaultStore.unlockWithKey(dir, Uint8Array.from(randomBytes(32))), /doesn.t match/);
});
