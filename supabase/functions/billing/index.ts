// POST /functions/v1/billing — checkout, portal, status.

import {
  getEntitlement,
  getSubscription,
  getUser,
  type Plan
} from '../_shared/entitlement.ts'
import { json, preflight } from '../_shared/http.ts'
import { stripeCall } from '../_shared/stripe.ts'

const APP_URL = Deno.env.get('APP_URL') ?? 'https://courseless.hyfro.org'
/** The marketing/account site. Falls back to APP_URL while they are the same origin. */
const SITE_URL = (Deno.env.get('SITE_URL') ?? APP_URL).replace(/\/$/, '')
const PORTAL_CONFIGURATION_ID = Deno.env.get('STRIPE_PORTAL_CONFIGURATION_ID') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''

const PLAN_LOOKUP_KEYS = ['pro_monthly', 'pro_annual', 'max_monthly', 'max_annual'] as const
type PlanKey = (typeof PLAN_LOOKUP_KEYS)[number]

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const user = await getUser(req)
  if (!user) return json({ error: 'Not signed in.' }, 401)

  const body = await req.json().catch(() => null)
  const action = String(body?.action ?? '')

  try {
    if (action === 'status') return json(await status(user.id))
    if (action === 'checkout') return json(await checkout(user.id, user.email, body?.plan))
    if (action === 'portal') return json(await portal(user.id))
    return json({ error: `Unknown action "${action}".` }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502)
  }
})

async function status(userId: string) {
  const ent = await getEntitlement(userId)
  return {
    plan: ent.plan,
    status: ent.status,
    currentPeriodEnd: ent.currentPeriodEnd,
    // Stripe leaves a cancelled-but-not-yet-ended subscription at status 'active'. Without this
    // the app would tell the customer their plan renews on the day it actually stops.
    cancelAtPeriodEnd: ent.cancelAtPeriodEnd,
    // Not the same question as "are they paying". Invoices and receipts outlive the subscription,
    // so the portal stays reachable for anyone who has ever had one.
    hasBillingAccount: ent.hasBillingAccount,
    usage: ent.usage,
    // Max is sold as unlimited: the fair-use ceiling is enforced but never shown as a plan limit.
    limits: ent.plan === 'max' ? null : ent.limits
  }
}

async function checkout(userId: string, email: string | null, plan: unknown) {
  const key = String(plan ?? '') as PlanKey
  if (!PLAN_LOOKUP_KEYS.includes(key)) {
    throw new Error(`Unknown plan "${String(plan)}". Expected one of ${PLAN_LOOKUP_KEYS.join(', ')}.`)
  }

  const prices = await stripeCall<{ data: { id: string }[] }>('GET', '/prices', {
    lookup_keys: [key],
    active: true,
    limit: 1
  })
  const priceId = prices.data?.[0]?.id
  if (!priceId) throw new Error(`No active Stripe price with lookup_key "${key}".`)

  const customerId = await ensureCustomer(userId, email)
  const tier: Plan = key.startsWith('max') ? 'max' : 'pro'

  const session = await stripeCall<{ url: string }>('POST', '/checkout/sessions', {
    mode: 'subscription',
    customer: customerId,
    client_reference_id: userId,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: `${APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_URL}/billing/cancelled`,
    metadata: { supabase_user_id: userId, plan: tier },
    // Subscription events arrive without the session, so the user id has to live on the
    // subscription itself or the webhook has nothing to key on.
    subscription_data: { metadata: { supabase_user_id: userId, plan: tier } }
  })
  return { url: session.url }
}

async function portal(userId: string) {
  const sub = await getSubscription(userId)
  if (!sub.stripeCustomerId) throw new Error('No billing account yet — subscribe first.')
  // Everything the customer can do to their subscription — cancel, switch plan, change card, pull
  // invoices — lives in this hosted portal, opened in their real browser. We ship no billing UI.
  const session = await stripeCall<{ url: string }>('POST', '/billing_portal/sessions', {
    customer: sub.stripeCustomerId,
    return_url: `${SITE_URL}/account`,
    configuration: PORTAL_CONFIGURATION_ID || undefined
  })
  return { url: session.url }
}

/** One Stripe customer per user, remembered on the subscriptions row so we never create two. */
async function ensureCustomer(userId: string, email: string | null): Promise<string> {
  const sub = await getSubscription(userId)
  if (sub.stripeCustomerId) return sub.stripeCustomerId

  const customer = await stripeCall<{ id: string }>('POST', '/customers', {
    email: email ?? undefined,
    metadata: { supabase_user_id: userId }
  })
  await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?on_conflict=user_id`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates'
    },
    // Only the customer id. Writing back the `status` we just read would let this request clobber
    // a webhook that landed in between — the row's entitlement fields belong to the webhook alone.
    body: JSON.stringify({
      user_id: userId,
      stripe_customer_id: customer.id,
      updated_at: new Date().toISOString()
    })
  })
  return customer.id
}
