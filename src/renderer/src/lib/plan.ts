// What the month looks like from inside the app.
//
// One place decides when a nudge is warranted, so Home, Review and the runner can never disagree
// about how much is left — and so the rule stays easy to soften.

import type { BillingStatus, UsageCounts } from '../../../shared/types'

/** A meter is "close" from here on. Below it, nothing is said at all. */
const NEAR = 0.75

export interface PlanState {
  /** True only on the free plan. Paid plans are never nudged, anywhere. */
  nudgeable: boolean
  /** Any meter at or past the threshold, or the last lesson of the month. */
  near: boolean
  /** Something is actually used up. */
  spent: boolean
  /** Lessons left this month, or null when the plan has no ceiling. */
  lessonsLeft: number | null
  /** The sentence to show, already in the product's voice. Null when there is nothing to say. */
  note: string | null
  /**
   * Changes whenever the reason to speak up changes, so a dismissed nudge comes back at the next
   * threshold rather than staying gone for the session.
   */
  signature: string
}

const LABEL: Record<keyof UsageCounts, string> = {
  lessons: 'lessons',
  coachTurns: 'coach replies',
  visionCalls: 'looks at the screen'
}

/** The first of next month, the way a person would say it. */
export function resetsOn(): string {
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return next.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
}

export function planState(billing: BillingStatus | null): PlanState {
  const idle: PlanState = {
    nudgeable: false,
    near: false,
    spent: false,
    lessonsLeft: null,
    note: null,
    signature: 'none'
  }
  if (!billing || billing.plan !== 'free' || !billing.limits) return idle

  const limits = billing.limits
  const usage = billing.usage
  const keys = Object.keys(LABEL) as (keyof UsageCounts)[]

  const spentKey = keys.find((k) => limits[k] > 0 && usage[k] >= limits[k]) ?? null
  const nearKey = keys.find((k) => limits[k] > 0 && usage[k] / limits[k] >= NEAR) ?? null
  const lessonsLeft = Math.max(0, limits.lessons - usage.lessons)

  let note: string | null = null
  if (spentKey) note = `No ${LABEL[spentKey]} left until ${resetsOn()}.`
  else if (lessonsLeft === 1) note = 'One lesson left this month.'
  else if (nearKey) note = `Most of this month’s ${LABEL[nearKey]} are used.`

  return {
    nudgeable: true,
    near: !!nearKey || lessonsLeft <= 1,
    spent: !!spentKey,
    lessonsLeft,
    note,
    signature: `${billing.plan}:${keys.map((k) => `${usage[k]}/${limits[k]}`).join(',')}:${note ?? ''}`
  }
}
