// Reading the two public values the app needs to reach its backend.
//
// In development they sit in .env.local at the repo root; in a packaged app they come from the
// real environment, injected at build time by whatever ships the binary. Neither is a secret —
// the anon key is public by design and every row is protected by policy — but they are still
// configuration, so they are never written into the source and never handed to a renderer.

import { existsSync, readFileSync } from 'node:fs'
import { log } from './log'

/** Minimal KEY=VALUE reader. Existing environment always wins; no dependency, no expansion. */
export function loadEnvFile(file: string): void {
  if (!existsSync(file)) return
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (e) {
    log('env', 'could not read', file, String(e).slice(0, 120))
    return
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

/**
 * Compiled in by electron.vite.config.ts. A packaged app has no .env.local beside it and no shell
 * environment to inherit, so the two public values have to travel inside the bundle or a
 * downloaded copy could never reach the backend. `typeof` rather than a bare read: an unreplaced
 * identifier would be a ReferenceError, and typeof on an undeclared name is the one safe probe.
 */
declare const __BAKED_SUPABASE_URL__: string
declare const __BAKED_SUPABASE_ANON_KEY__: string
declare const __BAKED_SITE_URL__: string

function baked(name: 'url' | 'anonKey' | 'siteUrl'): string {
  try {
    if (name === 'url') return typeof __BAKED_SUPABASE_URL__ === 'string' ? __BAKED_SUPABASE_URL__ : ''
    if (name === 'anonKey')
      return typeof __BAKED_SUPABASE_ANON_KEY__ === 'string' ? __BAKED_SUPABASE_ANON_KEY__ : ''
    return typeof __BAKED_SITE_URL__ === 'string' ? __BAKED_SITE_URL__ : ''
  } catch {
    return ''
  }
}

/** Where the sign-in page lives when neither the environment nor the build says. */
const DEFAULT_SITE_URL = 'https://courseless.hyfro.org'

export interface BackendConfig {
  url: string
  anonKey: string
  /** The site the browser handoff opens. */
  siteUrl: string
}

/**
 * Null means the app was built or started without a backend configured. Everything still runs —
 * the library, the runner, the recorder — but the account and the engine will say so out loud
 * rather than fail with a network error nobody can act on.
 */
export function backendConfig(): BackendConfig | null {
  // A real environment variable always wins: pointing a build at a staging project is a matter of
  // exporting one name, not of rebuilding.
  const url = ((process.env.VITE_SUPABASE_URL ?? '').trim() || baked('url')).trim().replace(/\/+$/, '')
  const anonKey = ((process.env.VITE_SUPABASE_ANON_KEY ?? '').trim() || baked('anonKey')).trim()
  const siteUrl = ((process.env.VITE_SITE_URL ?? '').trim() || baked('siteUrl') || DEFAULT_SITE_URL)
    .trim()
    .replace(/\/+$/, '')
  if (!url || !anonKey) return null
  return { url, anonKey, siteUrl }
}
