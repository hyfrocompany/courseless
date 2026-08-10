'use client'

/**
 * The website is the login surface for the desktop app.
 *
 *   /login            sign in, then your account: email, plan, sign out.
 *   /login?pair=<id>  sign in on behalf of the app. The resulting refresh token goes to the
 *                     auth-handoff function, which parks it for the app to redeem once.
 *
 * The pair id has to survive an OAuth round trip, so it travels in both the redirect URL and
 * sessionStorage, and whichever comes back is used.
 */

import { createClient, type Session } from '@supabase/supabase-js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckIcon } from './icons'

const SUPABASE_URL = 'https://xxeagfxivrjpvofwvvmh.supabase.co'
// anon key: public by design, RLS is what protects the data
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4ZWFnZnhpdnJqcHZvZnd2dm1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzMDE1ODcsImV4cCI6MjEwMTg3NzU4N30.jO8FIVOH5YhsZW6qxmtEXjA9oOj9esYLLnPUc1xt8tM'
const PAIR_KEY = 'courseless:pair'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
})

type View = 'loading' | 'signin' | 'paired' | 'account'

/** Supabase writes its errors for developers. Keep the app's register. */
function human(error: unknown): string {
  const m = String((error as { message?: string } | null)?.message ?? error ?? 'Something went wrong.')
  if (/invalid login credentials/i.test(m)) return 'That email and password do not match an account.'
  if (/already registered|already been registered/i.test(m)) return 'That email already has an account. Sign in instead.'
  if (/password should be at least/i.test(m)) return 'Use a password of at least 8 characters.'
  if (/invalid email|unable to validate email/i.test(m)) return 'That email address does not look right.'
  if (/rate limit|too many/i.test(m)) return 'Too many attempts. Wait a minute, then try again.'
  return m.replace(/\.$/, '') + '.'
}

export function AuthPanel() {
  const [view, setView] = useState<View>('loading')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [pairId, setPairId] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [handoff, setHandoff] = useState<'ok' | 'failed' | 'working'>('working')
  const [account, setAccount] = useState<{ email: string; plan: string; usage: string }>({
    email: '',
    plan: 'free',
    usage: ''
  })
  const settled = useRef(false)

  const redirectTarget = useCallback(
    (id: string | null) => `${location.origin}/login${id ? `?pair=${encodeURIComponent(id)}` : ''}`,
    []
  )

  /** Park the refresh token for the desktop app. Only the function can store it. */
  const completeHandoff = useCallback(async (session: Session, id: string) => {
    setView('paired')
    setHandoff('working')
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/auth-handoff`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ action: 'complete', id, refreshToken: session.refresh_token })
      })
      if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`)
      try {
        sessionStorage.removeItem(PAIR_KEY)
      } catch {
        /* private mode */
      }
      window.history.replaceState(null, '', '/login')
      setHandoff('ok')
    } catch (err) {
      setError(human(err))
      setHandoff('failed')
    }
  }, [])

  const showAccount = useCallback(async (session: Session) => {
    setView('account')
    setAccount({ email: session.user?.email ?? '', plan: 'free', usage: '' })
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/billing`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ action: 'status' })
      })
      if (!res.ok) return
      const data = (await res.json()) as {
        plan?: string
        usage?: { lessons?: number }
        limits?: { lessons?: number } | null
      }
      const used = data.usage?.lessons
      const cap = data.limits?.lessons
      setAccount((a) => ({
        email: a.email,
        plan: data.plan ?? a.plan,
        usage: typeof used === 'number' ? (typeof cap === 'number' ? `${used} of ${cap}` : String(used)) : ''
      }))
    } catch {
      /* not deployed or offline: the account still shows who you are */
    }
  }, [])

  const afterSignIn = useCallback(
    async (session: Session | null, id: string | null) => {
      if (!session) {
        setView('signin')
        return
      }
      if (settled.current) return
      settled.current = true
      if (id) await completeHandoff(session, id)
      else await showAccount(session)
    },
    [completeHandoff, showAccount]
  )

  // boot: recover the pair id, surface any provider error, then take whichever session arrives
  useEffect(() => {
    const url = new URL(window.location.href)
    let id = url.searchParams.get('pair')
    if (id) {
      try {
        sessionStorage.setItem(PAIR_KEY, id)
      } catch {
        /* private mode: the query string still carries it */
      }
    } else {
      try {
        id = sessionStorage.getItem(PAIR_KEY)
      } catch {
        id = null
      }
    }
    setPairId(id)

    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const oauthError =
      hash.get('error_description') || hash.get('error') || url.searchParams.get('error_description')
    if (oauthError) {
      setError(human(decodeURIComponent(oauthError.replace(/\+/g, ' '))))
      setView('signin')
      window.history.replaceState(null, '', `/login${id ? `?pair=${encodeURIComponent(id)}` : ''}`)
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) void afterSignIn(session, id)
    })

    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) void afterSignIn(data.session, id)
      else if (!oauthError) setView('signin')
    })

    return () => sub.subscription.unsubscribe()
  }, [afterSignIn])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setInfo('')
    if (!email.trim() || !password) {
      setError('Enter an email address and a password.')
      return
    }
    setBusy(true)
    try {
      if (mode === 'signup') {
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: redirectTarget(pairId) }
        })
        if (err) throw err
        if (!data.session) {
          setBusy(false)
          setInfo('Check your email to confirm the address, then come back and sign in.')
          return
        }
        await afterSignIn(data.session, pairId)
      } else {
        const { data, error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (err) throw err
        await afterSignIn(data.session, pairId)
      }
    } catch (err) {
      setError(human(err))
    } finally {
      setBusy(false)
    }
  }

  async function onGoogle() {
    setError('')
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectTarget(pairId) }
    })
    if (err) setError(human(err))
  }

  async function onSignOut() {
    await supabase.auth.signOut()
    try {
      sessionStorage.removeItem(PAIR_KEY)
    } catch {
      /* nothing to clear */
    }
    location.href = '/login'
  }

  if (view === 'loading') {
    return (
      <div className="auth">
        <p className="note">
          <span className="spin" /> Checking your session
        </p>
      </div>
    )
  }

  if (view === 'paired') {
    return (
      <div className="auth">
        <div className="auth-card">
          <div className="done-mark" aria-hidden="true">
            <CheckIcon size={20} />
          </div>
          <h1 className="done-title">
            {handoff === 'failed' ? 'Signed in on the web' : 'Signed in. You can return to Courseless.'}
          </h1>
          <p className="note" style={{ marginTop: 10 }}>
            {handoff === 'failed'
              ? 'The app did not pick up this session. Open Courseless and choose Sign in again.'
              : 'The app has what it needs. Close this tab whenever you like.'}
          </p>
          <button
            className="btn ocean block"
            type="button"
            style={{ marginTop: 18 }}
            onClick={() => {
              location.href = 'courseless://signed-in'
            }}
          >
            Open Courseless
          </button>
          {handoff === 'failed' && error ? <div className="msg error">{error}</div> : null}
        </div>
      </div>
    )
  }

  if (view === 'account') {
    return (
      <div className="auth">
        <div className="auth-head">
          <h1>Your account</h1>
        </div>
        <div className="auth-card">
          <div className="rows">
            <div className="row">
              <span className="k">email</span>
              <span className="v">{account.email}</span>
            </div>
            <div className="row">
              <span className="k">plan</span>
              <span className="v plan">{account.plan}</span>
            </div>
            {account.usage ? (
              <div className="row">
                <span className="k">lessons this month</span>
                <span className="v">{account.usage}</span>
              </div>
            ) : null}
          </div>
          <button className="btn block" type="button" style={{ marginTop: 18 }} onClick={onSignOut}>
            Sign out
          </button>
        </div>
        <p className="note" style={{ marginTop: 16 }}>
          Signing in on the desktop app? Open Courseless and choose Sign in. It brings you back here with a pairing
          link.
        </p>
      </div>
    )
  }

  const signup = mode === 'signup'
  return (
    <div className="auth">
      {pairId ? (
        <p className="pairnote">
          <span className="d" />
          Signing in for the Courseless app on this computer.
        </p>
      ) : null}

      <div className="auth-head">
        <h1>{signup ? 'Create your account' : 'Sign in'}</h1>
        <p>Your plan and your lesson allowance live here. Your lessons stay on your machine.</p>
      </div>

      <div className="auth-card">
        <button className="btn block" type="button" onClick={onGoogle}>
          <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.63z"
            />
            <path
              fill="#34A853"
              d="M9 18c2.43 0 4.47-.8 5.96-2.17l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
            />
            <path fill="#FBBC05" d="M3.97 10.73a5.41 5.41 0 0 1 0-3.46V4.94H.96a9 9 0 0 0 0 8.12l3.01-2.33z" />
            <path
              fill="#EA4335"
              d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
            />
          </svg>
          Continue with Google
        </button>

        <p className="auth-sep">or use an email address</p>

        <form onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@work.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete={signup ? 'new-password' : 'current-password'}
              placeholder="At least 8 characters"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="btn ocean block" type="submit" disabled={busy}>
            {busy ? <span className="spin" /> : null}
            {busy ? (signup ? 'Creating' : 'Signing in') : signup ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <p className="auth-alt">
          {signup ? 'Already have an account? ' : 'No account yet? '}
          <button
            type="button"
            onClick={() => {
              setMode(signup ? 'signin' : 'signup')
              setError('')
              setInfo('')
            }}
          >
            {signup ? 'Sign in' : 'Create one'}
          </button>
        </p>

        {error ? <div className="msg error">{error}</div> : null}
        {info ? <div className="msg info">{info}</div> : null}
      </div>
    </div>
  )
}
