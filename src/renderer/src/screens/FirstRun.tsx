import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { AuthResult } from '../../../shared/types'
import { Wordmark } from '../components/Nav'
import { PermissionsPanel } from '../components/PermissionsPanel'
import { TitleBarStrip } from '../components/WindowControls'
import { Button, Eyebrow, Icon } from '../components/ui'

type Step = 'welcome' | 'signin' | 'permissions' | 'done'
type FormMode = 'signin' | 'signup' | 'reset'

const FORM_COPY: Record<FormMode, { submit: string; hint: string }> = {
  signin: { submit: 'Sign in', hint: 'Use the address and password you set up.' },
  signup: { submit: 'Create account', hint: 'Six characters or more.' },
  reset: { submit: 'Send the link', hint: 'The reset link goes to this address.' }
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="view-firstrun"
      className="flex min-h-screen items-center justify-center px-8 py-14"
      style={{
        backgroundImage:
          'radial-gradient(70% 55% at 50% -10%, color-mix(in oklab, var(--c-accent) 12%, transparent), transparent 70%)'
      }}
    >
      {/* no Nav here, so the gate carries its own drag strip + window controls */}
      <TitleBarStrip />
      <div className="rise w-full max-w-[480px] rounded-lg bg-surface p-8 ring-hairline shadow-lift">
        <Wordmark />
        {children}
        <Eyebrow tone="muted" className="mt-7">
          your pace · your screen · your coach
        </Eyebrow>
      </div>
    </div>
  )
}

function Field({
  label,
  type,
  value,
  onChange,
  testid,
  autoComplete
}: {
  label: string
  type: 'email' | 'password'
  value: string
  onChange(next: string): void
  testid: string
  autoComplete?: string
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-medium text-ink-700">{label}</span>
      <input
        data-testid={testid}
        type={type}
        value={value}
        autoComplete={autoComplete}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-sm bg-paper px-3 text-[13.5px] text-ink-900 ring-hairline focus:outline-none focus:shadow-[inset_0_0_0_1px_var(--c-focus)]"
      />
    </label>
  )
}

/**
 * The gate, and the first thing anyone sees.
 *
 * It is the whole window while nobody is signed in, so it carries its own drag strip. Signing in
 * happens in a browser — the app pairs with a tab and waits — and the password form is kept as
 * the quiet way round when that is not possible.
 *
 * There is NO way out of here except a session. Every lesson is built by the engine behind the
 * account and every coach reply comes from it, so the shell without one would be a library of
 * things that cannot be run — worse than a closed door, because it looks open. The steps after
 * sign-in (the macOS permissions offer, and `done`) are reachable only once `signedIn` is true.
 */
export function FirstRun({
  configured,
  onboarded,
  signedIn,
  isMac,
  onBrowserSignIn,
  onCancelBrowserSignIn,
  onSignIn,
  onSignUp,
  onResetPassword,
  onFinish
}: {
  /** False when the build has no coach service behind it — say so instead of failing on submit. */
  configured: boolean
  /** A returning person who signed out goes straight to the sign-in step. */
  onboarded: boolean
  signedIn: boolean
  isMac: boolean
  onBrowserSignIn(): Promise<AuthResult>
  onCancelBrowserSignIn(): void
  onSignIn(email: string, password: string): Promise<AuthResult>
  onSignUp(email: string, password: string): Promise<AuthResult>
  onResetPassword(email: string): Promise<AuthResult>
  /** Onboarding is over: remember it and hand the window back. Only ever called signed in. */
  onFinish(): void
}) {
  const [step, setStep] = useState<Step>(onboarded ? 'signin' : 'welcome')

  // browser handoff
  const [waiting, setWaiting] = useState(false)
  const [handoffError, setHandoffError] = useState('')

  // password fallback
  const [formOpen, setFormOpen] = useState(false)
  const [mode, setMode] = useState<FormMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  // The moment the session lands, the sign-in step is done. On macOS there is one more thing
  // worth saying before the app opens; everywhere else this is the end of onboarding.
  useEffect(() => {
    if (!signedIn || step !== 'signin') return
    setWaiting(false)
    if (!onboarded && isMac) {
      setStep('permissions')
      return
    }
    // `done` is a terminal state, not a screen: it stops this effect from firing twice while the
    // window above us swaps the gate out.
    setStep('done')
    onFinish()
  }, [signedIn, step, onboarded, isMac, onFinish])

  async function startBrowser(): Promise<void> {
    setHandoffError('')
    setWaiting(true)
    const res = await onBrowserSignIn()
    setWaiting(false)
    if (!res.ok && !res.cancelled && res.error) setHandoffError(res.error)
  }

  function cancelBrowser(): void {
    onCancelBrowserSignIn()
    setWaiting(false)
  }

  function switchMode(next: FormMode): void {
    setMode(next)
    setError('')
    setNote('')
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (busy) return
    setError('')
    setNote('')
    if (!email.trim()) {
      setError('An email address, first.')
      return
    }
    if (mode !== 'reset' && !password) {
      setError('A password, too.')
      return
    }
    setBusy(true)
    const res =
      mode === 'signin'
        ? await onSignIn(email, password)
        : mode === 'signup'
          ? await onSignUp(email, password)
          : await onResetPassword(email)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setPassword('')
    if (mode === 'reset') setNote('The link is on its way. Check that inbox.')
    else if (res.needsConfirmation) setNote('Confirm the address from the email we sent, then sign in.')
    // A successful sign-in needs no note: the step moves on by itself.
  }

  if (step === 'done') return <div className="min-h-screen bg-paper" />

  // ---------------------------------------------------------------- welcome

  if (step === 'welcome') {
    return (
      <Shell>
        <h1 className="mt-6 font-display text-[32px] leading-[1.08] tracking-[-0.03em] text-ink-900">
          Courses are over.
        </h1>
        <p className="mt-3 text-[13.5px] leading-relaxed text-ink-500">
          Name something you want to be able to do and Courseless builds the path through the real
          app: six to twelve steps, each one with a checkpoint you can see on screen. You do the
          task. The coach stays beside you and fades as you go.
        </p>
        <ul className="mt-5 space-y-2.5">
          {[
            'Lessons are built on demand, for the tool you actually use.',
            'A pointer shows you the button, and says so honestly when it cannot find it.',
            'Everything you make is a plain file in a folder you own.'
          ].map((line) => (
            <li key={line} className="flex gap-2.5 text-[13px] leading-relaxed text-ink-700">
              <span className="mt-[6px] h-[6px] w-[6px] shrink-0 rounded-full bg-ocean-500" />
              {line}
            </li>
          ))}
        </ul>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Button data-testid="welcome-continue" autoFocus onClick={() => setStep('signin')}>
            Get started {Icon.arrowRight({ size: 15 })}
          </Button>
        </div>
      </Shell>
    )
  }

  // ---------------------------------------------------------------- permissions (darwin only)

  if (step === 'permissions') {
    return (
      <Shell>
        <h1 className="mt-6 font-display text-[28px] leading-[1.1] tracking-[-0.03em] text-ink-900">
          Two permissions, when you want pointing.
        </h1>
        <p className="mt-3 text-[13.5px] leading-relaxed text-ink-500">
          Courseless can fly a ghost cursor to the thing a step is about. On macOS that needs
          permission to read the screen — and it is entirely optional.
        </p>
        {/* live: this step exists to be acted on, so it polls and offers the buttons */}
        <PermissionsPanel live className="mt-5" />
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Button data-testid="permissions-continue" autoFocus onClick={onFinish}>
            Open the library {Icon.arrowRight({ size: 15 })}
          </Button>
        </div>
      </Shell>
    )
  }

  // ---------------------------------------------------------------- sign in

  return (
    <Shell>
      <h1 className="mt-6 font-display text-[28px] leading-[1.1] tracking-[-0.03em] text-ink-900">
        {onboarded ? 'Welcome back.' : 'One account, then you are doing things.'}
      </h1>
      <p className="mt-3 text-[13.5px] leading-relaxed text-ink-500">
        Lessons are built for you, and the coach answers as you go — both run through your account,
        so this is the one step there is. Signing in happens in your browser, where a password
        manager can help. Come back here when it is done; Courseless is waiting.
      </p>

      <div className="mt-6">
        {waiting ? (
          <div className="rounded-md bg-paper p-4 ring-hairline" data-testid="auth-waiting">
            <div className="flex items-center gap-3">
              <span className="pulse-dot h-[9px] w-[9px] rounded-full bg-ocean-500" />
              <span className="text-[13.5px] text-ink-700">Finish signing in in your browser.</span>
            </div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-500">
              This window signs itself in the moment you are done. If the tab did not open, start
              it again.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" data-testid="auth-browser-retry" onClick={() => void startBrowser()}>
                {Icon.refresh({ size: 14 })} Open it again
              </Button>
              <Button variant="quiet" size="sm" data-testid="auth-browser-cancel" onClick={cancelBrowser}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Button
              data-testid="auth-browser"
              autoFocus
              disabled={!configured}
              onClick={() => void startBrowser()}
              className="w-full"
            >
              Sign in with your browser {Icon.arrowRight({ size: 15 })}
            </Button>
            {handoffError && (
              <p className="mt-2.5 text-[12.5px] leading-relaxed text-warn" data-testid="auth-handoff-error">
                {handoffError}
              </p>
            )}
          </>
        )}
      </div>

      {!configured && (
        <p className="mt-3 text-[12.5px] leading-relaxed text-warn" data-testid="auth-unconfigured">
          This build has no coach service configured, so signing in will not work yet.
        </p>
      )}

      {/* The quiet way round, for a machine with no browser to hand. */}
      {!formOpen ? (
        <button
          type="button"
          data-testid="auth-show-form"
          onClick={() => setFormOpen(true)}
          className="mt-4 text-[12.5px] text-ink-500 underline underline-offset-4 decoration-line transition-colors duration-150 hover:text-ink-900"
        >
          Sign in here instead
        </button>
      ) : (
        <div className="mt-5 border-t border-line-2 pt-5">
          <div className="flex items-baseline justify-between gap-3">
            <Eyebrow tone="muted">{mode === 'signup' ? 'New account' : mode === 'reset' ? 'Reset' : 'Email and password'}</Eyebrow>
            <span className="text-[12px] text-ink-400">{FORM_COPY[mode].hint}</span>
          </div>

          <form className="mt-3 space-y-3" onSubmit={(e) => void submit(e)}>
            <Field
              label="Email"
              type="email"
              testid="auth-email"
              autoComplete="username"
              value={email}
              onChange={setEmail}
            />
            {mode !== 'reset' && (
              <Field
                label="Password"
                type="password"
                testid="auth-password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={setPassword}
              />
            )}

            {error && (
              <p className="text-[12.5px] leading-relaxed text-warn" data-testid="auth-error">
                {error}
              </p>
            )}
            {note && (
              <p className="text-[12.5px] leading-relaxed text-ink-700" data-testid="auth-note">
                {note}
              </p>
            )}

            <Button type="submit" variant="outline" data-testid="auth-submit" disabled={busy} className="w-full">
              {busy ? 'One moment' : FORM_COPY[mode].submit}
            </Button>
          </form>

          <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-ink-500">
            {mode === 'signin' ? (
              <>
                <button
                  type="button"
                  data-testid="auth-go-signup"
                  onClick={() => switchMode('signup')}
                  className="transition-colors duration-150 hover:text-ink-900"
                >
                  Create an account
                </button>
                <button
                  type="button"
                  data-testid="auth-go-reset"
                  onClick={() => switchMode('reset')}
                  className="transition-colors duration-150 hover:text-ink-900"
                >
                  Forgot your password
                </button>
              </>
            ) : (
              <button
                type="button"
                data-testid="auth-go-signin"
                onClick={() => switchMode('signin')}
                className="transition-colors duration-150 hover:text-ink-900"
              >
                Back to sign in
              </button>
            )}
          </div>
        </div>
      )}
    </Shell>
  )
}
