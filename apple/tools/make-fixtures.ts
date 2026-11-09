/**
 * Writes test fixtures for the Swift BoltworkKit tests using the desktop app's own TypeScript core,
 * so the Swift code is checked against what Electron Boltwork actually writes.
 * Run: node apple/tools/make-fixtures.mjs (bundles this file with esbuild, then runs it).
 */
import fs from 'node:fs';
import path from 'node:path';
import sodium from 'libsodium-wrappers-sumo';
import { argon2id } from 'hash-wasm';
import { ready, deriveKek, authKeyFrom, b64, KDF_FAST_FOR_TESTS, normalizeSecretKey } from '../../src/core/crypto';
import { VaultStore } from '../../src/core/store';
import { blankContent } from '../../src/core/templates';
import { totpAt, parseTotp } from '../../src/core/totp';

const out = process.argv[2];

async function main() {
  await ready();
  const hex = (u: Uint8Array) => Buffer.from(u).toString('hex');
  const bytes = (n: number, start = 0) => Uint8Array.from({ length: n }, (_, i) => (start + i) & 255);

  const blake = [0, 3, 64, 200].map(len => {
    const msg = bytes(len, 7), key = bytes(32, 100);
    return { msg: hex(msg), key: hex(key), out32: hex(sodium.crypto_generichash(32, msg, key)), out64Unkeyed: hex(sodium.crypto_generichash(64, msg, null)) };
  });

  const argon = [];
  for (const [password, ops, memKiB] of [['correct horse', 2, 64], ['päss wörd', 3, 256], ['x', 1, 8]] as const) {
    const salt = bytes(16, 9);
    const o = await argon2id({ password, salt, iterations: ops, memorySize: memKiB, parallelism: 1, hashLength: 32, outputType: 'binary' });
    argon.push({ password, salt: hex(salt), ops, memKiB, out: hex(o) });
  }

  const xchacha = [0, 1, 100].map(len => {
    const key = bytes(32, 1), nonce = bytes(24, 50), msg = bytes(len, 3), aad = `aad-${len}`;
    return { key: hex(key), nonce: hex(nonce), msg: hex(msg), aad, c: hex(sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(msg, sodium.from_string(aad), null, nonce, key)) };
  });

  const password = 'Ünïcode pässword 1';
  const secretKey = 'sr1-abcdef-ghjkm-npqrs-tvwxy-z0i23';
  const kdf = { alg: 'argon2id13' as const, salt: b64(bytes(16, 77)), ...KDF_FAST_FOR_TESTS };
  const kek = await deriveKek(password, secretKey, kdf);
  const keyDerivation = { password, secretKey, normalized: normalizeSecretKey(secretKey), kdf, kek: hex(kek), authKey: hex(authKeyFrom(kek)) };

  // A real vault, made by the desktop code.
  const dir = path.join(out, 'vault');
  fs.rmSync(dir, { recursive: true, force: true });
  const store = await VaultStore.create(dir, password, secretKey, KDF_FAST_FOR_TESTS);
  const vaultId = store.snapshot().vaults[0].id;
  const login = blankContent('login');
  login.title = 'Example';
  login.urls = [{ label: 'website', url: 'https://example.com', primary: true }];
  login.fields.find(f => f.id === 'username')!.value = 'alice@example.com';
  login.fields.find(f => f.id === 'password')!.value = 'hunter2-but-longer';
  login.fields.find(f => f.id === 'otp')!.value = 'JBSWY3DPEHPK3PXP';
  login.tags = ['work/email', 'favorites'];
  const saved = store.saveItem({ ...login, vaultId });
  store.saveItem({ ...saved, fields: saved.fields.map(f => f.id === 'password' ? { ...f, value: 'newer-password' } : f) });
  store.setFavorite(saved.id, true);
  const note = blankContent('secureNote');
  note.title = 'Wi-Fi notes'; note.notes = 'Line one\nLine two';
  store.saveItem({ ...note, vaultId });
  store.addAttachment(saved.id, 'hello.txt', 'text/plain', sodium.from_string('hello attachment'));
  store.lock();

  const totp = [0, 59_000, 1_111_111_109_000, 2_000_000_000_000].map(t => ({ t, code: totpAt(parseTotp('JBSWY3DPEHPK3PXP'), t) }));

  fs.writeFileSync(path.join(out, 'vectors.json'), JSON.stringify({ blake, argon, xchacha, keyDerivation, totp, itemId: saved.id }, null, 2));
  console.log('fixtures written to', out);
}
main();
