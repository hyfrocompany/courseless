import type { BillingPlanChoice } from '../../../shared/types'
import { resetsOn } from '../lib/plan'
import { Button, Eyebrow } from './ui'

/**
 * Two ways of saying the same thing, and neither of them nags.
 *
 * `UpgradeNote` is one line that can be waved away — it appears when the month is getting thin
 * and disappears for good the moment it is dismissed, until the count moves again.
 * `LimitCard` is what a used-up allowance looks like: a calm statement of what ran out and when
 * it comes back, in the ordinary frame, never in the error frame.
 */

export function UpgradeNote({
  note,
  onUpgrade,
  onPlans,
  onDismiss
}: {
  note: string
  onUpgrade(plan: BillingPlanChoice): void
  onPlans(): void
  onDismiss(): void
}) {
  return (
    <div
      data-testid="upgrade-note"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-sm bg-sunken px-3.5 py-2.5"
    >
      <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-ocean-500" />
      <span className="text-[12.5px] text-ink-700">{note}</span>
      <span className="text-[12.5px] text-ink-500">Pro removes the ceiling.</span>
      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" data-testid="note-upgrade" onClick={() => onUpgrade('pro_monthly')}>
          Upgrade
        </Button>
        <button
          type="button"
          data-testid="note-plans"
          onClick={onPlans}
          className="text-[12.5px] text-ink-500 transition-colors duration-150 hover:text-ink-900"
        >
          See plans
        </button>
        <button
          type="button"
          aria-label="Dismiss"
          data-testid="note-dismiss"
          onClick={onDismiss}
          className="text-[12.5px] text-ink-400 transition-colors duration-150 hover:text-ink-700"
        >
          Not now
        </button>
      </div>
    </div>
  )
}

export function LimitCard({
  title,
  message,
  onUpgrade,
  onPlans,
  onDismiss,
  compact = false
}: {
  title: string
  message: string
  onUpgrade(plan: BillingPlanChoice): void
  onPlans(): void
  onDismiss?(): void
  /** The coach panel is 380px wide: the same card, without the room to breathe. */
  compact?: boolean
}) {
  return (
    <div
      data-testid="limit-card"
      className={`rounded-md bg-surface ring-hairline ${compact ? 'p-3.5' : 'p-5'}`}
    >
      <Eyebrow tone="muted">This month</Eyebrow>
      <div className={`mt-1.5 font-display tracking-[-0.02em] text-ink-900 ${compact ? 'text-[16px]' : 'text-[19px]'}`}>
        {title}
      </div>
      <p className="mt-1.5 text-[12.5px] leading-[1.55] text-ink-500">{message}</p>
      <p className="mt-1 text-[12.5px] leading-[1.55] text-ink-500">
        It comes back on {resetsOn()}. Pro lifts the count from today.
      </p>
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <Button size="sm" data-testid="limit-upgrade" onClick={() => onUpgrade('pro_monthly')}>
          Upgrade to Pro
        </Button>
        <Button variant="ghost" size="sm" data-testid="limit-plans" onClick={onPlans}>
          See plans
        </Button>
        {onDismiss && (
          <Button variant="quiet" size="sm" data-testid="limit-dismiss" onClick={onDismiss}>
            Not now
          </Button>
        )}
      </div>
    </div>
  )
}
