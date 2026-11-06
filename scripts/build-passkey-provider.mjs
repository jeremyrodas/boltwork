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
const CLSID = '43df1c13-2d67-44cb-836b-ed22142063fc';
const PUBLISHER = 'CN=Strongroom';

rmSync(pkg, { recursive: true, force: true });
mkdirSync(path.join(pkg, 'Assets'), { recursive: true });

// 1. The helper itself: a self-contained, trimmed single file.
execFileSync('dotnet', ['publish', path.join(root, 'native', 'passkey-provider', 'StrongroomPasskeys.csproj'), '-c', 'Release', '-o', pkg, '--nologo', '-v', 'q'], { stdio: 'inherit' });
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
  IgnorableNamespaces="uap uap5 com rescap">
  <Identity Name="Strongroom.PasskeyProvider" Publisher="${PUBLISHER}" Version="${version}.0" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>Strongroom passkeys</DisplayName>
    <PublisherDisplayName>Strongroom</PublisherDisplayName>
    <Logo>Assets\\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.26100.0" MaxVersionTested="10.0.26200.0" />
  </Dependencies>
  <Resources>
    <Resource Language="en-us" />
  </Resources>
  <Applications>
    <Application Id="StrongroomPasskeys" Executable="StrongroomPasskeys.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements DisplayName="Strongroom passkeys" Description="Lets Windows use passkeys stored in Strongroom."
        BackgroundColor="transparent" Square150x150Logo="Assets\\Square150x150Logo.png" Square44x44Logo="Assets\\Square44x44Logo.png" AppListEntry="none" />
      <Extensions>
        <com:Extension Category="windows.comServer">
          <com:ComServer>
            <com:ExeServer Executable="StrongroomPasskeys.exe" Arguments="-PluginActivated" DisplayName="Strongroom">
              <com:Class Id="${CLSID}" DisplayName="Strongroom" />
            </com:ExeServer>
          </com:ComServer>
        </com:Extension>
        <uap5:Extension Category="windows.appExecutionAlias" Executable="StrongroomPasskeys.exe" EntryPoint="Windows.FullTrustApplication">
          <uap5:AppExecutionAlias>
            <uap5:ExecutionAlias Alias="strongroom-passkeys.exe" />
          </uap5:AppExecutionAlias>
        </uap5:Extension>
      </Extensions>
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
`);
console.log(`Package layout: ${pkg}`);

// 4. Optionally a signed .msix (needs makeappx/signtool from the Windows SDK build tools).
if (process.argv.includes('--msix')) {
  const tools = findSdkTools();
  if (!tools) { console.error('makeappx/signtool not found: install the Windows SDK, or the Microsoft.Windows.SDK.BuildTools NuGet package.'); process.exit(1); }
  const msix = path.join(out, `Strongroom-Passkeys-${version}.msix`);
  execFileSync(tools.makeappx, ['pack', '/o', '/d', pkg, '/p', msix], { stdio: 'inherit' });
  // The signing certificate lives outside the repo so a clean build can't lose it; updates must use the same one.
  const pfx = process.env.STRONGROOM_PFX ?? path.join(process.env.APPDATA ?? '', 'Strongroom', 'signing', 'strongroom-dev.pfx');
  if (!existsSync(pfx)) throw new Error(`Signing certificate missing: ${pfx} (see native/passkey-provider/README.md).`);
  execFileSync(tools.signtool, ['sign', '/fd', 'SHA256', '/f', pfx, '/p', process.env.STRONGROOM_PFX_PASSWORD ?? 'strongroom', msix], { stdio: 'inherit' });
  mkdirSync(path.join(root, 'release'), { recursive: true });
  copyFileSync(msix, path.join(root, 'release', path.basename(msix)));
  console.log(`Signed package: ${msix}`);
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
