// Stripe over plain fetch. The REST API is form-encoded and we need six calls; the official SDK
// would be the larger dependency by an order of magnitude.

const SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const API = 'https://api.stripe.com/v1'

/** Stripe's form encoding: nested objects become `a[b]`, arrays become `a[0]`. */
function encode(obj: Record<string, unknown>, prefix = ''): string[] {
  const parts: string[] = []
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue
    const name = prefix ? `${prefix}[${key}]` : key
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (v && typeof v === 'object') parts.push(...encode(v as Record<string, unknown>, `${name}[${i}]`))
        else parts.push(`${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(String(v))}`)
      })
    } else if (typeof value === 'object') {
      parts.push(...encode(value as Record<string, unknown>, name))
    } else {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`)
    }
  }
  return parts
}

export class StripeError extends Error {}

export async function stripeCall<T = Record<string, unknown>>(
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  if (!SECRET_KEY) throw new StripeError('Billing is not configured on the server.')
  const encoded = encode(params).join('&')
  const url = method === 'GET' ? `${API}${path}${encoded ? `?${encoded}` : ''}` : `${API}${path}`
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: method === 'POST' ? encoded : undefined
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new StripeError(json?.error?.message ?? `Stripe ${res.status}`)
  }
  return json as T
}

/**
 * Verify a `Stripe-Signature` header. Scheme: `t=<unix>,v1=<hex hmac>` where the signed payload is
 * `${t}.${rawBody}`. Compared in constant time, and stale timestamps are rejected so a captured
 * request cannot be replayed.
 */
export async function verifyWebhookSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  toleranceSeconds = 300
): Promise<boolean> {
  if (!header || !secret) return false
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=')
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()]
    })
  )
  const timestamp = Number(parts.t)
  if (!Number.isFinite(timestamp)) return false
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`)
  )
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')

  // Stripe may send several v1 signatures during a secret rotation; any match is valid.
  const given = header
    .split(',')
    .filter((p) => p.trim().startsWith('v1='))
    .map((p) => p.trim().slice(3))
  return given.some((sig) => timingSafeEqual(sig, expected))
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
