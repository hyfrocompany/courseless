import { useEffect, useRef, useState } from 'react'
import type {
  BillingPlanChoice,
  BillingStatus,
  EngineStatus,
  PlanId,
  PlanInterval,
  Settings as SettingsType
} from '../../../shared/types'
import type { AppInfo, UpdateState } from '../../../shared/ipc'
import { Breadcrumb, BreadcrumbBar } from '../components/Breadcrumb'
import { PermissionsPanel } from '../components/PermissionsPanel'
import { Button, Chip, Eyebrow, Icon, Kbd, Mono } from '../components/ui'
import { copyText, markHotkeyKeys, openInExplorer, prettyHotkey } from '../lib/system'

const PLAN_NAME: Record<string, string> = { free: 'Free', pro: 'Pro', max: 'Max' }

/** The three things the month is counted in, in the words the app uses for them. */
const METERS: { key: keyof BillingStatus['usage']; label: string }[] = [
  { key: 'lessons', label: 'lessons built' },
  { key: 'coachTurns', label: 'coach replies' },
  { key: 'visionCalls', label: 'times it looked at the screen' }
]

/**
 * The three plans, always on screen, in the order you grow through them.
 *
 * Everything a plan is, is here: what it costs at both cadences and what it lifts. Lessons are
 * the only metered thing on any plan, so the ladder has exactly one rung that changes and the two
 * that do not are still spelled out — "unlimited" is a promise, and a promise left implicit reads
 * as an omission. There is no hidden fourth tier and no "contact us".
 */
interface PlanCardSpec {
  id: PlanId
  title: string
  line: string
  includes: string[]
  /** Null on Free: there is nothing to buy. */
  checkout: Record<PlanInterval, BillingPlanChoice> | null
  price: Record<PlanInterval, { amount: string; sub: string }>
}

const PLANS: PlanCardSpec[] = [
  {
    id: 'free',
    title: 'Free',
    line: 'Enough to find out whether learning this way suits you.',
    includes: ['3 lessons a month', 'Unlimited coach replies', 'Unlimited looks at the screen'],
    checkout: null,
    price: { monthly: { amount: 'Free', sub: 'no card' }, annual: { amount: 'Free', sub: 'no card' } }
  },
  {
    id: 'pro',
    title: 'Pro',
    line: 'For picking up something new most weeks.',
    includes: ['150 lessons a month', 'Unlimited coach replies', 'Unlimited looks at the screen'],
    checkout: { monthly: 'pro_monthly', annual: 'pro_annual' },
    price: {
      monthly: { amount: '$20', sub: 'per month' },
      annual: { amount: '$192', sub: 'per year · $16 a month' }
    }
  },
  {
    id: 'max',
    title: 'Max',
    line: 'Fair use, for the months you are in a new tool every day.',
    includes: ['Unlimited lessons', 'Unlimited coach replies', 'Unlimited looks at the screen'],
    checkout: { monthly: 'max_monthly', annual: 'max_annual' },
    price: {
      monthly: { amount: '$50', sub: 'per month' },
      annual: { amount: '$480', sub: 'per year · $40 a month' }
    }
  }
]

/** Which way is up. Everything above your plan is an upgrade; everything below is a billing change. */
const RANK: Record<PlanId, number> = { free: 0, pro: 1, max: 2 }

/** One month, one count. No bar at all on the unlimited plan — there is nothing to fill. */
function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  if (limit === null) {
    return (
      <div className="flex items-baseline justify-between gap-4 border-b border-line-2 py-2 last:border-b-0">
        <span className="text-[12.5px] text-ink-500">{label}</span>
        <Mono className="text-[11px] text-ink-700">{used} · unlimited</Mono>
      </div>
    )
  }
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  return (
    <div className="border-b border-line-2 py-2 last:border-b-0">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-[12.5px] text-ink-500">{label}</span>
        <Mono className="text-[11px] text-ink-700">
          {used} / {limit}
        </Mono>
      </div>
      <div className="mt-1.5 h-[4px] overflow-hidden rounded-full bg-sunken">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ease-out ${
            pct >= 100 ? 'bg-warn' : 'bg-ocean-500'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

/** A labelled on/off switch. Reads as a switch, not a checkbox — these change app behaviour. */
function Toggle({
  on,
  onChange,
  label,
  testid
}: {
  on: boolean
  onChange(next: boolean): void
  label: string
  testid: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-testid={testid}
      onClick={() => onChange(!on)}
      className="group inline-flex items-center gap-3 text-left"
    >
      <span
        className={`relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors duration-200 ease-out ${
          on ? 'bg-fill' : 'bg-ink-300'
        }`}
      >
        <span
          className="absolute h-[16px] w-[16px] rounded-full bg-white shadow-[0_1px_3px_rgb(14_26_34/0.35)] transition-[left] duration-200 ease-out"
          style={{ left: on ? 19 : 3 }}
        />
      </span>
      <span className="text-[13.5px] text-ink-700 transition-colors duration-150 group-hover:text-ink-900">
        {label}
      </span>
    </button>
  )
}

function Row({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[minmax(0,190px)_1fr] gap-x-8 gap-y-2 border-b border-line-2 py-5 last:border-b-0">
      <div>
        <div className="text-[13.5px] font-semibold text-ink-900">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] leading-relaxed text-ink-500">{hint}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/**
 * One plan. The plan you are on is marked and offers nothing — a card that tries to sell you what
 * you already pay for is the salesy thing this section is built to avoid. Above your plan is an
 * upgrade; below it is a change, and changes belong on the billing page where the money is.
 */
function PlanCard({
  spec,
  current,
  interval,
  onCheckout,
  onPortal
}: {
  spec: PlanCardSpec
  current: PlanId
  interval: PlanInterval
  onCheckout(plan: BillingPlanChoice): void
  onPortal(): void
}) {
  const isCurrent = spec.id === current
  const isUpgrade = RANK[spec.id] > RANK[current]
  const price = spec.price[interval]

  return (
    <div
      data-testid={`plan-card-${spec.id}`}
      data-current={isCurrent ? 'true' : undefined}
      className={`flex min-w-0 flex-col rounded-sm p-3.5 ${
        isCurrent ? 'bg-surface ring-1 ring-[var(--c-accent)]' : 'bg-sunken'
      }`}
    >
      {/* Every card is the same five bands in the same order — name, price, one line, three
          counts, one action — so the eye compares prices instead of re-reading layouts. */}
      <div className="flex h-[22px] items-center gap-2">
        <span className="text-[13px] font-semibold text-ink-900">{spec.title}</span>
        {isCurrent && (
          <span data-testid={`plan-current-${spec.id}`} className="ml-auto">
            <Chip tone="ocean" className="px-2 py-px text-[11px]">
              Your plan
            </Chip>
          </span>
        )}
      </div>

      <div className="mt-2 h-[44px]">
        <Mono className="block text-[17px] font-medium leading-[24px] text-ink-900">{price.amount}</Mono>
        <span className="block text-[11.5px] leading-[18px] text-ink-400">{price.sub}</span>
      </div>

      {/* Fixed at two lines: the bullet lists below have to start on the same baseline in all
          three cards, and a sentence that wraps to three would drop one of them by 18px. */}
      <p className="mt-2 h-[36px] text-[12px] leading-[18px] text-ink-500">{spec.line}</p>

      <ul className="mt-2.5 space-y-1">
        {spec.includes.map((item) => (
          <li key={item} className="flex items-start gap-1.5 text-[12px] leading-[1.45] text-ink-700">
            <span className="mt-[3px] shrink-0 text-ocean-600 dark:text-ocean-400">{Icon.check({ size: 12 })}</span>
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>

      {/* mt-auto and full width: three actions on three different baselines read as three
          unrelated boxes. One row, one height, one edge-to-edge shape per card. */}
      <div className="mt-auto pt-4">
        {isCurrent ? (
          <Button
            variant="outline"
            size="sm"
            disabled
            data-testid={`plan-current-cta-${spec.id}`}
            className="w-full"
          >
            Current plan
          </Button>
        ) : isUpgrade && spec.checkout ? (
          <Button
            size="sm"
            data-testid={`checkout-${spec.checkout[interval]}`}
            onClick={() => onCheckout(spec.checkout![interval])}
            className="w-full"
          >
            Upgrade to {spec.title}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            data-testid={`plan-change-${spec.id}`}
            onClick={onPortal}
            className="w-full"
          >
            Change in billing
          </Button>
        )}
      </div>
    </div>
  )
}

export function SettingsScreen({
  status,
  billing,
  billingError,
  openPlans = false,
  settings,
  info,
  checking,
  onRecheck,
  onCheckout,
  onPortal,
  onSignIn,
  onSignOut,
  onPatch,
  onBack
}: {
  status: EngineStatus | null
  billing: BillingStatus | null
  billingError: string
  /** True when a nudge sent you here: the page opens with the Plans section in view. */
  openPlans?: boolean
  settings: SettingsType | null
  info: AppInfo | null
  checking: boolean
  onRecheck(): void
  onCheckout(plan: BillingPlanChoice): void
  onPortal(): void
  onSignIn(): void
  onSignOut(): void
  onPatch(patch: Partial<SettingsType>): void
  onBack(): void
}) {
  const [hotkey, setHotkey] = useState(settings?.hotkey ?? '')
  const [displayName, setDisplayName] = useState(settings?.displayName ?? '')
  const [copied, setCopied] = useState('')
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle', version: null })
  const plansRef = useRef<HTMLElement>(null)

  const plan: PlanId = billing?.plan ?? status?.plan ?? 'free'
  const interval: PlanInterval = settings?.planInterval === 'annual' ? 'annual' : 'monthly'
  const signedIn = !!status?.loggedIn
  const isMac = info?.platform === 'darwin'
  const periodEnd =
    billing?.currentPeriodEnd && billing.status !== 'none'
      ? new Date(billing.currentPeriodEnd).toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        })
      : null
  /**
   * A cancelled plan is still a live plan until the date. Stripe leaves the status at 'active' for
   * the whole of that last period, so a page that only looked at the status told someone who
   * cancelled on the 3rd that their plan "renews" on the day it in fact ends. The date is the same
   * either way; the verb is not.
   */
  const ending = !!billing?.cancelAtPeriodEnd || billing?.status === 'canceled'
  /**
   * Invoices outlive the subscription. Anyone who has ever paid has a Stripe customer record, and
   * the portal is the only way to reach their receipts — so the button follows the customer, not
   * the plan. `plan !== 'free'` is the fallback for a backend that predates the field.
   */
  const canManageBilling = billing?.hasBillingAccount === true || plan !== 'free'

  // Updates arrive on their own and install themselves on quit. About is the only place that says
  // so, and only once there is something staged.
  useEffect(() => {
    void window.courseless.update.getState().then(setUpdate)
    return window.courseless.update.onState(setUpdate)
  }, [])

  // A nudge that says "see plans" has to LAND on them. The section is always there, so this only
  // has to scroll — no state, nothing to unfold, nothing that can be open or shut.
  useEffect(() => {
    if (!openPlans) return
    plansRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [openPlans])

  async function copy(value: string, key: string): Promise<void> {
    if (await copyText(value)) {
      setCopied(key)
      setTimeout(() => setCopied(''), 1600)
    }
  }

  return (
    <>
      <BreadcrumbBar>
        <Breadcrumb root="Home" current="Settings" onRoot={onBack} />
      </BreadcrumbBar>

      <div data-testid="view-settings" className="mx-auto w-full max-w-[760px] px-8 pb-16 pt-7">
      <Eyebrow>Settings</Eyebrow>
      <h1 className="mt-1.5 font-display text-[28px] leading-tight tracking-[-0.03em]">Yours, on this machine.</h1>
      <p className="mt-2 max-w-[62ch] text-[13.5px] text-ink-500">
        Lessons are plain JSON files in a folder you own. The account exists so your coach knows
        who is asking.
      </p>

      <div className="mt-7">
        <Row
          label="Account"
          hint="Your asks go to the engine that builds and coaches lessons. Everything it makes is saved here."
        >
          <div className="rounded-md bg-surface p-4 ring-hairline" data-testid="account-card">
            <div className="flex flex-wrap items-center gap-2.5">
              <span
                className={`h-[8px] w-[8px] rounded-full ${
                  checking ? 'bg-ink-300 pulse-dot' : signedIn ? 'bg-success' : 'bg-warn'
                }`}
              />
              <span className="text-[13.5px] font-medium text-ink-900" data-testid="account-email">
                {checking ? 'Checking' : signedIn ? status?.email || 'Signed in' : 'Signed out'}
              </span>
              {signedIn && (
                <span data-testid="plan-badge">
                  <Chip tone={plan === 'free' ? 'quiet' : 'ocean'}>{PLAN_NAME[plan] ?? plan}</Chip>
                </span>
              )}
              <Button variant="ghost" size="sm" data-testid="recheck-btn" onClick={onRecheck} className="ml-auto">
                {Icon.refresh({ size: 14 })} Re-check
              </Button>
            </div>

            {signedIn ? (
              <>
                <div className="mt-3">
                  {billing ? (
                    <div data-testid="usage-meters">
                      <div className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-400">
                        this month
                      </div>
                      {METERS.map((m) => (
                        <Meter
                          key={m.key}
                          label={m.label}
                          used={billing.usage?.[m.key] ?? 0}
                          limit={billing.limits ? billing.limits[m.key] : null}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-[12.5px] text-ink-500">
                      {billingError || 'Reading your plan…'}
                    </p>
                  )}
                </div>

                {periodEnd && (
                  <p className="mt-2.5 text-[12px] text-ink-500" data-testid="period-end">
                    {ending ? `Your plan runs until ${periodEnd}.` : `Renews ${periodEnd}.`}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {canManageBilling && (
                    <Button variant="outline" size="sm" data-testid="portal-btn" onClick={onPortal}>
                      Manage billing
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" data-testid="signout-btn" onClick={onSignOut}>
                    Sign out
                  </Button>
                </div>

                {canManageBilling && (
                  <p className="mt-2.5 max-w-[54ch] text-[12px] leading-[1.5] text-ink-500">
                    {plan === 'free'
                      ? 'Your past invoices and receipts are on the billing page, which opens in your browser.'
                      : 'Changing plan, cancelling, payment methods and invoices all live on the billing page, which opens in your browser.'}
                  </p>
                )}
                {billing && billingError && (
                  <p className="mt-2.5 text-[12.5px] text-warn" data-testid="billing-error">
                    {billingError}
                  </p>
                )}
              </>
            ) : (
              <div className="mt-3">
                <p className="max-w-[52ch] text-[13px] leading-relaxed text-ink-500">
                  Lessons you already have still run. Building a new one, coaching and pointing
                  need an account.
                </p>
                <Button size="sm" data-testid="signin-btn" onClick={onSignIn} className="mt-3">
                  Sign in
                </Button>
              </div>
            )}

            {status?.error && <p className="mt-3 text-[13px] text-warn">{status.error}</p>}
          </div>
        </Row>

        {/* ---------------------------------------------------------------- plans
            Always here, never behind a button. Three cards, the one you are on marked, and the
            cadence switch that decides which price the buttons buy. It spans both columns of the
            settings grid on purpose: this is the one row that is a comparison, not a control. */}
        <section
          ref={plansRef}
          data-testid="plans-section"
          className="border-b border-line-2 py-5"
          aria-label="Plans"
        >
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-ink-900">Plans</div>
              <div className="mt-0.5 max-w-[52ch] text-[12px] leading-relaxed text-ink-500">
                Lessons are the only thing counted. Coaching and pointing are unlimited on every
                plan. You are on{' '}
                <span className="text-ink-700">{PLAN_NAME[plan] ?? plan}</span>.
              </div>
            </div>

            <div
              role="radiogroup"
              aria-label="Billing cadence"
              className="inline-flex shrink-0 rounded-full bg-sunken p-[3px]"
            >
              {(['monthly', 'annual'] as const).map((i) => (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={interval === i}
                  data-testid={`interval-${i}`}
                  onClick={() => onPatch({ planInterval: i })}
                  className={`inline-flex items-center rounded-full px-3.5 py-[6px] text-[12.5px] font-medium capitalize transition-colors duration-150 ${
                    interval === i ? 'bg-surface text-ink-900 ring-hairline' : 'text-ink-500 hover:text-ink-900'
                  }`}
                >
                  {i}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {PLANS.map((spec) => (
              <PlanCard
                key={spec.id}
                spec={spec}
                current={plan}
                interval={interval}
                onCheckout={onCheckout}
                onPortal={onPortal}
              />
            ))}
          </div>

          <p className="mt-3 max-w-[70ch] text-[12px] leading-[1.5] text-ink-500">
            Checkout opens in your browser. The plan applies here the moment it is paid, and
            cancelling never takes a lesson away — everything already built stays on this machine.
          </p>
        </section>

        <Row
          label="Start lessons pinned"
          hint="The coach floats over your work and the window steps aside. The full window is one tap away."
        >
          <div className="flex flex-col gap-3.5">
            <Toggle
              testid="toggle-start-pinned"
              label="Pin lessons to the screen"
              on={settings?.startPinned !== false}
              onChange={(v) => onPatch({ startPinned: v })}
            />
            <p className="max-w-[58ch] text-[12.5px] leading-[1.5] text-ink-500">
              With this off, lessons open in the window and the lesson page offers pinning second
              instead of first. Either way, <Kbd className="h-[19px] px-1.5 text-[10.5px]">Esc</Kbd>{' '}
              in the widget brings the window back, and the runner can pin mid-lesson.
            </p>
          </div>
        </Row>

        <Row
          label="Pointing"
          hint="A ghost cursor flies to the thing the step is about. It points — it never clicks for you."
        >
          <div className="flex flex-col gap-3.5">
            <Toggle
              testid="toggle-point"
              label="Point as I go"
              on={!!settings?.pointAsYouGo}
              onChange={(v) => onPatch({ pointAsYouGo: v })}
            />
            <p className="max-w-[58ch] text-[12.5px] leading-[1.5] text-ink-500">
              With this off, pointing happens only when you ask — the <Kbd className="h-[19px] px-1.5 text-[10.5px]">P</Kbd>{' '}
              key or the Show me button.{' '}
              {isMac
                ? 'Courseless first reads the element through macOS accessibility; only if that finds nothing does it look at the screen.'
                : 'Courseless first reads the element straight from Windows; only if that finds nothing does it look at the screen.'}
            </p>
            <div className="rounded-sm bg-sunken p-3 text-[12.5px] leading-[1.5] text-ink-500">
              <span className="font-medium text-ink-700">What gets captured.</span> Your screen is
              captured only when you ask it to point and only if reading the element failed. That
              one image is sent to the engine to be read, deleted from this machine as soon as the
              answer arrives, and never stored on either end.
            </div>
          </div>
        </Row>

        {isMac && (
          <Row
            label="Permissions"
            hint="macOS asks before any app can read the screen. Pointing is the only thing that needs it."
          >
            <PermissionsPanel live />
          </Row>
        )}

        <Row label="Voice" hint="Off by default. Courseless is quiet unless you ask it not to be.">
          <div className="flex flex-col gap-3.5">
            <Toggle
              testid="toggle-voice"
              label="Speak steps aloud"
              on={!!settings?.speakSteps}
              onChange={(v) => onPatch({ speakSteps: v })}
            />
            <Toggle
              testid="toggle-stall"
              label="Nudge me if I go quiet"
              on={settings?.stallCoach !== false}
              onChange={(v) => onPatch({ stallCoach: v })}
            />
            <p className="max-w-[58ch] text-[12.5px] leading-[1.5] text-ink-500">
              The nudge is one line in the float widget when a step has been open about three times
              longer than it should take. Once per step, never twice.
            </p>
          </div>
        </Row>

        <Row
          label="Your name on shared lessons"
          hint="Written into the file when you share one, so the person opening it knows who it came from."
        >
          <input
            data-testid="settings-display-name"
            value={displayName}
            placeholder="Dana"
            spellCheck={false}
            maxLength={60}
            onChange={(e) => setDisplayName(e.target.value)}
            onBlur={() => onPatch({ displayName: displayName.trim() })}
            className="h-10 w-full max-w-[320px] rounded-sm bg-surface px-3 text-[13.5px] ring-hairline focus:outline-none focus:shadow-[inset_0_0_0_1px_var(--c-focus)]"
          />
          <p className="mt-2 max-w-[58ch] text-[12.5px] leading-[1.5] text-ink-500">
            Leave it empty and shared lessons say{' '}
            <span className="text-ink-700">“from a Courseless user”</span>. It is a label written
            into the file you hand over, nothing more — your account address stays out of it.
          </p>
        </Row>

        <Row label="Summon hotkey" hint="Shows the window, or toggles the float widget while a lesson is running.">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              {prettyHotkey(settings?.hotkey ?? '', isMac).map((k) => (
                <Kbd key={k} className="h-7 px-2 text-[12px]">
                  {k}
                </Kbd>
              ))}
            </div>
            <input
              data-testid="settings-hotkey"
              value={hotkey}
              spellCheck={false}
              onChange={(e) => setHotkey(e.target.value)}
              onBlur={() => hotkey.trim() && onPatch({ hotkey: hotkey.trim() })}
              className="h-10 w-full max-w-[280px] rounded-sm bg-surface px-3 font-mono text-[12px] text-ink-500 ring-hairline focus:outline-none focus:shadow-[inset_0_0_0_1px_var(--c-focus)]"
            />
          </div>
          <p className="mt-2.5 max-w-[58ch] text-[12.5px] leading-[1.5] text-ink-500">
            While you are recording a walkthrough,{' '}
            {markHotkeyKeys(isMac).map((k) => (
              <span key={k}>
                <Kbd className="h-[19px] min-w-[19px] px-1.5 text-[10.5px]">{k}</Kbd>{' '}
              </span>
            ))}
            marks a moment. That one is fixed, and it exists only while the recording pill is on
            screen.
          </p>
        </Row>

        <Row label="Appearance" hint="Applies to the main window and the float widget.">
          <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-full bg-sunken p-[3px]">
            {(['light', 'dark'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={settings?.theme === t}
                data-testid={`theme-${t}`}
                onClick={() => onPatch({ theme: t })}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-[7px] text-[13px] font-medium capitalize transition-colors duration-150 ${
                  settings?.theme === t ? 'bg-surface text-ink-900 ring-hairline' : 'text-ink-500 hover:text-ink-900'
                }`}
              >
                {t === 'light' ? Icon.sun({ size: 15 }) : Icon.moon({ size: 15 })}
                {t}
              </button>
            ))}
          </div>
        </Row>

        <Row label="Data folder" hint="Lessons, settings and the log. Delete the folder and this machine forgets everything.">
          <div className="rounded-sm bg-sunken p-3">
            <Mono className="block break-all text-[11.5px] text-ink-700">{info?.lessonsPath ?? '…'}</Mono>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => info && openInExplorer(info.userDataPath)}
            >
              {Icon.folder({ size: 14 })} Open folder
            </Button>
            <Button variant="ghost" size="sm" onClick={() => info && copy(info.userDataPath, 'data')}>
              {copied === 'data' ? 'Copied' : 'Copy path'}
            </Button>
          </div>
          <Mono className="mt-3 block break-all text-[11px] text-ink-400">{info?.logPath ?? ''}</Mono>
        </Row>

        <Row label="About" hint="Stop taking courses. Start doing things.">
          <Mono className="text-[11.5px] text-ink-500">
            Courseless {info?.version ?? ''} {info?.isDev ? '· dev' : ''}
          </Mono>
          {update.status === 'ready' && (
            <Mono data-testid="update-ready" className="mt-1.5 block text-[11.5px] text-ocean-600">
              Update ready{update.version ? ` (${update.version})` : ''} — restarts to apply
            </Mono>
          )}
          <p className="mt-2.5 max-w-[54ch] font-display text-[16px] italic leading-[1.45] text-ink-700">
            When an agent does it for you, the skill stays the machine&apos;s. Keep it yours.
          </p>
        </Row>
      </div>
      </div>
    </>
  )
}
