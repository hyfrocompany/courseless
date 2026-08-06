// Locate the REAL codex native binary.
//
// Per the verified integration guide: on Windows there is no `codex.exe` on PATH — npm installs
// only `codex` (sh), `codex.cmd` and `codex.ps1` shims that hop through node. Spawning the native
// exe directly removes the shim + node hop and makes taskkill behave.

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { log } from '../../util/log'

const EXE_NAME = process.platform === 'win32' ? 'codex.exe' : 'codex'

function triple(): string {
  if (process.platform === 'win32') return 'x86_64-pc-windows-msvc'
  if (process.platform === 'darwin')
    return process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
  return process.arch === 'arm64' ? 'aarch64-unknown-linux-musl' : 'x86_64-unknown-linux-musl'
}

function vendorPkgName(): string {
  const plat = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux'
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  return `codex-${plat}-${arch}`
}

/** Given a `@openai/codex` package root, produce candidate exe paths (nested + hoisted layouts). */
function candidatesFromPackageRoot(root: string): string[] {
  const vendor = vendorPkgName()
  const tail = join('vendor', triple(), 'bin', EXE_NAME)
  return [
    join(root, 'node_modules', '@openai', vendor, tail),
    // npm hoists the platform package next to @openai/codex
    join(root, '..', vendor, tail)
  ]
}

function packageRootCandidates(): string[] {
  const home = homedir()
  const roots: string[] = []

  // If @openai/codex ever becomes a dependency of this app, this wins.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkgJson = require.resolve('@openai/codex/package.json')
    roots.push(join(pkgJson, '..'))
  } catch {
    /* not a dependency — expected */
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming')
    const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local')
    roots.push(
      join(appData, 'npm', 'node_modules', '@openai', 'codex'),
      join(localAppData, 'pnpm', 'global', '5', 'node_modules', '@openai', 'codex'),
      join(home, '.bun', 'install', 'global', 'node_modules', '@openai', 'codex')
    )
  } else {
    roots.push(
      join(home, '.npm-global', 'lib', 'node_modules', '@openai', 'codex'),
      join(home, '.nvm', 'versions', 'node', 'lib', 'node_modules', '@openai', 'codex'),
      '/usr/local/lib/node_modules/@openai/codex',
      '/usr/lib/node_modules/@openai/codex',
      '/opt/homebrew/lib/node_modules/@openai/codex',
      join(home, '.bun', 'install', 'global', 'node_modules', '@openai', 'codex')
    )
  }
  return roots
}

let cached: string | null | undefined

/**
 * @param override explicit path (from config) — wins over discovery when it exists
 * @param force    bypass the cache
 */
export function resolveCodexExe(override?: string | null, force = false): string | null {
  if (!force && cached !== undefined) return cached

  const explicit = override || process.env.COURSELESS_CODEX_EXE
  if (explicit && existsSync(explicit)) {
    cached = explicit
    log('codex/resolve', 'using explicit codex path')
    return cached
  }

  for (const root of packageRootCandidates()) {
    for (const c of candidatesFromPackageRoot(root)) {
      if (existsSync(c)) {
        cached = c
        log('codex/resolve', 'found', c)
        return cached
      }
    }
  }

  // Last resort: ask npm where global packages live (slow, ~300ms, only on a cold miss).
  try {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const out = execFileSync(npmCmd, ['root', '-g'], {
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true,
      shell: process.platform === 'win32'
    }).trim()
    if (out) {
      for (const c of candidatesFromPackageRoot(join(out, '@openai', 'codex'))) {
        if (existsSync(c)) {
          cached = c
          log('codex/resolve', 'found via npm root -g', c)
          return cached
        }
      }
    }
  } catch {
    /* npm not available — fine */
  }

  // Non-Windows: the PATH entry is a real executable (symlink to the launcher), so it works.
  if (process.platform !== 'win32') {
    cached = 'codex'
    log('codex/resolve', 'falling back to PATH `codex`')
    return cached
  }

  cached = null
  log('codex/resolve', 'codex binary NOT FOUND')
  return cached
}
