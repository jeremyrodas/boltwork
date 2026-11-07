# Boltwork

A local-first, end-to-end encrypted password manager for the desktop.

*Formerly called Strongroom. Updating from Strongroom copies your data over on first launch; see [Renamed from Strongroom](#renamed-from-strongroom).*

Boltwork keeps your logins, passkeys, SSH keys, cards, notes and files in a vault on your own computer. The vault is sealed with your account password plus a random **Secret Key**, so a stolen copy is useless without both. If you want your vault on more than one computer, you sync it through a small server that you run yourself. That server only ever sees encrypted records.

Built with Electron, React and TypeScript. Encryption uses libsodium (XChaCha20-Poly1305) and Argon2id.

- **Your data stays yours.** No cloud account, no telemetry. Online checks are off until you turn them on.
- **Passkeys everywhere.** Boltwork's browser extension uses passkeys in Chrome, Edge and Brave, and Boltwork can register as a Windows passkey provider so any app can use them.
- **Built for daily use.** Fill and save logins from the browser, a Quick Access hotkey with auto-type, an SSH agent for `ssh` and `git`, and unlock with Windows Hello or a PIN.

## Features

**Vault**
- 22 item types: Login, Password, Secure Note, Credit Card, Identity, SSH Key, API Credential, Bank Account, Passport, Wireless Router, Server, Database and more
- Custom fields and sections, multiple websites per login, nested tags, favorites, custom icons, encrypted attachments up to 100 MB
- Multiple vaults, Collections, Archive, Recently Deleted with auto-purge
- Item history with restore, and a list of previous passwords for each login
- Smart search with filters (`tag:`, `vault:`, `category:`, `is:favorite`, `has:otp`, `url:`) and search history

**Passkeys**
- Create and sign in with passkeys from the browser extension (Chrome, Edge, Brave), including passkey suggestions in the sign-in field
- **Windows passkey provider** (Windows 11 24H2/25H2): pick Boltwork in Windows' own passkey window, in any browser or app
- Each new passkey can go onto an existing login for the site or a new login, and the prompt shows which
- Passkeys sync with the rest of the vault

**Passwords and sign-in codes**
- Generator: random, memorable (EFF wordlist) or PIN, with a 7-level strength meter (zxcvbn)
- One-time codes (TOTP) from setup keys, `otpauth://` links, a QR code on screen or in an image
- **Watchtower** flags breached, weak, reused and insecure-HTTP logins, sites where you could turn on two-factor sign-in, and expiring items, and gives you a security score. Breach checks use k-anonymity and run in the background without freezing the app

**Browser extension** (Chrome, Edge, Brave; Manifest V3)
- A menu under login fields fills a username, password or one-time code. Ctrl+Shift+L fills the best match
- Offers to save new logins and update changed passwords
- Talks to the app over a local pipe. Each browser is approved once with a matching code, and pages only get logins for their own site

**SSH**
- Generate Ed25519 or RSA keys, or import OpenSSH and PEM keys
- Built-in SSH agent for `ssh`, `git` and other OpenSSH tools. Asks before every signature and never reveals private keys

**Sync** (self-hosted, optional)
- Item-by-item sync with conflict handling. When two computers edit the same item, the later edit wins and the other is kept in history
- Live: changes reach your other computers within seconds of saving
- Attachments sync as sealed files
- Plain http is allowed only for your own computer and home-network addresses. Everything else needs https

**Desktop**
- Quick Access window on a global hotkey, with auto-type into the previous app (Windows)
- Quick unlock with Windows Hello or a Boltwork PIN
- Auto-lock on idle, sleep or screen lock, clipboard auto-clear, hiding from screen capture, blur when unfocused
- Tray icon, `boltwork://` links, start at login, Large Type
- Light and dark themes, plus five color schemes (Brass, Copper, Verdigris, Blued steel, Silver) with matching app icons

**Import and export**
- Import from 1Password (`.1pux`), Bitwarden, Chrome, Edge, Firefox, Safari, LastPass, Dashlane, KeePass/KeePassXC and CSV
- Export to an encrypted backup, JSON or CSV. Print an Emergency Kit PDF with your Secret Key

## Getting started

### Install (Windows)

1. Run `Boltwork-Setup-<version>.exe`, from the releases or built yourself (see [Build from source](#build-from-source)).
2. Create your vault. Save the **Emergency Kit**: you need your password *and* Secret Key to open your vault on a new computer.

### Browser extension

In Boltwork, open **Settings → Browser Extension** and turn it on. Then:

1. Open `chrome://extensions` (Edge: `edge://extensions`, Brave: `brave://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and choose the extension folder. **Show folder** in Boltwork opens it for you.
3. Click the Boltwork toolbar button and approve the matching code in the app.

### Windows passkey provider (optional)

This is a small packaged helper (`Boltwork-Passkeys-<version>.msix`) that lets Windows hand passkey requests to Boltwork. It's signed with a self-signed certificate, so the certificate must be trusted once before installing. See [native/passkey-provider/README.md](native/passkey-provider/README.md) for the steps.

### Sync server (optional)

```bash
cd server
docker compose up -d
```

Then in Boltwork open **Settings → Sync → Set up sync…** and enter the server's address. See [server/README.md](server/README.md) for settings, https, backups and the API.

The server can also serve a **web vault**, so you can open your vault in a browser at the server's address. It's off by default;
read [the trade-off](server/README.md#web-vault-optional) before turning it on with `WEB_VAULT: "on"`.

## Build from source

Needs Node.js 22.13+ (Node 24 recommended). The passkey provider also needs the .NET 10 SDK.

```bash
npm install
npm start            # build and launch
npm test             # unit and integration tests
npm run typecheck
npm run dist         # Windows installer in release/
```

Build the Windows passkey provider package:

```bash
node scripts/build.mjs
node scripts/build-passkey-provider.mjs --msix
```

Use a throwaway profile while developing: `BOLTWORK_PROFILE=C:\temp\sr-test npm start`. To run the SSH agent next to another agent, point `BOLTWORK_AGENT_SOCK` at a different pipe.

To have `npm run dist` copy each release somewhere, create `release.local.json` (not committed), for example `{ "copyTo": "D:\\" }`.

## Security model

| Piece | How |
|---|---|
| Key derivation | Argon2id (128 MiB, 3 passes) on the account password, then keyed BLAKE2b with a random 128-bit Secret Key |
| Key hierarchy | A random master key, wrapped by the derived key. Changing the password only re-wraps it |
| Storage | One sealed record per vault, collection and item, each bound to its ID and type with associated data, so records can't be swapped or moved unnoticed |
| Encryption | XChaCha20-Poly1305 (libsodium). Tampering is detected |
| Attachments | Each file sealed separately, bound to its ID |
| Secret Key on device | Kept in the operating system's protected storage (Windows DPAPI, macOS Keychain, libsecret) |
| Quick unlock | A device-bound copy of the master key, sealed with Windows Hello or an Argon2id-stretched PIN. Expires 14 days after the last password unlock |
| Passkeys | ES256 keys generated and kept in the vault. The browser extension accepts only the page address Chrome reports; the Windows helper checks every request was signed by Windows |
| Sync server | Stores only encrypted records and files. It never sees your password, Secret Key or master key |
| Process isolation | Decrypted data stays in the main process. Windows that show your data are sandboxed, with context isolation and a strict content security policy |
| Online checks | Off by default. Pwned Passwords uses k-anonymity (5-character SHA-1 prefix) |

Read [SECURITY.md](SECURITY.md) for the full design and how to report a problem.

Your vault lives in `%APPDATA%\Boltwork\vault\`.

## Project layout

| Path | What |
|---|---|
| `src/core/` | Vault, crypto, sync client, passkeys, Watchtower, import/export. No Electron |
| `src/main/` | Electron main process: windows, tray, SSH agent, browser bridge, passkey provider host |
| `src/renderer/` | The React UI |
| `src/extension/`, `extension/` | The browser extension |
| `src/nmhost/` | Native messaging host, which links the browser to the app |
| `native/passkey-provider/` | Windows passkey provider helper (C#, packaged as MSIX) |
| `server/` | Self-hosted sync server (Node.js + SQLite, Docker) |
| `test/` | Tests (`node --test`) |

## Roadmap

- Sharing between people (family and team vaults, share by link)
- Detecting a sync server rolling back records
- Firefox and Safari extensions, store listings, and filling identities and cards
- Signing for public releases (a trusted code-signing certificate or the Microsoft Store), so no certificate step is needed
- macOS and Linux builds

## Renamed from Strongroom

Boltwork was called Strongroom until version 0.4.0. Boltwork's name matches its logo: boltwork is the set of bolts a vault door's wheel throws.

- **Your data:** on first launch Boltwork copies `%APPDATA%\Strongroom` to `%APPDATA%\Boltwork`. The old folder stays as a backup, with a note in it; delete it once Boltwork opens your vault.
- **The old app** installs separately (it had a different app ID). Uninstall Strongroom from Windows Settings → Apps.
- **Browser extension:** reload it from the extension page and approve the browser again if asked.
- **Windows passkeys:** remove the old Strongroom passkeys package, install the Boltwork one, and turn Boltwork on in Windows Settings → Accounts → Passkeys → Advanced options. Your passkeys are in the vault, so none are lost.
- **Unchanged on purpose:** the internal format labels (such as `strongroom:record:v2`), so existing vaults, backups and synced copies open as before; the sync server's protocol name and data, so an existing server keeps working; and the signing certificate's name (`CN=Strongroom`), so it doesn't need trusting again. `strongroom://` item links still open.

## License

The app is MIT. The sync server in `server/` is AGPL-3.0-or-later.
