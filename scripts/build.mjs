import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';

const tests = process.argv.includes('--tests');
const common = { bundle: true, sourcemap: true, logLevel: 'warning' };

if (tests) {
  rmSync('dist-test', { recursive: true, force: true });
  const entryPoints = readdirSync('test').filter(f => f.endsWith('.test.ts')).map(f => `test/${f}`);
  await build({ ...common, entryPoints, outdir: 'dist-test', platform: 'node', format: 'cjs', target: 'node20' });
} else {
  mkdirSync('dist', { recursive: true });
  await build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js', platform: 'node', format: 'cjs', target: 'node20', external: ['electron'] });
  await build({ ...common, entryPoints: ['src/main/preload.ts'], outfile: 'dist/preload.js', platform: 'node', format: 'cjs', target: 'node20', external: ['electron'] });
  await build({ ...common, entryPoints: ['src/renderer/index.tsx'], outfile: 'dist/renderer.js', platform: 'browser', format: 'iife', target: 'chrome130', loader: { '.css': 'css' } });
  await build({ ...common, entryPoints: ['src/nmhost/nmhost.ts'], outfile: 'dist/nmhost.js', platform: 'node', format: 'cjs', target: 'node20' });
  await build({ ...common, entryPoints: ['src/main/watchtowerWorker.ts'], outfile: 'dist/watchtowerWorker.js', platform: 'node', format: 'cjs', target: 'node20' });
  await buildExtension();
  await build({ ...common, sourcemap: false, entryPoints: ['server/src/main.ts'], outfile: 'server/dist/server.js', platform: 'node', format: 'cjs', target: 'node22' });
  const v = Date.now().toString(36);
  writeFileSync('dist/index.html', readFileSync('src/renderer/index.html', 'utf8').replace('renderer.css', `renderer.css?v=${v}`).replace('renderer.js', `renderer.js?v=${v}`));
}

// ---------- browser extension (dist-extension/, load it unpacked in Chrome) ----------

async function buildExtension() {
  const out = 'dist-extension';
  rmSync(out, { recursive: true, force: true });
  mkdirSync(`${out}/icons`, { recursive: true });
  const ext = { ...common, sourcemap: false, platform: 'browser', format: 'iife', target: 'chrome116' };
  await build({ ...ext, entryPoints: ['src/extension/background.ts'], outfile: `${out}/background.js` });
  await build({ ...ext, entryPoints: ['src/extension/content.ts'], outfile: `${out}/content.js` });
  await build({ ...ext, entryPoints: ['src/extension/popup.ts'], outfile: `${out}/popup.js` });
  await build({ ...ext, entryPoints: ['src/extension/webauthn-page.ts'], outfile: `${out}/webauthn-page.js` });
  await build({ ...ext, entryPoints: ['src/extension/webauthn-relay.ts'], outfile: `${out}/webauthn-relay.js` });
  for (const f of ['manifest.json', 'popup.html', 'popup.css']) copyFileSync(`extension/${f}`, `${out}/${f}`);

  // The extension ID comes from the manifest key; the app only trusts that ID.
  const key = JSON.parse(readFileSync('extension/manifest.json', 'utf8')).key;
  const id = [...createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32)].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
  const expected = /EXTENSION_ID = '([a-p]{32})'/.exec(readFileSync('src/core/extensionId.ts', 'utf8'))?.[1];
  if (id !== expected) throw new Error(`Extension ID mismatch: manifest key gives ${id}, src/core/extensionId.ts says ${expected}`);

  await build({ ...common, sourcemap: false, entryPoints: ['src/core/iconBitmap.ts'], outfile: 'dist/iconBitmap.cjs', platform: 'node', format: 'cjs' });
  const { drawIcon } = createRequire(import.meta.url)('../dist/iconBitmap.cjs');
  for (const size of [16, 32, 48, 128]) writeFileSync(`${out}/icons/${size}.png`, png(size, drawIcon(size)));

  // The Windows app and installer icon: PNG images in an .ico container.
  mkdirSync('build', { recursive: true });
  writeFileSync('build/icon.ico', ico([16, 24, 32, 48, 64, 128, 256].map(size => png(size, drawIcon(size)))));
}

function ico(pngs) {
  const header = Buffer.alloc(6); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const dir = pngs.map(p => {
    const size = p.readUInt32BE(16);
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(p.length, 8); e.writeUInt32LE(offset, 12);
    offset += p.length;
    return e;
  });
  return Buffer.concat([header, ...dir, ...pngs]);
}

function png(size, rgba) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
