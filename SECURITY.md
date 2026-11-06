# Boltwork security design

This describes what protects your data and what each part of the system can see. Please report problems privately to the maintainers before publishing them.

## Keys

- **Account password**: chosen by you, never stored or sent anywhere.
- **Secret Key**: 128 random bits made on your first computer (`SR1-…`), kept on each device with the operating system's protected storage (DPAPI, Keychain, libsecret) and in your Emergency Kit. Never sent anywhere.
- **Account key (KEK)**: Argon2id(password, salt; 128 MiB, 3 passes), then keyed BLAKE2b with the Secret Key. Because of the Secret Key, guessing passwords against stolen data is infeasible even for weak passwords.
- **Master key**: 256 random bits that encrypt everything. Stored only wrapped (XChaCha20-Poly1305) by the account key. Changing your password re-wraps it; nothing else is re-encrypted.

## Quick unlock (Windows Hello or PIN)

Optional, per device, and only turned on after entering the account password. It stores a copy of the master key on this device,
sealed with a quick key that always mixes in a random device secret protected by the OS for this Windows user (DPAPI), so the copy is useless elsewhere.

- **Windows Hello**: quick key = BLAKE2b(key = device secret, Hello signature over a random challenge). The Hello key is created by Windows'
  KeyCredentialManager, kept in the TPM/Hello container, and only signs after face, fingerprint or Windows PIN. Boltwork checks the signature is
  repeatable before relying on it.
- **Boltwork PIN**: quick key = BLAKE2b(key = device secret, Argon2id(PIN; 64 MiB, 3 passes)). Five wrong PINs in a row delete the stored copy.
  Someone already signed in to Windows as you can read the device secret and try PINs offline, so a PIN only protects against people without
  your Windows account; use 6 or more characters.
- Both stop working 14 days after the last password unlock, and are separate from the Secret Key, which is still needed on any new computer.

## Data at rest

The vault file holds one record per vault, collection and item, each sealed with XChaCha20-Poly1305 under the master key.
Each record's associated data is `strongroom:record:v2:<kind>:<id>`, so a record can't be moved to another id or kind without detection.
Search history and the Pwned Passwords cache are sealed separately and never synced. Attachments are sealed one file at a time.

## Sync server

The server stores, per account: an email, a SHA-256 of the **auth key**, the KDF parameters (salt and costs, which are not secret), the wrapped master key, and the sealed records with their revision numbers.

- **Auth key** = BLAKE2b-256(key = account key, message = `strongroom:sync-auth:v1`). It's a one-way derivative of the account key, so neither it nor its hash helps decrypt anything.
  It's sent over HTTPS when signing in. A malicious server could learn it and pretend to be you *to itself*, but still can't read your data, because the master key is wrapped by the account key, which needs your password and Secret Key.
- **New device**: the app asks for the server address, email, password and Secret Key, fetches the KDF parameters (`/prelogin`), derives the account key locally, signs in, then unwraps the master key it gets back.
- **Unknown emails** get stable fake KDF parameters from `/prelogin`, so it doesn't reveal who has an account.
- **Sessions**: random 256-bit bearer tokens, stored hashed on the server and with protected storage on devices; 30-day sliding expiry. A password change signs out other devices.
- **Rate limits** on sign-up, prelogin and sign-in, per IP address and per email.

### What a malicious or compromised server can do

- Refuse service, delete records, or serve an **older version** of a record it saw before (rollback). Boltwork keeps a full local copy and item history, which limits the damage, but it can't currently detect rollback of a single record.
- See metadata: how many records you have, their sizes, kinds (vault, collection or item), ids and when they change, plus your email and IP address.

It **can't** read or undetectably alter any record's contents, swap records between ids, or learn your password, Secret Key or master key.

## Browser extension

The desktop app talks to the extension only through Chrome native messaging, and only trusts the extension ID fixed by the key in `extension/manifest.json`.
Each browser is approved once in the app after matching a code. Pages only learn logins for their own registrable domain (from the URL Chrome reports, not the page),
and only receive a password when the user picks a login. The extension's UI lives in closed shadow roots and only reacts to trusted clicks.

## SSH agent

Private keys never leave the app. Every signature needs approval (Allow, Allow until locked, Deny); approvals are forgotten on lock.

## Known limits

- No protection against malware running as you on an unlocked computer.
- Sync doesn't detect a server rolling back individual records.
- Attachments don't sync yet.
- Sharing (multiple people per vault) isn't built yet.
