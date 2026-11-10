# Publishing the browser extension

Store listings let people add Boltwork with one click ("Add to Chrome"), without Developer mode, and the
extension updates itself. Until then, the Mac app's **Add to Chrome…** buttons (Settings → Browser) and the Windows app's **Show folder** steps walk through loading it unpacked.

## 1. Package it

```bash
node scripts/build.mjs
node scripts/package-extension.mjs
```

This writes `release/boltwork-extension-<version>.zip` (the manifest without its `key`, which the stores refuse).
Bump `version` in `extension/manifest.json` for each new upload.

## 2. Chrome Web Store (Chrome, Brave, Chromium)

1. Register at the Chrome Web Store Developer Dashboard (one-time US$5 fee) and verify your email.
2. **New item** → upload the zip.
3. Store listing: use the text below, the 128 px icon from `dist-extension/icons/128.png`, and at least one
   1280×800 screenshot (the fill menu on a login page and the popup).
4. Privacy practices: fill in the single purpose and permission reasons below. Data usage: no data is collected
   or sent anywhere; the extension only talks to the Boltwork app on the same computer.
5. Submit for review (usually a few days).

## 3. Microsoft Edge Add-ons

Register in Microsoft Partner Center (free), create a new extension, upload the same zip, and reuse the text below.

## 4. After approval

Each store shows the extension's ID. Add both to `STORE_EXTENSION_IDS` in `src/core/extensionId.ts` so the apps
accept connections from the store copies, and point the apps' buttons at the store pages.

## Listing text

**Name:** Boltwork

**Summary (132 characters max):** Fill and save logins, one-time codes and passkeys from the Boltwork password manager on your computer.

**Description:**
Boltwork keeps your logins, passkeys and one-time codes in an end-to-end encrypted vault on your own computer.
This extension connects your browser to the Boltwork app:

- A menu under login fields fills your username, password or one-time code. Ctrl+Shift+L fills the best match.
- Offers to save new logins and update changed passwords.
- Creates and uses passkeys from your Boltwork vault.

The extension talks only to the Boltwork app on the same computer. Each browser is approved once in the app with a
matching code, and pages only get logins for their own site. Requires the Boltwork app for Windows or Mac.

**Single purpose:** Fill and save logins, one-time codes and passkeys from the user's Boltwork password manager.

**Permission reasons:**
- `nativeMessaging`: talks to the Boltwork app on this computer, which holds the vault.
- `storage`: remembers this browser's pairing with the app.
- `activeTab`: fills the login form on the page the user is on when they use the popup or shortcut.
- `clipboardWrite`: copies a password or code when the user asks.
- Host access (content scripts on https pages): shows the fill menu under login fields and offers to save new logins.
