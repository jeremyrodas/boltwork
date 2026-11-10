#!/bin/zsh
# Builds Boltwork for the App Store (iPhone and iPad, and Mac) with the AppStore configuration, and exports
# them to apple/build/app-store/, or uploads them to App Store Connect with UPLOAD=1.
#
# Needs an app record for app.boltwork.apple in App Store Connect before uploading (see apple/README.md).
#
# Usage:  TEAM_ID=<your team ID> apple/tools/make-app-store.sh
#   PLATFORMS  "ios macos" (default), or just one of them
#   UPLOAD=1   send the builds to App Store Connect instead of exporting them
set -euo pipefail

: "${TEAM_ID:?Set TEAM_ID to your Apple Developer team ID}"
PLATFORMS="${PLATFORMS:-ios macos}"

APPLE="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$APPLE/build/app-store"
rm -rf "$WORK" && mkdir -p "$WORK"
cd "$APPLE"
command -v xcodegen >/dev/null && xcodegen --quiet

cat > "$WORK/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$([[ "${UPLOAD:-}" == 1 ]] && echo upload || echo export)</string>
  <key>signingStyle</key><string>automatic</string>
  <key>teamID</key><string>$TEAM_ID</string>
</dict>
</plist>
PLIST

for platform in ${=PLATFORMS}; do
  case $platform in
    ios) destination='generic/platform=iOS' ;;
    macos) destination='generic/platform=macOS' ;;
    *) echo "Unknown platform: $platform" >&2; exit 1 ;;
  esac
  echo "→ Archiving for $platform"
  xcodebuild archive -project Boltwork.xcodeproj -scheme Boltwork -configuration AppStore \
    -destination "$destination" -archivePath "$WORK/$platform.xcarchive" \
    -allowProvisioningUpdates DEVELOPMENT_TEAM="$TEAM_ID" -quiet
  echo "→ $([[ "${UPLOAD:-}" == 1 ]] && echo Uploading || echo Exporting) for $platform"
  xcodebuild -exportArchive -archivePath "$WORK/$platform.xcarchive" -exportPath "$WORK/$platform" \
    -exportOptionsPlist "$WORK/ExportOptions.plist" -allowProvisioningUpdates -quiet
done
echo "Done: $WORK"
