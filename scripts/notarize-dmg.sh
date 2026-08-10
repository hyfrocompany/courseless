#!/usr/bin/env bash
# Sign, notarize and staple the disk image, then repair the digest in latest-mac.yml.
#
# The .app inside was already notarized and stapled by scripts/notarize.cjs during the build, but
# a .dmg is a separate signed object with its own cdhash. Without this step `spctl` on the
# download reports "no usable signature", which is what a careful user sees when they check before
# opening it.
#
# Stapling rewrites the file, so the sha512 electron-builder recorded for the DMG goes stale.
# Nothing reads that entry (mac updates come from the ZIP), but a wrong digest in a published feed
# is a trap for whoever reads it next, so it is recomputed here.
#
# Credentials: APPLE_API_KEY / APPLE_API_KEY_ID / APPLE_API_ISSUER when present (CI), otherwise the
# courseless-notary keychain profile (a developer's Mac).
#
#   scripts/notarize-dmg.sh release/Courseless.dmg release/latest-mac.yml

set -euo pipefail

dmg="${1:?usage: notarize-dmg.sh <dmg> <latest-mac.yml>}"
yml="${2:?usage: notarize-dmg.sh <dmg> <latest-mac.yml>}"
identity="${COURSELESS_SIGN_IDENTITY:-Developer ID Application: Speakl Inc. (A8PGTML9XS)}"

if [ -n "${APPLE_API_KEY:-}" ] && [ -n "${APPLE_API_KEY_ID:-}" ] && [ -n "${APPLE_API_ISSUER:-}" ]; then
  auth=(--key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER")
else
  auth=(--keychain-profile "${COURSELESS_NOTARY_PROFILE:-courseless-notary}")
fi

echo "==> signing the disk image"
codesign --force --timestamp --sign "$identity" "$dmg"

echo "==> notarizing the disk image"
xcrun notarytool submit "$dmg" "${auth[@]}" --wait

echo "==> stapling"
xcrun stapler staple "$dmg"

node -e '
const fs = require("fs"), crypto = require("crypto")
const [yml, dmg] = process.argv.slice(1)
const buf = fs.readFileSync(dmg)
const sha = crypto.createHash("sha512").update(buf).digest("base64")
const text = fs.readFileSync(yml, "utf8")
const next = text.replace(/(- url: Courseless\.dmg\n\s+sha512: )[^\n]+(\n\s+size: )\d+/, `$1${sha}$2${buf.length}`)
if (next === text) { console.error("could not find the dmg entry in " + yml); process.exit(1) }
fs.writeFileSync(yml, next)
console.log("latest-mac.yml: dmg digest refreshed after stapling")
' "$yml" "$dmg"

# The stapled bytes no longer match it, and nothing reads it: mac updates come from the ZIP.
rm -f "$dmg.blockmap"
