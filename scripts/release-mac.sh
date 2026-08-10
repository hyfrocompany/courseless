#!/usr/bin/env bash
# Build, sign, notarize, staple and publish the macOS release. Run it on a Mac with the Developer
# ID certificate in the login keychain and a notarytool profile called courseless-notary.
#
# The Mac half of a release is deliberately local. Windows is built by GitHub Actions on a tag,
# unsigned, and lands on the same release; nothing in CI ever touches the signed Mac artifacts.
#
#   npm run release:mac              build, verify, upload to the release for the current version
#   npm run release:mac -- --no-upload   everything except gh release create/upload
#
# What ends up on the release, and why each one is needed:
#   Courseless.dmg            what a human downloads. Filename is locked; the site links to it.
#   Courseless-<v>-universal-mac.zip   what electron-updater downloads. A Mac cannot self-update
#                             from a DMG, so leaving this off silently breaks every future update.
#   latest-mac.yml            the feed electron-updater reads.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

upload=1
for arg in "$@"; do
  case "$arg" in
    --no-upload) upload=0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

version="$(node -p "require('./package.json').version")"
tag="v$version"
out="$root/release"
app="$out/mac-universal/Courseless.app"
dmg="$out/Courseless.dmg"
# The ZIP keeps electron-builder's own versioned name (only the DMG and the EXE are locked, because
# only those two are linked from the site), so it is found rather than spelled out.
zip=""

echo "==> Courseless $tag"

# The identity has to exist before a twenty-minute build finds out it does not.
if ! security find-identity -v -p codesigning | grep -q "Developer ID Application: Speakl Inc. (A8PGTML9XS)"; then
  echo "missing signing identity: Developer ID Application: Speakl Inc. (A8PGTML9XS)" >&2
  exit 1
fi
if ! xcrun notarytool history --keychain-profile courseless-notary >/dev/null 2>&1; then
  echo "missing notarytool keychain profile 'courseless-notary'." >&2
  echo "create it: xcrun notarytool store-credentials courseless-notary --apple-id <id> --team-id A8PGTML9XS --password <app-specific-password>" >&2
  exit 1
fi

# The accessibility helper is a build product, not a source file, and it is what pointing is.
if [ ! -x "$root/resources/mac/courseless-ax" ]; then
  echo "==> building the macOS accessibility helper"
  bash "$root/scripts/build-mac-helper.sh"
fi

echo "==> electron-vite build"
npx electron-vite build

echo "==> electron-builder (universal, signed, notarized, stapled)"
# The identity itself is pinned in electron-builder.yml (mac.identity).
rm -rf "$out"
npx electron-builder --mac --publish never

test -f "$dmg" || { echo "no $dmg" >&2; exit 1; }
zip="$(ls -1 "$out"/*.zip 2>/dev/null | head -1 || true)"
[ -n "$zip" ] || { echo "no .zip in $out — electron-updater cannot update a Mac from a DMG" >&2; exit 1; }
test -f "$out/latest-mac.yml" || { echo "no latest-mac.yml — the updater feed is missing" >&2; exit 1; }

echo
bash "$root/scripts/notarize-dmg.sh" "$dmg" "$out/latest-mac.yml"

echo
echo "==> verification"
echo "--- codesign --verify --deep --strict"
codesign --verify --deep --strict --verbose=2 "$app"
echo "--- codesign of the nested accessibility helper"
codesign --verify --strict --verbose=2 "$app/Contents/Resources/mac/courseless-ax"
echo "--- spctl (Gatekeeper, primary signature)"
spctl -a -t open --context context:primary-signature -vv "$dmg"
echo "--- stapler validate (dmg)"
xcrun stapler validate "$dmg"
echo "--- stapler validate (app)"
xcrun stapler validate "$app"
echo "--- resources that main/index.ts expects under process.resourcesPath"
ls -1 "$app/Contents/Resources/mac/courseless-ax"
echo "seed-lessons: $(ls -1 "$app/Contents/Resources/seed-lessons" | wc -l | tr -d ' ') files"

if [ "$upload" -eq 0 ]; then
  echo
  echo "built and verified; skipping upload (--no-upload)"
  exit 0
fi

echo
echo "==> GitHub release $tag"
if ! gh release view "$tag" >/dev/null 2>&1; then
  gh release create "$tag" --title "Courseless $version" --notes "Courseless $version" --latest
fi

# --clobber so re-running the script after a fix replaces the artifact instead of erroring. The
# blockmaps make electron-updater download only the changed bytes; harmless when absent.
files=("$dmg" "$zip" "$out/latest-mac.yml")
[ -f "$zip.blockmap" ] && files+=("$zip.blockmap")
[ -f "$dmg.blockmap" ] && files+=("$dmg.blockmap")
gh release upload "$tag" "${files[@]}" --clobber

echo
echo "uploaded to $(gh release view "$tag" --json url -q .url)"
gh release view "$tag" --json assets -q '.assets[].name'
