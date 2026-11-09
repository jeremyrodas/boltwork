// Renders the app icons and in-app mark from the desktop app's own icon code (src/core/iconBitmap.ts).
// Run from the repo root: node apple/tools/make-icons.mjs
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const out = 'apple/Boltwork/Resources/Assets.xcassets';
await build({
  stdin: { contents: "export { drawIcon } from './src/core/iconBitmap'; export { SCHEMES } from './src/core/schemes';", resolveDir: '.', loader: 'ts' },
  outfile: 'apple/tools/.build/iconBitmap.cjs', bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning',
});
const { drawIcon, SCHEMES } = createRequire(import.meta.url)('./.build/iconBitmap.cjs');

function png(w, rgba) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(w, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * w);
  for (let y = 0; y < w; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** The mark on a full-bleed graphite square, enlarged so its own rim falls outside the mask iOS applies. */
function opaque(size) {
  const big = Math.round(size * 1.14), off = Math.round((big - size) / 2);
  // iOS masks the corners itself, so hide the mark's own rim by drawing it in the body color.
  const edge = SCHEMES.brass.mark.edge;
  SCHEMES.brass.mark.edge = SCHEMES.brass.mark.body;
  const full = drawIcon(big);
  SCHEMES.brass.mark.edge = edge;
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) rgba.set(full.subarray(((y + off) * big + off) * 4, ((y + off) * big + off + size) * 4), y * size * 4);
  const bg = [0x1f, 0x24, 0x30];
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255;
    for (let k = 0; k < 3; k++) rgba[i + k] = Math.round(rgba[i + k] * a + bg[k] * (1 - a));
    rgba[i + 3] = 255;
  }
  return rgba;
}

/** The mark inset on a transparent canvas, following the macOS icon grid (824 of 1024). */
function inset(size) {
  const inner = Math.round(size * 824 / 1024), off = Math.round((size - inner) / 2);
  const mark = drawIcon(inner);
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < inner; y++) rgba.set(mark.subarray(y * inner * 4, (y + 1) * inner * 4), ((y + off) * size + off) * 4);
  return rgba;
}

const images = [{ filename: 'ios-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }];
writeFileSync(`${out}/AppIcon.appiconset/ios-1024.png`, png(1024, opaque(1024)));
for (const pt of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const px = pt * scale, filename = `mac-${pt}@${scale}x.png`;
    writeFileSync(`${out}/AppIcon.appiconset/${filename}`, png(px, inset(px)));
    images.push({ filename, idiom: 'mac', scale: `${scale}x`, size: `${pt}x${pt}` });
  }
}
writeFileSync(`${out}/AppIcon.appiconset/Contents.json`, JSON.stringify({ images, info: { author: 'xcode', version: 1 } }, null, 2));

for (const [scale, px] of [[1, 64], [2, 128], [3, 192]]) writeFileSync(`${out}/BrandMark.imageset/mark@${scale}x.png`, png(px, drawIcon(px)));
writeFileSync(`${out}/BrandMark.imageset/Contents.json`, JSON.stringify({
  images: [1, 2, 3].map(s => ({ filename: `mark@${s}x.png`, idiom: 'universal', scale: `${s}x` })), info: { author: 'xcode', version: 1 },
}, null, 2));
console.log('icons written');
