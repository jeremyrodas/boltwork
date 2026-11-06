// Builds the Windows passkey provider package (native/passkey-provider) into build/passkey-provider/:
//   build/passkey-provider/package/   the package layout (register it in Developer Mode, see below)
//   build/passkey-provider/*.msix     signed package, with --msix (needs makeappx/signtool: the Windows SDK, or the
//                                     Microsoft.Windows.SDK.BuildTools NuGet package unpacked into build/sdk-buildtools)
//
// Register for development (Settings > System > For developers > Developer Mode on):
//   powershell Add-AppxPackage -Register build\passkey-provider\package\AppxManifest.xml
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'build', 'passkey-provider');
const pkg = path.join(out, 'package');
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version.split('-')[0];
const CLSID = '43ea18ea-3788-4d1a-8c6a-eee1f6502424';
// The signing certificate's subject. It keeps the app's earlier name: a new certificate would have to be trusted again.
const PUBLISHER = 'CN=Strongroom';

rmSync(pkg, { recursive: true, force: true });
mkdirSync(path.join(pkg, 'Assets'), { recursive: true });

// 1. The helper itself: a self-contained, trimmed single file.
execFileSync('dotnet', ['publish', path.join(root, 'native', 'passkey-provider', 'BoltworkPasskeys.csproj'), '-c', 'Release', '-o', pkg, '--nologo', '-v', 'q'], { stdio: 'inherit' });
for (const f of readdirSync(pkg)) if (f.endsWith('.pdb')) rmSync(path.join(pkg, f));

// 2. Logos, drawn from the same vault-door mark as the app icon.
const iconBitmap = path.join(root, 'dist', 'iconBitmap.cjs');
if (!existsSync(iconBitmap)) throw new Error('Run `node scripts/build.mjs` first (it builds dist/iconBitmap.cjs).');
const { drawIcon } = createRequire(import.meta.url)(iconBitmap);
for (const [name, size] of [['StoreLogo.png', 50], ['Square44x44Logo.png', 44], ['Square150x150Logo.png', 150]]) {
  writeFileSync(path.join(pkg, 'Assets', name), png(size, drawIcon(size)));
}

// 3. The package manifest: a COM server Windows' WebAuthn platform starts, and an alias the app runs.
writeFileSync(path.join(pkg, 'AppxManifest.xml'), `<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:uap5="http://schemas.microsoft.com/appx/manifest/uap/windows10/5"
  xmlns:com="http://schemas.microsoft.com/appx/manifest/com/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  xmlns:desktop6="http://schemas.microsoft.com/appx/manifest/desktop/windows10/6"
  IgnorableNamespaces="uap uap5 com rescap desktop6">
  <Identity Name="Boltwork.PasskeyProvider" Publisher="${PUBLISHER}" Version="${version}.0" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>Boltwork passkeys</DisplayName>
    <PublisherDisplayName>Boltwork</PublisherDisplayName>
    <Logo>Assets\\StoreLogo.png</Logo>
    <!-- The helper may start Boltwork, which then runs inside this package: its vault must still be saved to the
         real AppData folder, not a per-package copy, so Windows write redirection is off. -->
    <desktop6:FileSystemWriteVirtualization>disabled</desktop6:FileSystemWriteVirtualization>
    <desktop6:RegistryWriteVirtualization>disabled</desktop6:RegistryWriteVirtualization>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.26100.0" MaxVersionTested="10.0.26200.0" />
  </Dependencies>
  <Resources>
    <Resource Language="en-us" />
  </Resources>
  <Applications>
    <Application Id="BoltworkPasskeys" Executable="BoltworkPasskeys.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements DisplayName="Boltwork passkeys" Description="Lets Windows use passkeys stored in Boltwork."
        BackgroundColor="transparent" Square150x150Logo="Assets\\Square150x150Logo.png" Square44x44Logo="Assets\\Square44x44Logo.png" AppListEntry="none" />
      <Extensions>
        <com:Extension Category="windows.comServer">
          <com:ComServer>
            <com:ExeServer Executable="BoltworkPasskeys.exe" Arguments="-PluginActivated" DisplayName="Boltwork">
              <com:Class Id="${CLSID}" DisplayName="Boltwork" />
            </com:ExeServer>
          </com:ComServer>
        </com:Extension>
        <uap5:Extension Category="windows.appExecutionAlias" Executable="BoltworkPasskeys.exe" EntryPoint="Windows.FullTrustApplication">
          <uap5:AppExecutionAlias>
            <uap5:ExecutionAlias Alias="boltwork-passkeys.exe" />
          </uap5:AppExecutionAlias>
        </uap5:Extension>
      </Extensions>
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
    <rescap:Capability Name="unvirtualizedResources" />
  </Capabilities>
</Package>
`);
console.log(`Package layout: ${pkg}`);

// 4. Optionally a signed .msix (needs makeappx/signtool from the Windows SDK build tools).
if (process.argv.includes('--msix')) {
  const tools = findSdkTools();
  if (!tools) { console.error('makeappx/signtool not found: install the Windows SDK, or the Microsoft.Windows.SDK.BuildTools NuGet package.'); process.exit(1); }
  const msix = path.join(out, `Boltwork-Passkeys-${version}.msix`);
  execFileSync(tools.makeappx, ['pack', '/o', '/d', pkg, '/p', msix], { stdio: 'inherit' });
  // The signing certificate lives outside the repo so a clean build can't lose it; updates must use the same one.
  // Kept in the app's data folder (Strongroom, the earlier name, on older setups). Same certificate for every update.
  const pfx = process.env.BOLTWORK_PFX ?? signingFile('strongroom-dev.pfx');
  if (!existsSync(pfx)) throw new Error(`Signing certificate missing: ${pfx} (see native/passkey-provider/README.md).`);
  execFileSync(tools.signtool, ['sign', '/fd', 'SHA256', '/f', pfx, '/p', process.env.BOLTWORK_PFX_PASSWORD ?? 'strongroom', msix], { stdio: 'inherit' });
  mkdirSync(path.join(root, 'release'), { recursive: true });
  copyFileSync(msix, path.join(root, 'release', path.basename(msix)));
  console.log(`Signed package: ${msix}`);
}

function signingFile(name) {
  const dirs = ['Boltwork', 'Strongroom'].map(d => path.join(process.env.APPDATA ?? '', d, 'signing', name));
  return dirs.find(existsSync) ?? dirs[0];
}

function findSdkTools() {
  const roots = [
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)', 'Windows Kits', '10', 'bin'),
    path.join(root, 'build', 'sdk-buildtools', 'bin'),
  ];
  for (const r of roots) {
    if (!existsSync(r)) continue;
    for (const v of readdirSync(r).sort().reverse()) {
      const dir = path.join(r, v, 'x64');
      if (existsSync(path.join(dir, 'makeappx.exe')) && existsSync(path.join(dir, 'signtool.exe'))) return { makeappx: path.join(dir, 'makeappx.exe'), signtool: path.join(dir, 'signtool.exe') };
    }
  }
  return null;
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
