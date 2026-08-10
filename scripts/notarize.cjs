// electron-builder afterSign hook: notarize the signed .app, then staple the ticket to it.
//
// This runs BEFORE the DMG and the update ZIP are packed, which is the whole point — stapling the
// .app means both artifacts ship with the ticket inside, and a first launch works with no network.
//
// Credentials come from a notarytool keychain profile, so nothing secret is ever in the repo, in
// the environment, or in a log line. Create it once:
//   xcrun notarytool store-credentials courseless-notary \
//     --apple-id <apple-id> --team-id A8PGTML9XS --password <app-specific-password>
//
// Set SKIP_NOTARIZE=1 for a local unsigned smoke build.

const { execFileSync } = require('node:child_process')
const { basename, join } = require('node:path')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')

const PROFILE = process.env.COURSELESS_NOTARY_PROFILE || 'courseless-notary'

/**
 * A universal build packs x64 and arm64 into throwaway directories first and merges them, and the
 * hook fires for each pass. Only the merged bundle is worth an upload to Apple.
 */
function isFinalBundle(appOutDir) {
  const dir = basename(appOutDir)
  return !dir.includes('temp')
}

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return
  if (!isFinalBundle(appOutDir)) {
    console.log(`  • notarize    skipped (intermediate arch build: ${basename(appOutDir)})`)
    return
  }
  if (process.env.SKIP_NOTARIZE === '1') {
    console.log('  • notarize    skipped (SKIP_NOTARIZE=1)')
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = join(appOutDir, `${appName}.app`)
  const work = mkdtempSync(join(tmpdir(), 'courseless-notary-'))
  const zipPath = join(work, `${appName}.zip`)

  try {
    console.log(`  • notarize    submitting ${appPath}`)
    // notarytool wants an archive, and ditto is the only zipper that preserves the symlinks and
    // extended attributes inside a .app.
    execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zipPath], {
      stdio: 'inherit'
    })
    execFileSync(
      'xcrun',
      ['notarytool', 'submit', zipPath, '--keychain-profile', PROFILE, '--wait'],
      { stdio: 'inherit' }
    )
    execFileSync('xcrun', ['stapler', 'staple', appPath], { stdio: 'inherit' })
    console.log('  • notarize    stapled')
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
