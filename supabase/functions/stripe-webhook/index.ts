// POST /functions/v1/stripe-webhook — deployed with verify_jwt=false; the Stripe signature is the
// only authentication, so every path below runs only after it verifies.

import { verifyWebhookSignature } from '../_shared/stripe.ts'

const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''

const HANDLED = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted'
])

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })

  const raw = await req.text()
  const ok = await verifyWebhookSignature(raw, req.headers.get('Stripe-Signature'), WEBHOOK_SECRET)
  if (!ok) return new Response('Bad signature', { status: 400 })

  let event: { type?: string; created?: unknown; data?: { object?: Record<string, unknown> } }
  try {
    event = JSON.parse(raw)
  } catch {
    return new Response('Bad payload', { status: 400 })
  }

  const type = event.type ?? ''
  if (!HANDLED.has(type)) return new Response('ignored', { status: 200 })

  // Stripe delivers at least once and in no guaranteed order: a retried `updated` from ten minutes
  // ago can land after the `updated` that cancelled the plan. The event's own `created` time is
  // what orders them, and it travels with every write below.
  const eventAt = numberOrNull(event.created)
    ? new Date(numberOrNull(event.created)! * 1000).toISOString()
    : new Date().toISOString()

  try {
    const object = event.data?.object ?? {}
    if (type === 'checkout.session.completed') await onCheckoutCompleted(object, eventAt)
    else await onSubscription(object, type === 'customer.subscription.deleted', eventAt)
  } catch (e) {
    // 500 makes Stripe retry, which is what we want for a transient database problem.
    // The message, never the error object: a thrown fetch/Stripe error can carry the request that
    // produced it, and those requests are signed with the service-role and Stripe secret keys.
    console.error('webhook handling failed', type, e instanceof Error ? e.message : String(e))
    return new Response('handler error', { status: 500 })
  }
  return new Response('ok', { status: 200 })
})

async function onCheckoutCompleted(
  session: Record<string, unknown>,
  eventAt: string
): Promise<void> {
  const userId = await resolveUserId(session)
  const subscriptionId = asId(session.subscription)
  const customerId = asId(session.customer)
  if (!userId) return

  // The session itself carries no price or period; fetching the subscription gives the real state
  // and means checkout.session.completed and customer.subscription.* converge on one row shape.
  if (subscriptionId) {
    // Encoded even though the id arrives inside a signature-verified payload: this is the one
    // place a value from the body becomes part of a URL, and it costs nothing to keep it a path
    // segment rather than a path.
    const sub = await stripeGet(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}`)
    if (sub) return onSubscription(sub, false, eventAt, userId)
  }
  // Nulls below are "this event does not say" — the writer keeps whatever a subscription event
  // already recorded rather than blanking the price and period.
  await apply({
    p_user: userId,
    p_event_at: eventAt,
    p_customer: customerId,
    p_subscription: subscriptionId,
    p_status: 'active'
  })
}

async function onSubscription(
  sub: Record<string, unknown>,
  deleted: boolean,
  eventAt: string,
  knownUserId?: string
): Promise<void> {
  const userId = knownUserId ?? (await resolveUserId(sub))
  if (!userId) return

  const item = (sub.items as { data?: Record<string, unknown>[] } | undefined)?.data?.[0]
  const priceId = asId((item as { price?: unknown } | undefined)?.price)
  const periodEnd =
    numberOrNull(sub.current_period_end) ??
    numberOrNull((item as { current_period_end?: unknown } | undefined)?.current_period_end)

  // Stripe leaves `status` at 'active' for a subscription the customer has already cancelled — the
  // plan simply stops at the period end. Without this flag the app cannot tell the two apart and
  // promises a renewal that is not coming. `deleted` means it has already stopped, so nothing is
  // scheduled any more.
  const cancelAtPeriodEnd = deleted ? false : boolOrNull(sub.cancel_at_period_end)

  await apply({
    p_user: userId,
    p_event_at: eventAt,
    p_customer: asId(sub.customer),
    p_subscription: asId(sub.id),
    p_price: priceId,
    p_status: deleted ? 'canceled' : String(sub.status ?? 'none'),
    p_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    p_cancel_at_period_end: cancelAtPeriodEnd
  })
}

// ---------------------------------------------------------------- helpers

function asId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
    return (value as { id: string }).id
  }
  return null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** null means "the event did not say", which the writer reads as "leave it alone". */
function boolOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

/**
 * Three ways to find the user, in descending order of trust: the metadata we stamped at checkout,
 * the session's client_reference_id, and finally the customer id already recorded on a row.
 */
async function resolveUserId(object: Record<string, unknown>): Promise<string | null> {
  const meta = (object.metadata ?? {}) as Record<string, unknown>
  const fromMeta = typeof meta.supabase_user_id === 'string' ? meta.supabase_user_id : null
  if (fromMeta) return fromMeta
  if (typeof object.client_reference_id === 'string') return object.client_reference_id

  const customerId = asId(object.customer)
  if (!customerId) return null
  const res = await rest(
    // Encoded: an `&` or `,` in the id would otherwise become PostgREST query syntax rather than
    // part of the value being matched.
    `/rest/v1/subscriptions?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=user_id&limit=1`
  )
  const rows = await res.json().catch(() => [])
  return Array.isArray(rows) && rows[0]?.user_id ? rows[0].user_id : null
}

async function stripeGet(path: string): Promise<Record<string, unknown> | null> {
  const key = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
  if (!key) return null
  const res = await fetch(`https://api.stripe.com${path}`, {
    headers: { Authorization: `Bearer ${key}` }
  })
  return res.ok ? await res.json() : null
}

function rest(path: string, init: RequestInit = {}): Promise<Response> {
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

/**
 * The only way this function writes a subscriptions row.
 *
 * `apply_subscription_event` does the ordering check and the upsert in one statement, so two
 * deliveries landing in two concurrent invocations cannot overwrite each other, and an event older
 * than the row's `last_event_at` is dropped instead of walking the state backwards. Replays of the
 * same event are no-ops in effect (identical values, same timestamp).
 */
async function apply(args: Record<string, unknown>): Promise<void> {
  const res = await rest('/rest/v1/rpc/apply_subscription_event', {
    method: 'POST',
    body: JSON.stringify(args)
  })
  if (!res.ok) throw new Error(`subscriptions upsert failed: ${res.status} ${await res.text()}`)
}
