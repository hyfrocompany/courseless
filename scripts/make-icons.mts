// Generate the two icon files electron-builder packages: build/icon.icns (macOS) and
// build/icon.png (Windows, converted to .ico during the build).
//
// The mark is drawn in code by src/main/util/icon.ts, which is also what the tray and the Dock
// use at runtime, so there is exactly one definition of the logo in the repo. macOS gets the
// inset variant because Apple's icon grid draws artwork at ~82% of its canvas; Windows wants the
// tile edge to edge.
//
//   npm run icons

import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { courselessDockIconPng, courselessIconPng } from '../src/main/util/icon'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'build')
mkdirSync(buildDir, { recursive: true })

writeFileSync(join(buildDir, 'icon.png'), courselessIconPng(1024))
console.log('wrote build/icon.png (1024)')

if (process.platform === 'darwin') {
  const iconset = join(buildDir, 'icon.iconset')
  rmSync(iconset, { recursive: true, force: true })
  mkdirSync(iconset)
  for (const size of [16, 32, 128, 256, 512]) {
    writeFileSync(join(iconset, `icon_${size}x${size}.png`), courselessDockIconPng(size))
    writeFileSync(join(iconset, `icon_${size}x${size}@2x.png`), courselessDockIconPng(size * 2))
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(buildDir, 'icon.icns')], {
    stdio: 'inherit'
  })
  rmSync(iconset, { recursive: true, force: true })
  console.log('wrote build/icon.icns')
} else {
  console.log('skipped icon.icns (needs iconutil, macOS only) — the committed one still applies')
}
