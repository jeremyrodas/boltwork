import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { ready } from '../src/core/crypto';
import { currentTotp } from '../src/core/totp';
import * as shim from '../src/web/shims/crypto';
import * as memfs from '../src/web/shims/fs';
import { startServer } from '../server/src/server';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bw-web-'));

test('the web vault’s hashes match Node’s', async () => {
  await ready();
  const inputs = ['', 'abc', 'correct horse battery', 'x'.repeat(1000), new Uint8Array(Array.from({ length: 300 }, (_, i) => i & 255))];
  for (const alg of ['sha1', 'sha256', 'sha512']) {
    for (const input of inputs) {
      assert.equal(shim.createHash(alg).update(input).digest('hex'), nodeCrypto.createHash(alg).update(input).digest('hex'), `${alg} of ${input.length} bytes`);
      for (const key of ['k', 'k'.repeat(200)]) {
        assert.equal(shim.createHmac(alg, key).update(input).digest('hex'), nodeCrypto.createHmac(alg, key).update(input).digest('hex'), `HMAC-${alg}`);
      }
    }
  }
  // RFC 6238 test vector (SHA-1, 59 s): 94287082 in 8 digits.
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(currentTotp(`otpauth://totp/x?secret=${secret}&digits=8`, 59_000).code, '94287082');
  for (let i = 0; i < 200; i++) { const n = shim.randomInt(3, 7); assert.ok(n >= 3 && n < 7); }
});

test('the web vault’s in-memory files', () => {
  memfs.mkdirSync('/vault/attachments', { recursive: true });
  memfs.writeFileSync('/vault/vault.json', '{"a":1}');
  memfs.copyFileSync('/vault/vault.json', '/vault/vault.json.bak');
  memfs.writeFileSync('/vault/attachments/one.tmp', new Uint8Array([1, 2]));
  memfs.renameSync('/vault/attachments/one.tmp', '/vault/attachments/one');
  assert.equal(memfs.readFileSync('/vault/vault.json.bak', 'utf8'), '{"a":1}');
  assert.deepEqual(memfs.readdirSync('/vault/attachments'), ['one']);
  assert.ok(!memfs.existsSync('/vault/attachments/one.tmp'));
  memfs.wipeAll();
  assert.ok(!memfs.existsSync('/vault/vault.json'));
});

test('the server serves the web vault only when it’s turned on', async () => {
  const webDir = tmp();
  fs.writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Boltwork</title>');
  fs.writeFileSync(path.join(webDir, 'web.js'), 'console.log("web vault");'.repeat(50));
  fs.writeFileSync(path.join(webDir, 'notes.txt'), 'not served');

  const off = await startServer({ port: 0, dataDir: tmp(), log: () => {} });
  try {
    for (const p of ['/', '/web.js', '/index.html']) {
      const r = await fetch(`${off.url}${p}`);
      assert.ok(r.status >= 400 && /json/.test(r.headers.get('content-type')!), `${p} isn’t served`);
    }
  } finally { await off.close(); }

  const on = await startServer({ port: 0, dataDir: tmp(), log: () => {}, webDir });
  try {
    const page = await fetch(`${on.url}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type')!, /text\/html/);
    const csp = page.headers.get('content-security-policy')!;
    assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    assert.match(await page.text(), /Boltwork/);

    const etag = page.headers.get('etag')!;
    assert.equal((await fetch(`${on.url}/`, { headers: { 'if-none-match': etag } })).status, 304);

    // Sent gzipped to browsers that accept it (raw request, so fetch doesn't unzip it).
    const http = await import('node:http');
    const gz = await new Promise<{ enc?: string; body: Buffer }>((resolve, reject) => {
      http.get(`${on.url}/web.js`, { headers: { 'accept-encoding': 'gzip' } }, res => {
        const chunks: Buffer[] = [];
        res.on('data', c => chunks.push(c)).on('end', () => resolve({ enc: res.headers['content-encoding'], body: Buffer.concat(chunks) }));
      }).on('error', reject);
    });
    assert.equal(gz.enc, 'gzip');
    assert.match(gunzipSync(gz.body).toString(), /web vault/);

    for (const [p, method] of [['/notes.txt', 'GET'], ['/../server-secret', 'GET'], ['/%2e%2e/server-secret', 'GET'], ['/', 'POST']]) {
      const r = await fetch(`${on.url}${p}`, { method });
      assert.ok(r.status >= 400 && /json/.test(r.headers.get('content-type')!), `${method} ${p} isn’t served`);
    }
    const health = await (await fetch(`${on.url}/api/v1/health`)).json() as { name: string };
    assert.equal(health.name, 'strongroom-server');
  } finally { await on.close(); }
});
