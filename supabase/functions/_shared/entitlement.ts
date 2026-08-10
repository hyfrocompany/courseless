// Who the caller is, what they are entitled to, and what they have already spent this month.

export type Plan = 'free' | 'pro' | 'max'
export type SubStatus = 'none' | 'active' | 'trialing' | 'past_due' | 'canceled'

export interface Limits {
  lessons: number
  /** null = unlimited. Lessons are the only metered thing; coaching and pointing are uncapped
   *  on every plan (the per-minute rate limit is the only guard). */
  coachTurns: number | null
  visionCalls: number | null
}

export interface Usage {
  lessons: number
  coachTurns: number
  visionCalls: number
}

export const LIMITS: Record<Plan, Limits> = {
  free: { lessons: 3, coachTurns: null, visionCalls: null },
  pro: { lessons: 150, coachTurns: null, visionCalls: null },
  // "Max" is marketed as unlimited. The lessons number is the internal fair-use ceiling and is
  // never reported to the client as a plan limit — billing/status returns `limits: null` for max.
  max: { lessons: 1000, coachTurns: null, visionCalls: null }
}

/** 20 engine calls per minute per user, on every plan. Guards the shared 100 RPM Bedrock pool. */
export const RATE_LIMIT_PER_MINUTE = 20

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''

/** 'YYYY-MM' in UTC — the metering period. */
export function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

async function admin(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {})
    }
  })
}

export interface AuthedUser {
  id: string
  email: string | null
}

/** Resolve the bearer token to a user. Returns null for anything that is not a real user token. */
export async function getUser(req: Request): Promise<AuthedUser | null> {
  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` }
  })
  if (!res.ok) return null
  const json = await res.json().catch(() => null)
  if (!json?.id) return null
  return { id: json.id, email: json.email ?? null }
}

export interface Subscription {
  status: SubStatus
  priceId: string | null
  currentPeriodEnd: string | null
  /** True when the plan is still live but stops at `currentPeriodEnd` instead of renewing. */
  cancelAtPeriodEnd: boolean
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
}

const EMPTY_SUB: Subscription = {
  status: 'none',
  priceId: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  stripeCustomerId: null,
  stripeSubscriptionId: null
}

export async function getSubscription(userId: string): Promise<Subscription> {
  const res = await admin(
    `/rest/v1/subscriptions?user_id=eq.${userId}&select=status,price_id,current_period_end,cancel_at_period_end,stripe_customer_id,stripe_subscription_id`
  )
  if (!res.ok) return EMPTY_SUB
  const rows = await res.json().catch(() => [])
  const row = Array.isArray(rows) ? rows[0] : null
  if (!row) return EMPTY_SUB
  return {
    status: (row.status ?? 'none') as SubStatus,
    priceId: row.price_id ?? null,
    currentPeriodEnd: row.current_period_end ?? null,
    cancelAtPeriodEnd: row.cancel_at_period_end === true,
    stripeCustomerId: row.stripe_customer_id ?? null,
    stripeSubscriptionId: row.stripe_subscription_id ?? null
  }
}

/**
 * Price id -> plan. The webhook stamps the price id on the row; the tier is derived from the
 * lookup-key convention (`pro_*` / `max_*`) recorded in PRICE_PLAN at deploy time, falling back to
 * a substring match so a price created by hand still resolves.
 */
export function planFromPriceId(priceId: string | null, status: SubStatus): Plan {
  if (status !== 'active' && status !== 'trialing') return 'free'
  const map = parsePriceMap()
  if (priceId && map[priceId]) return map[priceId]
  if (priceId && /max/i.test(priceId)) return 'max'
  // An entitled subscription whose price we cannot place is still a paying customer: give Pro.
  return 'pro'
}

/** STRIPE_PRICE_PLAN_MAP = "price_123:pro,price_456:max" — set by scripts/provision-stripe.sh. */
function parsePriceMap(): Record<string, Plan> {
  const raw = Deno.env.get('STRIPE_PRICE_PLAN_MAP') ?? ''
  const out: Record<string, Plan> = {}
  for (const pair of raw.split(',')) {
    const [id, plan] = pair.split(':').map((s) => s?.trim())
    if (id && (plan === 'pro' || plan === 'max')) out[id] = plan
  }
  return out
}

export async function getUsage(userId: string, period = currentPeriod()): Promise<Usage> {
  const res = await admin(
    `/rest/v1/usage?user_id=eq.${userId}&period=eq.${period}&select=lessons,coach_turns,vision_calls`
  )
  if (!res.ok) return { lessons: 0, coachTurns: 0, visionCalls: 0 }
  const rows = await res.json().catch(() => [])
  const row = Array.isArray(rows) ? rows[0] : null
  return {
    lessons: row?.lessons ?? 0,
    coachTurns: row?.coach_turns ?? 0,
    visionCalls: row?.vision_calls ?? 0
  }
}

export type Counter = 'lessons' | 'coachTurns' | 'visionCalls'

export async function incrementUsage(
  userId: string,
  counter: Counter,
  period = currentPeriod()
): Promise<Usage> {
  const res = await admin('/rest/v1/rpc/increment_usage', {
    method: 'POST',
    body: JSON.stringify({
      p_user: userId,
      p_period: period,
      p_lessons: counter === 'lessons' ? 1 : 0,
      p_coach: counter === 'coachTurns' ? 1 : 0,
      p_vision: counter === 'visionCalls' ? 1 : 0
    })
  })
  if (!res.ok) return getUsage(userId, period)
  const row = await res.json().catch(() => null)
  return {
    lessons: row?.lessons ?? 0,
    coachTurns: row?.coach_turns ?? 0,
    visionCalls: row?.vision_calls ?? 0
  }
}

/** False when the caller has burned their 20 calls in the last minute. */
export async function takeRateLimitSlot(userId: string): Promise<boolean> {
  const res = await admin('/rest/v1/rpc/take_rate_limit_slot', {
    method: 'POST',
    body: JSON.stringify({ p_user: userId, p_limit: RATE_LIMIT_PER_MINUTE, p_window_seconds: 60 })
  })
  if (!res.ok) return true // never let a bookkeeping outage lock everyone out
  return (await res.json().catch(() => true)) !== false
}

export interface Entitlement {
  plan: Plan
  status: SubStatus
  currentPeriodEnd: string | null
  /** A cancel is scheduled: entitled until `currentPeriodEnd`, then not. */
  cancelAtPeriodEnd: boolean
  /**
   * There is a Stripe customer behind this user, whatever they are paying today. A churned
   * customer still needs the portal to reach their invoices and receipts.
   */
  hasBillingAccount: boolean
  usage: Usage
  limits: Limits
}

export async function getEntitlement(userId: string): Promise<Entitlement> {
  const [sub, usage] = await Promise.all([getSubscription(userId), getUsage(userId)])
  const plan = planFromPriceId(sub.priceId, sub.status)
  return {
    plan,
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    hasBillingAccount: !!sub.stripeCustomerId,
    usage,
    limits: LIMITS[plan]
  }
}

/** The 402 message differs by tier: "max" users hit fair use, not a plan limit. */
export function limitMessage(plan: Plan, counter: Counter, limit: number): string {
  const noun =
    counter === 'lessons' ? 'lessons' : counter === 'coachTurns' ? 'coach messages' : 'screen lookups'
  if (plan === 'max') {
    return `You have reached the fair-use limit of ${limit} ${noun} this month. Get in touch and we will lift it.`
  }
  if (plan === 'pro') {
    return `You have used all ${limit} ${noun} on Pro this month. They reset on the 1st.`
  }
  return `You have used all ${limit} ${noun} on the free plan this month. Upgrade to keep going, or wait for the 1st.`
}
