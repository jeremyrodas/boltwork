# Boltwork for Mac and iPhone

A native SwiftUI app that opens the same `vault.json` as the desktop app and syncs with the same server.

- `BoltworkKit/` — the vault format, crypto (Argon2id, BLAKE2b, XChaCha20-Poly1305), items, generator, Watchtower and sync client, as a Swift package.
- `Boltwork/` — the app: one target for iOS and macOS.
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

## Not yet ported

SSH agent, browser extension, AutoFill and passkey creation, and import/export. Password strength is an approximation of zxcvbn.
