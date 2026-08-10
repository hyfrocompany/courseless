import type { EngineStatus, PlanId } from '../../../shared/types'
import { isMacPlatform } from '../lib/system'
import { Icon, IconButton } from './ui'
import { WindowControls } from './WindowControls'

/** The traffic lights sit where the wordmark would; the header has to make room for them. */
const IS_MAC = isMacPlatform()

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-[5px] ${className}`}>
      <span className="text-[15px] font-bold lowercase tracking-[-0.02em] text-ink-900">courseless</span>
      <span className="mb-[2px] h-[5px] w-[5px] rounded-full bg-ocean-500" />
    </span>
  )
}

/**
 * There is no "everything is fine" badge — a working engine is the expected state and does not
 * need a permanent trophy in the title bar. This only appears when the engine cannot answer,
 * because that IS news and it needs a way through to Settings.
 */
export function EngineWarning({ status, onClick }: { status: EngineStatus | null; onClick?(): void }) {
  if (!status || (status.loggedIn && !status.error)) return null
  return (
    <button
      type="button"
      data-testid="status-banner"
      onClick={onClick}
      title="Open Settings to see your account"
      className="app-no-drag inline-flex h-7 items-center gap-2 rounded-full bg-warn-bg px-2.5 text-[12px] font-medium text-warn ring-1 ring-[var(--c-warn-line)] transition-[filter] duration-150 hover:brightness-[0.98]"
    >
      <span className="h-[6px] w-[6px] rounded-full bg-warn" />
      <span className="whitespace-nowrap" data-testid="status-login">
        {status.loggedIn ? 'Engine unreachable' : 'Signed out'}
      </span>
    </button>
  )
}

/** A top-level destination. The underline is the whole point: you can always see where you are. */
function Tab({
  label,
  active,
  testid,
  onClick
}: {
  label: string
  active: boolean
  testid: string
  onClick(): void
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={`app-no-drag relative inline-flex h-[48px] items-center px-2.5 text-[13.5px] font-medium transition-colors duration-150 ${
        active ? 'text-ink-900' : 'text-ink-500 hover:text-ink-900'
      }`}
    >
      {label}
      {active && (
        <span className="pointer-events-none absolute inset-x-1.5 bottom-0 h-[2px] rounded-full bg-ocean-500" />
      )}
    </button>
  )
}

/**
 * The plan, always in sight, in the app's pill idiom and nothing louder.
 *
 * It is one pill, not a banner and not a badge with a count: on Free it offers Pro, on Pro it
 * offers Max, and on Max it says "Max plan" and stops — there is nothing left to sell, so there
 * is nothing to click. It renders only once the plan is actually known, because a pill that says
 * "Upgrade to Pro" for half a second to somebody paying for Max is worse than no pill.
 */
function PlanPill({ plan, onUpgrade }: { plan: PlanId; onUpgrade(): void }) {
  if (plan === 'max') {
    return (
      <span
        data-testid="nav-plan"
        data-plan="max"
        className="app-no-drag inline-flex h-7 items-center rounded-full bg-sunken px-2.5 text-[12px] font-medium text-ink-500"
      >
        Max plan
      </span>
    )
  }
  const next = plan === 'pro' ? 'Max' : 'Pro'
  return (
    <button
      type="button"
      data-testid="nav-upgrade"
      data-plan={plan}
      onClick={onUpgrade}
      title={`Opens checkout for ${next} in your browser`}
      className="app-no-drag inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full bg-chip px-2.5 text-[12px] font-medium text-chip-ink transition-[filter] duration-150 hover:brightness-[0.97]"
    >
      <span className="h-[5px] w-[5px] rounded-full bg-ocean-500" />
      Upgrade to {next}
    </button>
  )
}

export type NavTab = 'home' | 'library' | null

export function Nav({
  status,
  tab,
  plan,
  onHome,
  onLibrary,
  onSettings,
  onStatusClick,
  onUpgrade
}: {
  status: EngineStatus | null
  tab: NavTab
  /** Null until the plan is known — the pill waits rather than guessing. */
  plan: PlanId | null
  onHome(): void
  onLibrary(): void
  onSettings(): void
  onStatusClick(): void
  onUpgrade(): void
}) {
  return (
    <header className="app-drag relative z-40 shrink-0 border-b border-line bg-[var(--c-glass)] backdrop-blur-md">
      {/* pr-[146px] keeps the pill and the gear clear of the window controls at every width.
          On macOS the controls are the OS's own traffic lights in the opposite corner, so the
          padding swaps sides: 78px of clearance on the LEFT and the right edge given back. */}
      <div
        className={`mx-auto flex h-[48px] w-full max-w-[1120px] items-center gap-1 ${
          IS_MAC ? 'pl-[78px] pr-8' : 'pl-8 pr-[146px]'
        }`}
      >
        <button
          type="button"
          onClick={onHome}
          data-testid="nav-wordmark"
          aria-label="Courseless home"
          className="app-no-drag mr-4 rounded-sm transition-opacity duration-150 hover:opacity-70"
        >
          <Wordmark />
        </button>

        <nav className="flex items-stretch" aria-label="Main">
          <Tab label="Home" testid="nav-home" active={tab === 'home'} onClick={onHome} />
          <Tab label="Library" testid="nav-library" active={tab === 'library'} onClick={onLibrary} />
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <EngineWarning status={status} onClick={onStatusClick} />
          {plan && <PlanPill plan={plan} onUpgrade={onUpgrade} />}
          <IconButton
            label="Settings"
            data-testid="nav-settings"
            onClick={onSettings}
            className="app-no-drag"
          >
            {Icon.gear({ size: 17 })}
          </IconButton>
        </div>
      </div>

      <WindowControls />
    </header>
  )
}
