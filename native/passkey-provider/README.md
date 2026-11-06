# Boltwork Windows passkey provider

Lets Windows' own passkey dialog offer Boltwork, in any browser or app (Windows 11 24H2/25H2 with the
November 2025 update or later). It's a small packaged helper: Windows starts it when you pick Boltwork,
it checks the request was signed by Windows, and relays it to the Boltwork app, which asks you and
answers with the passkeys in your vault.

## Build

```
node scripts/build.mjs
node scripts/build-passkey-provider.mjs --msix
```

Produces `release/Boltwork-Passkeys-<version>.msix`, signed with the certificate in
`%APPDATA%\Boltwork\signing\strongroom-dev.pfx` (password `strongroom`, or `BOLTWORK_PFX_PASSWORD`).
Every update must be signed with the same certificate. Back up that folder.

The build needs `makeappx` and `signtool`: either the Windows SDK, or the `Microsoft.Windows.SDK.BuildTools`
NuGet package unpacked into `build/sdk-buildtools`.

## Install on a computer (self-signed certificate)

1. Trust the certificate once, in an **administrator** PowerShell:

   ```
   Import-Certificate -FilePath strongroom-dev.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople
   ```

2. Double-click `Boltwork-Passkeys-<version>.msix` (or `Add-AppxPackage <file>`).
3. In Boltwork, **Settings → Browser Extension → Windows passkeys → Add Boltwork to Windows**.
4. In Windows, **Settings → Accounts → Passkeys → Advanced options**, turn on **Boltwork**.

## For a public release

Sign with a certificate Windows already trusts (a code-signing certificate, or Microsoft's Trusted Signing),
or publish through the Microsoft Store. Nothing else changes: same manifest, same build.

## Troubleshooting

The helper logs to `%TEMP%\boltwork-passkeys\provider.log` (for a packaged app this may be under
`%LOCALAPPDATA%\Packages\Boltwork.PasskeyProvider_*\AC\Temp`).
