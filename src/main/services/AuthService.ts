// AuthService — the account, and the only place a token is ever held.
//
// The Supabase client runs in the MAIN process. The renderer sends an address and a password
// over IPC and gets back "done" or a sentence to show; it never sees an access token, and the
// session never reaches a window. On disk the session lives in <userData>/auth.json, encrypted
// with the OS keychain via Electron's safeStorage — plaintext only if the platform cannot
// encrypt at all, and then it says so in the log.

import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { safeStorage, shell } from 'electron'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AuthResult, AuthState, AuthUser } from '../../shared/types'
import { externalUrl } from '../util/links'
import { log } from '../util/log'

/** How often the app asks the handoff whether the browser is done. */
const HANDOFF_POLL_MS = 2_000
/** After this the wait is over — a tab left open for five minutes is a tab nobody came back to. */
const HANDOFF_TIMEOUT_MS = 5 * 60_000

/**
 * The storage supabase-js writes its session through. It keeps the whole map in memory and
 * rewrites one small file on every change — the file holds one key in practice.
 */
class EncryptedFileStorage {
  private cache: Record<string, string> | null = null
  private warned = false

  constructor(private file: string) {}

  private encryptionAvailable(): boolean {
    try {
      if (safeStorage.isEncryptionAvailable()) return true
    } catch {
      /* not ready, or not supported */
    }
    if (!this.warned) {
      this.warned = true
      log('auth', 'safeStorage unavailable — the session will be stored unencrypted', this.file)
    }
    return false
  }

  private load(): Record<string, string> {
    if (this.cache) return this.cache
    let map: Record<string, string> = {}
    try {
      if (existsSync(this.file)) {
        const outer = JSON.parse(readFileSync(this.file, 'utf8')) as { enc?: boolean; data?: unknown }
        if (outer?.enc && typeof outer.data === 'string') {
          map = JSON.parse(safeStorage.decryptString(Buffer.from(outer.data, 'base64')))
        } else if (outer && typeof outer.data === 'object' && outer.data) {
          map = outer.data as Record<string, string>
        }
      }
    } catch (e) {
      // A session we cannot read is a session we do not have. Start signed out rather than crash.
      log('auth', 'stored session unreadable — starting signed out', String(e).slice(0, 160))
      map = {}
    }
    this.cache = map
    return this.cache
  }

  private flush(): void {
    const data = this.cache ?? {}
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const body = this.encryptionAvailable()
        ? { enc: true, data: safeStorage.encryptString(JSON.stringify(data)).toString('base64') }
        : { enc: false, data }
      const tmp = `${this.file}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(body), { encoding: 'utf8', mode: 0o600 })
      renameSync(tmp, this.file)
    } catch (e) {
      log('auth', 'could not write the session', String(e).slice(0, 160))
    }
  }

  getItem(key: string): string | null {
    return this.load()[key] ?? null
  }

  setItem(key: string, value: string): void {
    this.load()[key] = value
    this.flush()
  }

  removeItem(key: string): void {
    delete this.load()[key]
    this.flush()
  }

  /**
   * Signing out should leave nothing behind, not an empty envelope.
   *
   * The refresh token is overwritten with zeroes before the file is unlinked. On a modern
   * copy-on-write filesystem that is not a guarantee the old bytes are gone — nothing in
   * userspace is — but it does mean the last version of the file at that path is not a token,
   * and it costs one write. The half-written `.tmp` an interrupted flush can leave behind goes
   * with it: same directory, same secret.
   */
  clear(): void {
    this.cache = {}
    for (const path of [this.file, `${this.file}.${process.pid}.tmp`]) {
      try {
        if (!existsSync(path)) continue
        try {
          writeFileSync(path, '0'.repeat(Math.max(64, statSync(path).size)), { encoding: 'utf8', mode: 0o600 })
        } catch {
          /* the unlink below is the part that matters */
        }
        unlinkSync(path)
      } catch {
        /* ignore */
      }
    }
  }
}

export interface AuthServiceOptions {
  url: string
  anonKey: string
  /** Where the sign-in page lives, e.g. https://courseless.vercel.app — no trailing slash. */
  siteUrl: string
  /** Where the encrypted session goes, e.g. <userData>/auth.json. */
  sessionFile: string
}

/** One browser handoff in flight. There is never more than one. */
interface Handoff {
  id: string
  cancelled: boolean
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Supabase says it in its own words; some of them are not sentences to show a person. */
function friendly(message: string): string {
  const m = message.trim()
  if (/invalid login credentials/i.test(m)) return 'That address and password do not match.'
  if (/email not confirmed/i.test(m)) return 'Confirm your address from the email we sent, then sign in.'
  if (/user already registered|already been registered/i.test(m))
    return 'There is already an account on that address. Sign in instead.'
  if (/password should be at least (\d+)/i.test(m))
    return `Use a password of at least ${m.match(/at least (\d+)/i)?.[1] ?? '6'} characters.`
  if (/unable to validate email|invalid email/i.test(m)) return 'That does not look like an email address.'
  if (/rate limit|too many requests/i.test(m)) return 'Too many attempts just now. Try again in a minute.'
  if (/fetch failed|network|ENOTFOUND|ETIMEDOUT/i.test(m)) return 'Could not reach the sign-in service. Check your connection.'
  return m || 'That did not work.'
}

export class AuthService extends EventEmitter {
  private client: SupabaseClient
  private storage: EncryptedFileStorage
  private state: AuthState = { status: 'unknown', user: null }
  private ready: Promise<void>
  private opts: AuthServiceOptions
  private handoff: Handoff | null = null

  constructor(options: AuthServiceOptions) {
    super()
    this.opts = options
    this.storage = new EncryptedFileStorage(options.sessionFile)
    this.client = createClient(options.url, options.anonKey, {
      auth: {
        storage: this.storage,
        storageKey: 'courseless-session',
        persistSession: true,
        autoRefreshToken: true,
        // There is no browser redirect to read: the app never leaves the main process for auth.
        detectSessionInUrl: false
      }
    })

    this.client.auth.onAuthStateChange((event, session) => {
      log('auth', 'state', event, session?.user?.email ?? 'none')
      this.apply(session)
    })

    // Read the persisted session once at construction so the first window already knows.
    this.ready = this.client.auth
      .getSession()
      .then(({ data }) => {
        this.apply(data.session ?? null)
      })
      .catch((e) => {
        log('auth', 'could not restore the session', String(e).slice(0, 200))
        this.apply(null)
      })
  }

  private apply(session: Session | null): void {
    const user: AuthUser | null = session?.user
      ? { id: session.user.id, email: session.user.email ?? '' }
      : null
    const next: AuthState = { status: user ? 'signed-in' : 'signed-out', user }
    const changed = next.status !== this.state.status || next.user?.id !== this.state.user?.id
    this.state = next
    if (changed) this.emit('state', next)
  }

  /** Resolves once the stored session has been read — boot waits on this, nothing else does. */
  whenReady(): Promise<void> {
    return this.ready
  }

  getState(): AuthState {
    return this.state
  }

  /** Cheap, synchronous, and good enough to decide whether a call is worth making. */
  isSignedIn(): boolean {
    return this.state.status === 'signed-in'
  }

  /** The engine's token source. Supabase refreshes it here if it is close to expiring. */
  async getAccessToken(): Promise<string | null> {
    try {
      const { data, error } = await this.client.auth.getSession()
      if (error) {
        log('auth', 'getSession failed', error.message.slice(0, 160))
        return null
      }
      return data.session?.access_token ?? null
    } catch (e) {
      log('auth', 'getSession threw', String(e).slice(0, 160))
      return null
    }
  }

  // ---------------------------------------------------------------- browser handoff
  //
  // The way in. The app never sees the password: it invents a pair id and a secret, tells the
  // service the HASH of that secret, and sends the person to a normal web page carrying only the
  // id. When they finish there, the app redeems the pairing with the secret it kept — so the one
  // thing that can claim the new session is the process that started the request.

  private async handoffCall(body: Record<string, unknown>): Promise<any | null> {
    const res = await fetch(`${this.opts.url}/functions/v1/auth-handoff`, {
      method: 'POST',
      headers: {
        apikey: this.opts.anonKey,
        Authorization: `Bearer ${this.opts.anonKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    if (!res.ok) return null
    return (await res.json()) as any
  }

  /**
   * Resolves only when the handoff has finished, been cancelled, or run out of time. The renderer
   * shows "finish in your browser" for exactly as long as this promise is pending.
   */
  async startBrowserSignIn(): Promise<AuthResult> {
    this.cancelBrowserSignIn()
    const id = randomUUID()
    const secret = randomBytes(32).toString('hex')
    const secretHash = createHash('sha256').update(secret).digest('hex')
    const handoff: Handoff = { id, cancelled: false }
    this.handoff = handoff

    try {
      const created = await this.handoffCall({ action: 'create', id, secretHash })
      if (!created) throw new Error('the pairing was refused')
    } catch (e) {
      log('auth', 'handoff create failed', String(e).slice(0, 200))
      return { ok: false, error: 'Could not start the sign-in. Check your connection and try again.' }
    }

    // Built here, not returned by anything, but it still goes through the same gate: siteUrl is
    // configuration, and configuration is one bad value away from being an arbitrary scheme.
    const url = externalUrl(`${this.opts.siteUrl}/login?pair=${encodeURIComponent(id)}`, 'browser sign-in')
    log('auth', 'handoff opened', id)
    if (!url) {
      return { ok: false, error: 'The sign-in page address is not valid. Sign in with an email and password instead.' }
    }
    try {
      await shell.openExternal(url)
    } catch (e) {
      log('auth', 'could not open the browser', String(e).slice(0, 160))
      return { ok: false, error: 'Could not open your browser. Sign in with an email and password instead.' }
    }

    const deadline = Date.now() + HANDOFF_TIMEOUT_MS
    while (Date.now() < deadline) {
      await sleep(HANDOFF_POLL_MS)
      if (handoff.cancelled) return { ok: false, error: '', cancelled: true }
      // A pairing that is not finished yet answers "no" — that is the normal case, not an error.
      let body: any = null
      try {
        body = await this.handoffCall({ action: 'redeem', id, secret })
      } catch {
        continue
      }
      const refreshToken = typeof body?.refreshToken === 'string' ? body.refreshToken : ''
      if (!refreshToken) continue

      const { error } = await this.client.auth.refreshSession({ refresh_token: refreshToken })
      if (error) {
        log('auth', 'handoff session exchange failed', error.message.slice(0, 160))
        return { ok: false, error: friendly(error.message) }
      }
      log('auth', 'handoff complete', id)
      return { ok: true }
    }

    return { ok: false, error: 'That took a while, so the sign-in was let go. Start it again when you are ready.' }
  }

  /** The person changed their mind, or closed the step. The pending wait ends quietly. */
  cancelBrowserSignIn(): void {
    if (this.handoff) {
      this.handoff.cancelled = true
      this.handoff = null
    }
  }

  // ---------------------------------------------------------------- password fallback

  async signIn(email: string, password: string): Promise<AuthResult> {
    const { error } = await this.client.auth.signInWithPassword({
      email: email.trim(),
      password
    })
    if (error) return { ok: false, error: friendly(error.message) }
    return { ok: true }
  }

  async signUp(email: string, password: string): Promise<AuthResult> {
    const { data, error } = await this.client.auth.signUp({ email: email.trim(), password })
    if (error) return { ok: false, error: friendly(error.message) }
    // No session back means the project asks for a confirmed address first.
    return { ok: true, needsConfirmation: !data.session }
  }

  /**
   * Sign out, and mean it.
   *
   * Three things have to happen and only the first can fail:
   *  1. REVOKE, server side. `scope: 'global'` invalidates the refresh token for every session
   *     this account has, so a copy of auth.json lifted off the disk beforehand is worthless.
   *     (It is supabase-js's default, and spelled out here because the difference between
   *     'global' and 'local' is the difference between revoked and merely forgotten.)
   *  2. FORGET, on this machine — the file, not just its contents.
   *  3. Tell everyone, so every window drops to the gate.
   *
   * Steps 2 and 3 run even when step 1 throws. A person signing out on a plane must not stay
   * signed in because the revoke could not be delivered; the local session goes either way and
   * the error is reported afterwards.
   */
  async signOut(): Promise<AuthResult> {
    let failure: string | null = null
    try {
      const { error } = await this.client.auth.signOut({ scope: 'global' })
      if (error) failure = friendly(error.message)
    } catch (e) {
      failure = friendly(String(e instanceof Error ? e.message : e))
    }
    // Any in-flight browser pairing is a way back IN that outlives the session. End it too.
    this.cancelBrowserSignIn()
    this.storage.clear()
    this.apply(null)
    log('auth', 'signed out', { revoked: !failure, file: this.opts.sessionFile })
    if (failure) return { ok: false, error: failure }
    return { ok: true }
  }

  async resetPassword(email: string): Promise<AuthResult> {
    const { error } = await this.client.auth.resetPasswordForEmail(email.trim())
    if (error) return { ok: false, error: friendly(error.message) }
    return { ok: true }
  }

  dispose(): void {
    this.cancelBrowserSignIn()
    try {
      void this.client.auth.stopAutoRefresh()
    } catch {
      /* ignore */
    }
  }
}
