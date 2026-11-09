# Boltwork

A local-first, end-to-end encrypted password manager for Windows, Mac, iPhone and iPad.

*Formerly called Strongroom.

Boltwork keeps your logins, passkeys, SSH keys, cards, notes and files in a vault on your own computer. The vault is sealed with your account password plus a random **Secret Key**, so a stolen copy is useless without both. If you want your vault on more than one computer, you sync it through a small server that you run yourself. That server only ever sees encrypted records.

The Windows app is built with Electron, React and TypeScript. The Mac, iPhone and iPad apps are native SwiftUI and open the same vault format. Encryption uses XChaCha20-Poly1305 and Argon2id everywhere.

- **Your data stays yours.** No cloud account, no telemetry. Online checks are off until you turn them on.
- **Passkeys everywhere.** Boltwork's browser extension uses passkeys in Chrome, Edge and Brave, and Boltwork can register as a Windows passkey provider so any app can use them.
- **On every device.** Native apps for Mac, iPhone and iPad fill passwords and passkeys through AutoFill and unlock with Face ID or Touch ID. A self-hosted server, easy to run in Docker, keeps them all in sync and can even serve your vault to a browser.
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

**Mac, iPhone and iPad** (native SwiftUI)
- Opens the same vault as the Windows app and syncs through the same server, so items, passkeys and attachments go everywhere
- AutoFill for passwords and passkeys in Safari and other apps. Save new passkeys straight into Boltwork
- Quick unlock with Face ID or Touch ID, auto-lock, and an account password field that never offers to AutoFill itself
- Watchtower, the password generator, one-time codes, multiple vaults, and the Secret Key and Emergency Kit behind your password
- Sync with a **backup address**: when the main server address can't be reached, the app tries the backup (for example a VPN address for the same server)
- On the Mac: an SSH agent for `ssh` and `git`, and a link to the same browser extension the Windows app uses

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

This is a small packaged helper that lets Windows hand passkey requests to Boltwork. It comes with the setup program, which asks once whether to set it up: say yes, approve Windows' administrator prompt (it trusts Boltwork's self-signed certificate), then turn Boltwork on in the Windows settings page that opens. You can also set it up later from **Settings → Browser Extension → Windows passkeys**. See [native/passkey-provider/README.md](native/passkey-provider/README.md) for details.

### Mac, iPhone and iPad

The Apple apps live in [`apple/`](apple/README.md). Build them with Xcode (see [Build the Apple apps](#build-the-apple-apps)), then either create a new vault or turn on sync and sign in with your email, password and Secret Key to bring over the vault from your other devices.

- **AutoFill:** turn on quick unlock (Face ID or Touch ID) in Settings first, then turn on AutoFill there and pick Boltwork in the system's AutoFill settings. The AutoFill extension only unlocks with Face ID or Touch ID.
- **Mac extras:** Settings → SSH turns on the SSH agent, and Settings → Browser links the browser extension to the Mac app.

### Sync server (optional)

The sync server runs in Docker. See [Docker](#docker) below. Then turn on sync in Boltwork: on Windows open **Settings → Sync → Set up sync…**; on Mac, iPhone and iPad open **Settings → Sync**, enter the server address and **Turn On Sync**.

## Docker

The sync server (and the optional web vault) ships as a Docker image built from this repository.

```bash
git clone https://github.com/jeremyrodas/boltwork.git
cd boltwork/server
docker compose up -d
```

The image is built from the repository root, because it also bundles the web vault. Data lives in the `strongroom-data` volume (the name is kept so existing servers keep their data). By default the server listens on `127.0.0.1:8787` only.

**Settings** go under `environment:` in [`server/docker-compose.yml`](server/docker-compose.yml):

| Variable | Default | Meaning |
|---|---|---|
| `SIGNUPS` | `first` | `first`: only the first account may sign up. `open`: anyone who can reach it. `closed`: nobody |
| `TRUST_PROXY` | off | `1` behind a reverse proxy, so rate limits use the client address it forwards |
| `WEB_VAULT` | `off` | `on` serves the web vault at `/` |
| `STORAGE_LIMIT_MB` | `0` (no limit) | Attachment storage allowed per account |

**Reaching it.** On your home network or a VPN you can use plain http, for example `http://192.168.1.20:8787`. Change the port mapping to `8787:8787` so other devices can reach it. The apps allow http only for private addresses (10.x, 172.16–31.x, 192.168.x, the 100.64–127.x VPN range) and `.local` names. For anything reachable from outside, put it behind an https reverse proxy (Caddy, nginx, Nginx Proxy Manager…), set `TRUST_PROXY: "1"`, and raise the proxy's upload limit to about 150 MB for attachments (`client_max_body_size 150m;` in nginx).

**Backup address.** If the server has two addresses, for example an https domain and a VPN IP, add the second one as the **Backup Address** in each app's sync settings. The apps always try the main address first and fall back to the backup when it can't be reached.

**Web vault.** With `WEB_VAULT: "on"`, opening the server's address in a browser shows Boltwork's own screens. You sign in with your email, password and Secret Key, and the vault is decrypted only inside the tab. Accounts are created in an app, not in the web vault. It's off by default because the page's code comes from the server each time, so someone who takes over the server or its proxy could change it. Read [the trade-off](server/README.md#web-vault-optional) before you turn it on, and only use it over https.

**Updating.**

```bash
git pull
cd server
docker compose up -d --build
```

**Backups.** Back up the data volume. Compose names it after the project folder, so it's usually `server_strongroom-data` (`docker volume ls` shows the exact name):

```bash
docker run --rm -v server_strongroom-data:/data -v "$PWD":/backup alpine tar czf /backup/boltwork-data.tgz -C /data .
```

It holds only encrypted data, so you still need your password and Secret Key to use it.

See [server/README.md](server/README.md) for every setting, running without Docker, and the API.

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

### Build the Apple apps

Needs Xcode 27 and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```bash
cd apple
xcodegen
open Boltwork.xcodeproj
```

Pick the **Boltwork** scheme and run it on a Mac, an iPhone or iPad, or a simulator. To run on a device, use AutoFill or use Face ID / Touch ID on the Mac, set your team under **Signing & Capabilities**, or pass it on the command line so it stays out of the project:

```bash
xcodebuild build -project Boltwork.xcodeproj -scheme Boltwork -destination 'platform=macOS' DEVELOPMENT_TEAM=<your team ID> -allowProvisioningUpdates
```

Tests:

```bash
cd apple/BoltworkKit
swift test
```

```bash
cd apple
xcodebuild test -project Boltwork.xcodeproj -scheme Boltwork -destination 'platform=iOS Simulator,name=iPhone 18 Pro'
```

The test vaults in `BoltworkKit/Tests` are made by the TypeScript core, so the tests prove the apps read each other's vaults. Some UI tests need a throwaway sync server: build it (`cd server && npm install && npm run build`), start it with `SIGNUPS=open PORT=8796 DATA_DIR=$(mktemp -d) node dist/server.js`, then set `TEST_RUNNER_BOLTWORK_SYNC_SERVER=http://localhost:8796`. See [apple/README.md](apple/README.md) for AutoFill and passkey testing.

## Security model

| Piece | How |
|---|---|
| Key derivation | Argon2id (128 MiB, 3 passes) on the account password, then keyed BLAKE2b with a random 128-bit Secret Key |
| Key hierarchy | A random master key, wrapped by the derived key. Changing the password only re-wraps it |
| Storage | One sealed record per vault, collection and item, each bound to its ID and type with associated data, so records can't be swapped or moved unnoticed |
| Encryption | XChaCha20-Poly1305 (libsodium). Tampering is detected |
| Attachments | Each file sealed separately, bound to its ID |
| Secret Key on device | Kept in the operating system's protected storage (Windows DPAPI, the Apple Keychain, libsecret) |
| Quick unlock | A device-bound copy of the master key, sealed with Windows Hello or an Argon2id-stretched PIN (expires 14 days after the last password unlock), or kept in the Apple Keychain behind Face ID / Touch ID |
| Passkeys | ES256 keys generated and kept in the vault. The browser extension accepts only the page address Chrome reports; the Windows helper checks every request was signed by Windows |
| Sync server | Stores only encrypted records and files. It never sees your password, Secret Key or master key |
| Process isolation | Decrypted data stays in the main process. Windows that show your data are sandboxed, with context isolation and a strict content security policy |
| Web vault | Off by default. When on, the vault is decrypted only in the browser tab, under a strict content security policy. You trust the server to serve honest code |
| Online checks | Off by default. Pwned Passwords uses k-anonymity (5-character SHA-1 prefix) |

Read [SECURITY.md](SECURITY.md) for the full design and how to report a problem.

Your vault lives in `%APPDATA%\Boltwork\vault\` on Windows, and in the app's container (shared with its AutoFill extension) on Mac, iPhone and iPad.

## Project layout

| Path | What |
|---|---|
| `src/core/` | Vault, crypto, sync client, passkeys, Watchtower, import/export. No Electron |
| `src/main/` | Electron main process: windows, tray, SSH agent, browser bridge, passkey provider host |
| `src/renderer/` | The React UI |
| `src/extension/`, `extension/` | The browser extension |
| `src/nmhost/` | Native messaging host, which links the browser to the app |
| `native/passkey-provider/` | Windows passkey provider helper (C#, packaged as MSIX) |
| `src/web/` | The web vault: the same React UI running in the browser |
| `server/` | Self-hosted sync server (Node.js + SQLite, Docker), which can also serve the web vault |
| `apple/BoltworkKit/` | Swift package: vault format, crypto, items, generator, Watchtower and sync client |
| `apple/Boltwork/` | The SwiftUI app, one target for Mac, iPhone and iPad |
| `apple/AutoFill/` | AutoFill extension for passwords and passkeys |
| `apple/BrowserHost/` | The Mac's native messaging host for the browser extension |
| `test/` | Tests (`node --test`) |

## Roadmap

- Sharing between people (family and team vaults, share by link)
- Detecting a sync server rolling back records
- Firefox and Safari extensions, store listings, and filling identities and cards
- Signing for public releases (a trusted code-signing certificate or the Microsoft Store), so no certificate step is needed
- Import and export in the Mac, iPhone and iPad apps
- A Linux build

## Renamed from Strongroom

Boltwork was called Strongroom until version 0.4.0. Boltwork's name matches its logo: boltwork is the set of bolts a vault door's wheel throws.

- **Your data:** on first launch Boltwork copies `%APPDATA%\Strongroom` to `%APPDATA%\Boltwork`. The old folder stays as a backup, with a note in it; delete it once Boltwork opens your vault.
- **The old app** installs separately (it had a different app ID). Uninstall Strongroom from Windows Settings → Apps.
- **Browser extension:** reload it from the extension page and approve the browser again if asked.
- **Windows passkeys:** remove the old Strongroom passkeys package, install the Boltwork one, and turn Boltwork on in Windows Settings → Accounts → Passkeys → Advanced options. Your passkeys are in the vault, so none are lost.
- **Unchanged on purpose:** the internal format labels (such as `strongroom:record:v2`), so existing vaults, backups and synced copies open as before; the sync server's protocol name and data, so an existing server keeps working; and the signing certificate's name (`CN=Strongroom`), so it doesn't need trusting again. `strongroom://` item links still open.

## License

The app is MIT. The sync server in `server/` is AGPL-3.0-or-later.
