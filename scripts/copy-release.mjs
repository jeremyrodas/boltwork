// After `npm run dist`: copies the new installer to the folder named in release.local.json
// ({ "copyTo": "D:\\" }) or the BOLTWORK_RELEASE_COPY_TO environment variable. That file isn't
// committed, since the folder is specific to one computer. Does nothing if neither is set.
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const local = existsSync('release.local.json') ? JSON.parse(readFileSync('release.local.json', 'utf8')) : {};
const dest = process.env.BOLTWORK_RELEASE_COPY_TO || local.copyTo;
if (!dest) process.exit(0);
const file = `Boltwork-Setup-${version}.exe`;
if (!existsSync(dest)) { console.error(`Release copy skipped: ${dest} doesn't exist (is the drive connected?).`); process.exit(0); }
copyFileSync(path.join('release', file), path.join(dest, file));
console.log(`Copied ${file} to ${dest}`);
// The Windows passkey provider package and the certificate other computers need to trust it, if built.
const extras = [`Boltwork-Passkeys-${version}.msix`].map(f => path.join('release', f));
const cer = ['Boltwork', 'Strongroom'].map(d => path.join(process.env.APPDATA ?? '', d, 'signing', 'strongroom-dev.cer')).find(p => existsSync(p)) ?? '';
for (const f of [...extras, cer]) if (existsSync(f)) { copyFileSync(f, path.join(dest, path.basename(f))); console.log(`Copied ${path.basename(f)} to ${dest}`); }
