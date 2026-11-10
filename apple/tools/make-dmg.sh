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
echo "→ Building the browser extension"
(cd "$ROOT" && node scripts/build.mjs >/dev/null)
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
ICON="$APP/Contents/Resources/AppIcon.icns"
VOLNAME="Boltwork"
mkdir -p "$WORK/stage"
ditto "$APP" "$WORK/stage/Boltwork.app"
ln -s /Applications "$WORK/stage/Applications"
hdiutil create -volname "$VOLNAME" -srcfolder "$WORK/stage" -fs HFS+ -format UDRW -size 200m -quiet "$WORK/rw.dmg"

# Lay out the window Finder opens: just the app and the Applications link, large, with no toolbar or sidebar.
[[ -d "/Volumes/$VOLNAME" ]] && hdiutil detach "/Volumes/$VOLNAME" -quiet
MOUNT="$(hdiutil attach "$WORK/rw.dmg" -readwrite -noverify -noautoopen | awk -F'\t' '/\/Volumes\//{print $NF}')"
osascript <<APPLESCRIPT
tell application "Finder"
  tell disk "$VOLNAME"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set bounds of container window to {200, 120, 860, 520}
    set opts to the icon view options of container window
    set arrangement of opts to not arranged
    set icon size of opts to 128
    set text size of opts to 14
    set position of item "Boltwork.app" of container window to {170, 180}
    set position of item "Applications" of container window to {490, 180}
    update without registering applications
    delay 1
    close
  end tell
end tell
APPLESCRIPT
# The disk's own icon goes on after Finder is done with the window, which otherwise drops it.
cp "$ICON" "$MOUNT/.VolumeIcon.icns"
SetFile -a C "$MOUNT"
rm -rf "$MOUNT/.fseventsd"
sync
hdiutil detach "$MOUNT" -quiet
rm -f "$DMG"
hdiutil convert "$WORK/rw.dmg" -format ULFO -o "$DMG" -quiet
IDENTITY="$(security find-identity -v -p codesigning | grep "Developer ID Application" | grep "($TEAM_ID)" | head -1 | awk '{print $2}')"
codesign --sign "$IDENTITY" --timestamp "$DMG"

if [[ "${SKIP_NOTARIZE:-}" != 1 ]]; then
  echo "→ Notarizing (usually a few minutes)"
  xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$DMG"
  spctl --assess --type open --context context:primary-signature --verbose "$DMG"
fi

# The .dmg file shows the app icon in Finder too (kept on this Mac; some downloads drop it, the mounted disk keeps its own).
osascript -l JavaScript -e "ObjC.import('AppKit'); \$.NSWorkspace.sharedWorkspace.setIconForFileOptions(\$.NSImage.alloc.initWithContentsOfFile('$ICON'), '$DMG', 0)" >/dev/null
echo "Done: $DMG"
