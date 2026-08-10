#!/usr/bin/env bash
# Build resources/mac/courseless-ax — the darwin accessibility + capture helper.
#
# Universal (arm64 + x86_64) when the toolchain can produce both slices, arm64-only with a loud
# warning when it cannot. Deployment target is macOS 14: ScreenCaptureKit's SCScreenshotManager
# (the only capture API left after CGWindowListCreateImage was obsoleted in the macOS 15 SDK)
# arrived there.
#
# The binary ships in Contents/Resources via extraResources and is signed as a nested Mach-O by
# @electron/osx-sign. It carries no entitlements of its own on purpose: TCC attributes accessibility
# and screen-recording grants to the RESPONSIBLE process, which is the .app that spawned it.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$root/resources/mac/courseless-ax.swift"
out="$root/resources/mac/courseless-ax"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

[ -f "$src" ] || { echo "missing $src" >&2; exit 1; }

compile() { # arch -> slice
  xcrun swiftc -O -whole-module-optimization \
    -target "$1-apple-macos14.0" \
    -sdk "$(xcrun --sdk macosx --show-sdk-path)" \
    -o "$tmp/courseless-ax-$1" "$src"
}

echo "building arm64…"
compile arm64

if compile x86_64 2>"$tmp/x86.log"; then
  echo "building x86_64… ok"
  lipo -create "$tmp/courseless-ax-arm64" "$tmp/courseless-ax-x86_64" -output "$out"
else
  echo "WARNING: x86_64 slice failed to build on this toolchain — shipping arm64 only." >&2
  sed -n '1,12p' "$tmp/x86.log" >&2 || true
  cp "$tmp/courseless-ax-arm64" "$out"
  # Re-run this script on a toolchain with the x86_64 macOS SDK stubs to get the universal binary:
  # lipo -create "$tmp/courseless-ax-arm64" "$tmp/courseless-ax-x86_64" -output "$out"
fi

chmod +x "$out"
codesign --force --sign - "$out" 2>/dev/null || true
lipo -info "$out"
echo "built $out"
