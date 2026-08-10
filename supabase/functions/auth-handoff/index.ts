// POST /functions/v1/auth-handoff — hands a browser login back to the desktop app.
//
// Three calls, in this order:
//   1. app  -> create   { id, secretHash }              (unauthenticated) — reserves a pending row
//      app opens  <site>/login?pair=<id>  in the system browser
//   2. site -> complete { id, refreshToken }            (Supabase user JWT) — parks the token
//   3. app  -> redeem   { id, secret }                  (unauthenticated) — collects it, once
//
// Deployed with verify_jwt=false because create and redeem are necessarily unauthenticated; the
// `complete` action verifies the bearer token itself. Anything expired, mismatched or already
// collected answers the same shape — {ok:false} with 404 — so the endpoint cannot be used to probe
// which pairing ids exist.

import { json, preflight } from '../_shared/http.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''

/** A pairing is only usable for five minutes; abandoned rows are swept after fifteen. */
const WINDOW_MS = 5 * 60 * 1000
const SWEEP_MS = 15 * 60 * 1000
/** Ceiling on `create` calls a minute, so nobody can flood the table with pending rows. */
const CREATE_PER_MINUTE = 30

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHA256_HEX_RE = /^[0-9a-f]{64}$/i

/** The single "no" answer. Never says which of expired / wrong secret / already redeemed it was. */
const NO = () => json({ ok: false }, 404)

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

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Opportunistic cleanup — cheap, indexed, and it means no cron job owns this table's hygiene. */
async function sweep(): Promise<void> {
  const cutoff = new Date(Date.now() - SWEEP_MS).toISOString()
  await rest(`/rest/v1/auth_handoffs?created_at=lt.${cutoff}`, { method: 'DELETE' }).catch(() => {})
}

interface Handoff {
  id: string
  secret_hash: string
  refresh_token: string | null
  user_id: string | null
  status: 'pending' | 'complete' | 'redeemed'
  created_at: string
}

async function load(id: string): Promise<Handoff | null> {
  const res = await rest(`/rest/v1/auth_handoffs?id=eq.${id}&select=*&limit=1`)
  if (!res.ok) return null
  const rows = await res.json().catch(() => [])
  return Array.isArray(rows) && rows[0] ? (rows[0] as Handoff) : null
}

function fresh(row: Handoff): boolean {
  return Date.now() - new Date(row.created_at).getTime() < WINDOW_MS
}

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)

  const body = await req.json().catch(() => null)
  const action = String(body?.action ?? '')
  const id = String(body?.id ?? '')
  if (!UUID_RE.test(id)) return json({ ok: false, error: 'Bad pairing id.' }, 400)

  // One sweep per request, not awaited on the hot path for redeem's latency.
  const swept = sweep()

  try {
    if (action === 'create') return await create(id, body?.secretHash)
    if (action === 'complete') return await complete(req, id, body?.refreshToken)
    if (action === 'redeem') return await redeem(id, body?.secret)
    return json({ ok: false, error: `Unknown action "${action}".` }, 400)
  } finally {
    await swept
  }
})

// ---------------------------------------------------------------- create (unauthenticated)

async function create(id: string, secretHash: unknown): Promise<Response> {
  const hash = String(secretHash ?? '').toLowerCase()
  if (!SHA256_HEX_RE.test(hash)) {
    return json({ ok: false, error: 'secretHash must be a sha256 hex digest.' }, 400)
  }

  if ((await recentCreates()) >= CREATE_PER_MINUTE) {
    return json({ ok: false, error: 'Too many pairing attempts. Wait a minute.' }, 429, {
      'Retry-After': '60'
    })
  }

  const res = await rest('/rest/v1/auth_handoffs', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ id, secret_hash: hash, status: 'pending' })
  })
  // A duplicate id means the caller reused a uuid; treat it as a hard no rather than reopening a
  // row somebody else may already be waiting on.
  if (!res.ok) return NO()
  return json({ ok: true, id, expiresInSeconds: WINDOW_MS / 1000 })
}

/**
 * A flood guard, deliberately global rather than per-IP: the rows are already timestamped so no
 * second table needs keeping clean, and no client address has to be written down to enforce it.
 * Thirty pairings a minute is far above real use and far below anything that could fill the table.
 */
async function recentCreates(): Promise<number> {
  const since = new Date(Date.now() - 60_000).toISOString()
  const res = await rest(
    `/rest/v1/auth_handoffs?created_at=gte.${since}&select=id`,
    { headers: { Prefer: 'count=exact', Range: '0-0' } }
  )
  const range = res.headers.get('content-range') ?? ''
  const total = Number(range.split('/')[1])
  return Number.isFinite(total) ? total : 0
}

// ---------------------------------------------------------------- complete (authenticated)

async function complete(req: Request, id: string, refreshToken: unknown): Promise<Response> {
  const token = String(refreshToken ?? '')
  if (!token) return json({ ok: false, error: 'refreshToken is required.' }, 400)

  const auth = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!auth) return json({ ok: false, error: 'Not signed in.' }, 401)
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${auth}` }
  })
  if (!userRes.ok) return json({ ok: false, error: 'Not signed in.' }, 401)
  const user = await userRes.json().catch(() => null)
  if (!user?.id) return json({ ok: false, error: 'Not signed in.' }, 401)

  const row = await load(id)
  if (!row || row.status !== 'pending' || !fresh(row)) return NO()

  const res = await rest(`/rest/v1/auth_handoffs?id=eq.${id}&status=eq.pending`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ refresh_token: token, user_id: user.id, status: 'complete' })
  })
  if (!res.ok) return NO()
  return json({ ok: true })
}

// ---------------------------------------------------------------- redeem (unauthenticated)

async function redeem(id: string, secret: unknown): Promise<Response> {
  const provided = String(secret ?? '')
  if (!provided) return NO()

  const row = await load(id)
  if (!row) return NO()

  // A pending row is not an error: the app polls every 2s while the human is still typing their
  // password. Only say "pending" once the secret has been proved, so polling cannot enumerate ids.
  const hash = await sha256Hex(provided)
  if (!timingSafeEqual(hash, row.secret_hash.toLowerCase())) return NO()
  if (!fresh(row)) return NO()
  if (row.status === 'pending') return json({ ok: false, pending: true }, 202)
  if (row.status !== 'complete' || !row.refresh_token) return NO()

  // Flip to redeemed with the status still in the filter: two racing polls cannot both win, and the
  // token is cleared in the same statement so it never sits in the table after collection.
  const res = await rest(`/rest/v1/auth_handoffs?id=eq.${id}&status=eq.complete`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'redeemed', refresh_token: null })
  })
  if (!res.ok) return NO()
  const rows = await res.json().catch(() => [])
  if (!Array.isArray(rows) || rows.length === 0) return NO()

  return json({ ok: true, refreshToken: row.refresh_token, userId: row.user_id })
}
