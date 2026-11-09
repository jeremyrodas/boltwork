#!/bin/zsh
# Builds a notarized Boltwork.dmg for the Mac that anyone can open, in release/ at the repository root.
#
# One-time setup (see apple/README.md):
#   - a "Developer ID Application" certificate in your keychain (Xcode → Settings → Accounts → Manage Certificates)
#   - notarization credentials saved under a profile:  xcrun notarytool store-credentials boltwork-notary
#
# Usage:  TEAM_ID=<your team ID> apple/tools/make-dmg.sh
#   NOTARY_PROFILE  keychain profile for notarytool (default boltwork-notary)
#   MACOS_MIN       oldest macOS the build runs on (default 26.0)
#   SKIP_NOTARIZE=1 build and sign only, to check the steps before notarizing
set -euo pipefail

: "${TEAM_ID:?Set TEAM_ID to your Apple Developer team ID}"
NOTARY_PROFILE="${NOTARY_PROFILE:-boltwork-notary}"
MACOS_MIN="${MACOS_MIN:-26.0}"

APPLE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(dirname "$APPLE")"
WORK="$APPLE/build/dmg"
VERSION="$(grep -m1 'MARKETING_VERSION' "$APPLE/project.yml" | sed -E 's/.*"(.*)".*/\1/')"
DMG="$ROOT/release/Boltwork-$VERSION.dmg"

if ! security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
  echo "No \"Developer ID Application\" certificate in your keychain. Create one in Xcode → Settings → Accounts → Manage Certificates." >&2
  exit 1
fi

rm -rf "$WORK" && mkdir -p "$WORK" "$ROOT/release"
cd "$APPLE"
command -v xcodegen >/dev/null && xcodegen --quiet

echo "→ Archiving"
xcodebuild archive -project Boltwork.xcodeproj -scheme Boltwork -configuration Release \
  -destination 'generic/platform=macOS' -archivePath "$WORK/Boltwork.xcarchive" \
  -allowProvisioningUpdates DEVELOPMENT_TEAM="$TEAM_ID" MACOSX_DEPLOYMENT_TARGET="$MACOS_MIN" -quiet

echo "→ Exporting with Developer ID"
cat > "$WORK/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>developer-id</string>
  <key>signingStyle</key><string>automatic</string>
  <key>teamID</key><string>$TEAM_ID</string>
</dict>
</plist>
PLIST
xcodebuild -exportArchive -archivePath "$WORK/Boltwork.xcarchive" -exportPath "$WORK/export" \
  -exportOptionsPlist "$WORK/ExportOptions.plist" -allowProvisioningUpdates -quiet
APP="$WORK/export/Boltwork.app"
codesign --verify --deep --strict "$APP"

echo "→ Making the disk image"
mkdir -p "$WORK/stage"
ditto "$APP" "$WORK/stage/Boltwork.app"
ln -s /Applications "$WORK/stage/Applications"
rm -f "$DMG"
hdiutil create -volname "Boltwork $VERSION" -srcfolder "$WORK/stage" -fs APFS -format ULFO -quiet "$DMG"
IDENTITY="$(security find-identity -v -p codesigning | grep "Developer ID Application" | grep "($TEAM_ID)" | head -1 | awk '{print $2}')"
codesign --sign "$IDENTITY" --timestamp "$DMG"

if [[ "${SKIP_NOTARIZE:-}" == 1 ]]; then
  echo "Signed, not notarized: $DMG"
  exit 0
fi

echo "→ Notarizing (usually a few minutes)"
xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
xcrun stapler staple "$DMG"
spctl --assess --type open --context context:primary-signature --verbose "$DMG"
echo "Done: $DMG"
