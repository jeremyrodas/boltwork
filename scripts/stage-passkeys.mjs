// Before electron-builder: puts the Windows passkey helper package, the certificate it's signed with and the
// install script in build/passkeys, which the installer ships as resources\passkeys (see installer/installer.nsh).
// Run after `node scripts/build-passkey-provider.mjs --msix`, which builds release/Boltwork-Passkeys-<version>.msix.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const out = path.join('build', 'passkeys');
const msix = path.join('release', `Boltwork-Passkeys-${version}.msix`);
// The certificate's file name keeps the old name; see scripts/build-passkey-provider.mjs.
const cer = ['Boltwork', 'Strongroom']
  .map(d => path.join(process.env.APPDATA ?? '', d, 'signing', 'strongroom-dev.cer'))
  .find(p => existsSync(p));

if (!existsSync(msix)) { console.error(`Missing ${msix}: run node scripts/build-passkey-provider.mjs --msix first.`); process.exit(1); }
if (!cer) { console.error('Missing the signing certificate (strongroom-dev.cer in %APPDATA%\\Boltwork\\signing).'); process.exit(1); }

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
copyFileSync(msix, path.join(out, 'Boltwork-Passkeys.msix'));
copyFileSync(cer, path.join(out, 'boltwork-passkeys.cer'));
copyFileSync(path.join('installer', 'passkeys', 'install.ps1'), path.join(out, 'install.ps1'));
console.log(`Staged the passkey helper ${version} in ${out}`);
