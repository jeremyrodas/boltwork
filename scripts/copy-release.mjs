// After `npm run dist`: copies the new installer to the folder named in release.local.json
// ({ "copyTo": "D:\\" }) or the STRONGROOM_RELEASE_COPY_TO environment variable. That file isn't
// committed, since the folder is specific to one computer. Does nothing if neither is set.
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const local = existsSync('release.local.json') ? JSON.parse(readFileSync('release.local.json', 'utf8')) : {};
const dest = process.env.STRONGROOM_RELEASE_COPY_TO || local.copyTo;
if (!dest) process.exit(0);
const file = `Strongroom-Setup-${version}.exe`;
if (!existsSync(dest)) { console.error(`Release copy skipped: ${dest} doesn't exist (is the drive connected?).`); process.exit(0); }
copyFileSync(path.join('release', file), path.join(dest, file));
console.log(`Copied ${file} to ${dest}`);
