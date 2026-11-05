# Strongroom

A local-first, end-to-end encrypted password manager for the desktop (Electron + React + TypeScript).
Phase 1 covers the features of a full desktop password manager except developer tools, and excluding anything that needs a server.

## Run it

```bash
npm install
npm start          # build and launch
npm test           # core tests (crypto, vault, TOTP, Watchtower, search, import/export)
npm run typecheck
```

Use a throwaway profile while testing: `STRONGROOM_PROFILE=C:\temp\sr-test npm start`. To test the SSH agent next to another agent, set `STRONGROOM_AGENT_SOCK` to a different pipe or socket path.

## Security model

| Piece | How |
|---|---|
| Storage | One sealed record per vault, collection and item, bound to its id (see `src/core/records.ts`); old single-blob vaults upgrade on unlock and keep `vault.v1-backup.json` |
| Key derivation | Argon2id (128 MiB, 3 passes, via hash-wasm) on the account password, then keyed BLAKE2b with a random 128-bit **Secret Key** |
| Encryption | XChaCha20-Poly1305 (libsodium) with purpose-bound associated data; tampering is detected |
| Key hierarchy | Random master key wrapped by the derived key. Changing the password only re-wraps it |
| Secret Key on device | Stored with Electron `safeStorage` (Windows DPAPI / macOS Keychain / libsecret) |
| Attachments | Each file sealed separately |
| Process isolation | Decrypted data lives in the main process; renderers are sandboxed, use context isolation and a strict CSP, and can't navigate |
| Online checks | Off by default. Pwned Passwords uses k-anonymity (5-char SHA-1 prefix); breach and 2FA lists are downloaded whole |

Data folder: `%APPDATA%\strongroom\vault\` (`vault.json`, `vault.json.bak`, `attachments\`).

## Features (phase 1)

- **Vaults and items**: 22 item categories (SSH Key, Login, Password, Secure Note, Credit Card, Identity, Document, Bank Account, Database, Driver License, Email Account, Membership, Outdoor License, Passport, Reward Program, Wireless Router, Server, SSN, Software License, API Credential, Crypto Wallet, Medical Record), custom fields and sections, multiple websites, nested tags, favorites, custom icons, encrypted attachments, notes
- **Organization**: multiple vaults, Collections (groups of vaults), Archive, Recently Deleted with auto-purge, item history with restore, duplicate, move, tag rename
- **Search**: smart search with `tag:`, `-tag:`, `vault:`, `category:`, `is:favorite`, `has:otp`, `url:` filters, search history, and six sort orders
- **One-time passwords**: TOTP (SHA-1/256/512, 6/8 digits) from setup keys or `otpauth://` links, **scan a QR code on screen**, or read one from an image file
- **Password generator**: random, memorable (EFF wordlist, separators, syllables), PIN; zxcvbn-based 7-level strength meter; username suggestions
- **Watchtower**: compromised logins (HIBP breaches), vulnerable passwords (Pwned Passwords), reused, weak, unsecured HTTP, inactive 2FA (built-in list plus 2fa.directory), expiring, duplicates; security score; per-item ignore
- **Quick Access**: a global-hotkey search window that **auto-types** username, Tab, password, Enter into the previous app (Windows), and copies username, password or one-time code, or opens the website
- **Security**: security presets (Easy & Secure / Workday / Strictest), auto-lock on idle, sleep, screen lock or window close; clipboard auto-clear with notification; hiding from screen capture; blur when unfocused; Privacy Mode; re-authentication for export and Secret Key reveal; change password; Emergency Kit PDF
- **Quick unlock**: Windows Hello (face, fingerprint or Windows PIN) when the computer has it, or a Strongroom PIN; password still required every 14 days and after 5 wrong PINs (Settings → Security)
- **SSH keys**: generate Ed25519 or RSA (2048/3072/4096), import OpenSSH or PEM keys (including passphrase-protected PEM), copy or save the public key, export the private key, fingerprints match `ssh-keygen -l`
- **SSH agent**: serves vault SSH keys to `ssh`, `git` and other OpenSSH tools (Windows pipe `\\.\pipe\openssh-ssh-agent`, or `~/.strongroom/agent.sock` on macOS/Linux). Asks before every signature (Allow / Allow until locked / Deny), waits for you to unlock when locked, and never accepts or reveals private keys. Detects the Windows OpenSSH agent service and shows how to turn it off
- **Browser extension** (Chrome, Edge, Brave; Manifest V3, in `dist-extension/` after a build): a menu under login fields to fill username, password or one-time code; Ctrl+Shift+L fills the best match; offers to save new logins and update changed passwords (or never for a site); toolbar popup to search, fill and copy. Talks to the app through a native messaging host relayed over a local pipe (`\\.\pipe\strongroom-browser`), so the browser never stores secrets. Each browser is approved once with a matching code; pages only get logins for their own domain, and only after you pick one. The app trusts only the extension ID derived from the key in `extension/manifest.json`
- **Sync (self-hosted)**: run the server in `server/` (Docker or Node), then Settings → Sync. Item-by-item sync with optimistic concurrency; when two computers edit the same item, the later edit wins and the other is kept in item history. New computers sign in with server address, email, password and Secret Key. The server stores only encrypted records (see [SECURITY.md](SECURITY.md))
- **Import**: 1Password `.1pux` (including SSH keys), Bitwarden JSON/CSV, Chrome/Edge/Brave/Opera/Vivaldi, Firefox, Safari/iCloud, LastPass, Dashlane, KeePass/KeePassXC, generic CSV, Strongroom backups
- **Export**: encrypted backup, JSON, CSV
- **Desktop integration**: system tray, global shortcuts (rebindable), `strongroom://item/<id>` links, CLI flags `--silent --lock --toggle --quick-access`, start at login, Large Type, light/dark/system theme, density, zoom

## Roadmap (not in phase 1)

| Phase | Feature | Why it's later |
|---|---|---|
| next | Sync attachments; detect server rollback of records | Attachments need chunked upload; rollback needs a signed account history |
| next | Family/team sharing, share-by-link, admin roles, account recovery | Needs a public-key sharing model on top of sync |
| later | Browser extension: fill identities and cards, passkeys, generator in sign-up forms, Firefox/Safari, Chrome Web Store listing | Needs per-field form heuristics and store review |
| 3 | Passkeys (OS-level passkey provider) | Needs the Windows plugin-authenticator COM API or the browser extension |
| 3 | Virtual payment cards (wallet) | Needs agreements with card providers; card items are supported now |
| 3 | Verifier (identity checks between people) | Needs accounts (phase 2) |
| — | Other developer tools (CLI, environments, MCP, Git commit signing) | Out of scope by request |
| later | ECDSA SSH keys, importing passphrase-protected OpenSSH-format keys, showing which app asked for a key | Needs bcrypt-pbkdf and a native lookup of the pipe's client process |
