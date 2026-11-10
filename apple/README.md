# Boltwork for Mac, iPhone and iPad

A native SwiftUI app that opens the same `vault.json` as the desktop app and syncs with the same server.

- `BoltworkKit/` — the vault format, crypto (Argon2id, BLAKE2b, XChaCha20-Poly1305), items, generator, Watchtower and sync client, as a Swift package.
- `Boltwork/` — the app: one target for iOS and macOS.
- `AutoFill/` — the AutoFill extension: fills passwords and passkeys, and saves new passkeys, in apps and websites.
- `Common/` — what the app and the extension share: the vault's location in the app group, the Keychain and quick unlock.
- `BrowserHost/` — the Mac's native messaging host for the browser extension (Chrome, Edge, Brave).
- `BoltworkUITests/` — an end-to-end UI test: create a vault, add a login, lock and unlock.
- `tools/` — scripts that check the Swift code against the TypeScript core and a real sync server.

## Build

Requires Xcode 27 and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```bash
cd apple && xcodegen && open Boltwork.xcodeproj
```

Re-run `xcodegen` after adding or removing files. To run on a device, or to use Face ID / Touch ID quick unlock on the Mac, set your team under Signing & Capabilities.

## Test

```bash
cd apple/BoltworkKit && swift test
```

```bash
cd apple && xcodebuild test -project Boltwork.xcodeproj -scheme Boltwork -destination 'platform=iOS Simulator,name=iPhone 18 Pro'
```

Fixtures in `BoltworkKit/Tests/BoltworkKitTests/Fixtures` are made by the TypeScript core (`node tools/make-fixtures.mjs`), so the tests prove both apps read each other's vaults.

## AutoFill and passkeys

The vault, its Keychain items and quick-unlock settings live in the app group `group.app.boltwork.apple`, which
the AutoFill extension shares; the app moves them there on first launch. The extension unlocks with Face ID or
Touch ID only (the account password's Argon2 key derivation needs more memory than an extension gets), so turn
on quick unlock in Settings, then turn on AutoFill there. Passkeys use the desktop app's format, so a passkey
made on any device signs in on all of them.

To check passkeys by hand, serve a WebAuthn test page on `http://localhost` and open it in Safari on a simulator
with Face ID enrolled (Features → Face ID → Matching Face). Register saves the passkey through "Save in Boltwork";
Sign In uses it through "More from Boltwork…". On `localhost` the system sheet didn't suggest the saved passkey
directly, even after the app refreshed its AutoFill list; that still needs checking on a real domain. `AutoFillUITests` runs the same steps when
`TEST_RUNNER_BOLTWORK_PASSKEY_PAGE` is set, and is skipped otherwise.

Mac debug builds are signed ad hoc and can't carry the app group, so AutoFill on the Mac needs a team: set it
under Signing & Capabilities and remove the `CODE_SIGN_IDENTITY` and `CODE_SIGN_ENTITLEMENTS` Debug lines in
`project.yml`.

## Mac disk image for other people

`tools/make-dmg.sh` builds a signed, notarized `release/Boltwork-<version>.dmg` that opens on any Mac without warnings.
One-time setup:

1. Create a **Developer ID Application** certificate: Xcode → Settings → Accounts → your team → Manage Certificates → + .
   Only the team's Account Holder can create one.
2. Save notarization credentials in your keychain. Make an app-specific password at account.apple.com first, then:

   ```bash
   xcrun notarytool store-credentials boltwork-notary --apple-id <your Apple ID> --team-id <your team ID>
   ```

Then build it:

```bash
TEAM_ID=<your team ID> apple/tools/make-dmg.sh
```

It archives the app, exports it with Developer ID, puts it on a disk image next to an Applications link, signs and
notarizes the image and staples the ticket. `SKIP_NOTARIZE=1` stops after signing; `MACOS_MIN` sets the oldest
macOS it runs on (default 26.0).

## App Store

`tools/make-app-store.sh` archives the iPhone/iPad and Mac apps with the **AppStore** configuration and exports
them to `build/app-store/` (`UPLOAD=1` sends them to App Store Connect instead):

```bash
TEAM_ID=<your team ID> apple/tools/make-app-store.sh
```

The AppStore configuration is Release, except that the Mac app leaves out the browser link: the Mac App Store
doesn't allow its access to each browser's folders, so the browser connector and its setting are removed. The
notarized DMG keeps it. Both apps carry a privacy manifest (`PrivacyInfo.xcprivacy`) that declares no data
collection or tracking. Sync settings include **Delete Account**, which the App Store requires for apps that create
accounts.

## Mac: SSH agent and browser extension

- **SSH agent** (Settings → SSH): serves SSH Key items to ssh and git, and asks before each use. Point ssh at it
  with the `IdentityAgent` line Settings shows.
- **Browser extension** (Settings → Browser): registers the native messaging host with Chrome, Edge, Brave and
  Chromium, the same host name the desktop app uses, so the same extension works with either; whichever app
  turned its link on last is the one the browser reaches. The app serves its socket from its sandbox container
  (the sandbox won't let it serve one in `~/.boltwork` like the desktop app does).

## Not yet ported

Import/export. Password strength is an approximation of zxcvbn.
