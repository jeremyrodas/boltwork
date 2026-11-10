// Packages the browser extension for the Chrome Web Store and Microsoft Edge Add-ons:
// release/boltwork-extension-<version>.zip, built from dist-extension/ (run `node scripts/build.mjs` first).
//
// The stores give the extension their own ID and refuse a manifest with a "key", so the key is left out here.
// Once a listing is approved, add its ID to STORE_EXTENSION_IDS in src/core/extensionId.ts so the apps trust it.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const src = 'dist-extension';
if (!existsSync(`${src}/manifest.json`)) throw new Error('Build the extension first: node scripts/build.mjs');
const stage = path.join('release', 'extension-store');
rmSync(stage, { recursive: true, force: true });
mkdirSync('release', { recursive: true });
cpSync(src, stage, { recursive: true });

const manifest = JSON.parse(readFileSync(`${stage}/manifest.json`, 'utf8'));
delete manifest.key;
writeFileSync(`${stage}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');

const zip = path.resolve('release', `boltwork-extension-${manifest.version}.zip`);
rmSync(zip, { force: true });
execFileSync('zip', ['-qr', '-X', zip, '.'], { cwd: stage });
rmSync(stage, { recursive: true, force: true });
console.log(zip);
