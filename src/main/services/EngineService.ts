// EngineService — the heart of Courseless.
//
// One hosted endpoint, two shapes of call:
//   STREAMING   generate / compile / coach  -> text/event-stream, token deltas as they arrive
//   ONE-SHOT    suggest / vision            -> a single JSON reply
//
// The prompts live on the server; the client owns everything that must not silently change:
// the JSON parser and normalizer, the recorded-target post-filter, per-operation cancellation,
// the hard timeout, and the typed failure taxonomy the UI branches on:
//   NOT_LOGGED_IN | LIMIT | TIMEOUT | PARSE_FAILED | TURN_FAILED | CANCELLED | TRANSPORT | UNKNOWN
//
// Config is injected and nothing here imports electron, so a plain Node harness
// (scripts/generate-seeds.mts) can drive the exact same pipeline.

import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import type {
  BillingPlanChoice,
  BillingStatus,
  EngineErrorKind,
  EngineFailure,
  EngineStatus,
  EngineTransport,
  Lesson,
  NextSuggestion,
  RecordMark,
  SkillLevel,
  StepContext
} from '../../shared/types'
import { log } from '../util/log'
import { extractFirstJsonObject, parseLessonJson } from './engine/parse'

/** Hard bound on one operation, stream included. The server's own budget is 110s. */
const TURN_TIMEOUT_MS = 120_000
/** Pointing is interactive: a grounding call that takes longer than this is no longer useful. */
const VISION_TIMEOUT_MS = 30_000
/** Plan/usage answers are small; if this does not come back, the service is not reachable. */
const STATUS_TIMEOUT_MS = 15_000
/** The coach is stateless server-side, so the tail of the conversation is carried every turn. */
const COACH_HISTORY = 12

export function isEngineFailure(e: unknown): e is EngineFailure {
  return !!e && typeof e === 'object' && typeof (e as EngineFailure).kind === 'string'
}

export function toFailure(e: unknown): EngineFailure {
  if (isEngineFailure(e)) return e
  return { kind: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) }
}

// Names the rest of the app grew up with.
export const isCodexFailure = isEngineFailure

type StreamOp = 'generate' | 'compile' | 'coach'
type JsonOp = 'suggest' | 'vision'

interface RunningOp {
  controller: AbortController
  /** Why the abort happened — the difference between "you cancelled" and "it took too long". */
  reason: 'cancelled' | 'timeout' | null
}

interface Hooks {
  onDelta?(text: string): void
  onStatus?(message: string, transport?: EngineTransport): void
  onMessage?(text: string): void
}

interface CoachTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface EngineServiceOptions {
  /** Project base URL, e.g. https://<ref>.supabase.co — no trailing slash. */
  baseUrl: string
  /** Public anon key. Never a secret: the row policies do the work. */
  anonKey: string
  /** The current access token, or null when nobody is signed in. */
  getAccessToken(): Promise<string | null>
  /** The signed-in address, for the status card. */
  accountEmail?(): string | null
  /** Hard timeout per operation. Default 120s. */
  timeoutMs?: number
}

function planLabel(plan: BillingStatus['plan']): string {
  if (plan === 'max') return 'Max'
  return plan === 'pro' ? 'Pro' : 'Free'
}

/** Map whatever the server called it back onto the kinds the UI knows. */
function asKind(raw: unknown, fallback: EngineErrorKind): EngineErrorKind {
  const kinds: EngineErrorKind[] = [
    'NOT_LOGGED_IN',
    'TIMEOUT',
    'PARSE_FAILED',
    'TURN_FAILED',
    'CANCELLED',
    'TRANSPORT',
    'LIMIT',
    'UNKNOWN'
  ]
  return typeof raw === 'string' && (kinds as string[]).includes(raw) ? (raw as EngineErrorKind) : fallback
}

export class EngineService extends EventEmitter {
  private opts: EngineServiceOptions
  private timeoutMs: number
  private ops = new Map<string, RunningOp>()
  private cachedStatus: EngineStatus | null = null
  private statusInFlight: Promise<EngineStatus> | null = null
  /** Coach context, per lesson, for this session only. Never written to disk. */
  private history = new Map<string, CoachTurn[]>()

  constructor(options: EngineServiceOptions) {
    super()
    this.opts = options
    this.timeoutMs = options.timeoutMs ?? TURN_TIMEOUT_MS
  }

  /**
   * Kept so callers that used to choose a model still compile. The engine picks the model per
   * operation now — a lesson planner and a coach are not the same job — so this does nothing.
   */
  setPreferredModel(_model: string | null): void {
    /* the service chooses */
  }

  // ------------------------------------------------------------------ status

  async detectStatus(force = false): Promise<EngineStatus> {
    if (this.cachedStatus && !force) return this.cachedStatus
    // Coalesce concurrent probes (React StrictMode fires the boot effect twice).
    if (this.statusInFlight) return this.statusInFlight
    this.statusInFlight = this.detectStatusInner().finally(() => {
      this.statusInFlight = null
    })
    return this.statusInFlight
  }

  private async detectStatusInner(): Promise<EngineStatus> {
    const email = this.opts.accountEmail?.() ?? null
    let token: string | null = null
    try {
      token = await this.opts.getAccessToken()
    } catch (e) {
      log('engine', 'token lookup failed', String(e).slice(0, 200))
    }

    if (!token) {
      return this.publish({
        installed: true,
        loggedIn: false,
        version: 'cloud',
        model: null,
        exePath: null,
        transport: null,
        email: null,
        plan: 'free',
        error: 'Sign in to build lessons and ask your coach.'
      })
    }

    try {
      const billing = await this.billingStatus()
      return this.publish({
        installed: true,
        loggedIn: true,
        version: 'cloud',
        model: planLabel(billing.plan),
        exePath: null,
        transport: 'app-server',
        email,
        plan: billing.plan
      })
    } catch (e) {
      const f = toFailure(e)
      if (f.kind === 'NOT_LOGGED_IN') {
        return this.publish({
          installed: true,
          loggedIn: false,
          version: 'cloud',
          model: null,
          exePath: null,
          transport: null,
          email: null,
          plan: 'free',
          error: 'That session has expired. Sign in again.'
        })
      }
      return this.publish({
        installed: true,
        loggedIn: true,
        version: 'cloud',
        model: null,
        exePath: null,
        transport: null,
        email,
        plan: 'free',
        error: `Could not reach your coach service: ${f.message.slice(0, 160)}`
      })
    }
  }

  private publish(status: EngineStatus): EngineStatus {
    const changed = JSON.stringify(status) !== JSON.stringify(this.cachedStatus)
    this.cachedStatus = status
    if (changed) {
      log('engine', 'status', status)
      this.emit('status', status)
    }
    return status
  }

  /** The session changed under us — the next status probe must not answer from the old one. */
  invalidateStatus(): void {
    this.cachedStatus = null
    void this.detectStatus(true).catch(() => undefined)
  }

  /**
   * The account went away. Everything this service is holding that belonged to it goes with it:
   *  * in-flight operations — a generate or a coach turn started with the old token would either
   *    fail with a 401 or, worse, finish and stream an answer into a signed-out window;
   *  * every lesson's coach history, which is a transcript of what that person asked;
   *  * the cached status, so the next probe reads the new (absent) session rather than the plan
   *    the old one was on.
   * There is no cached access token to clear: `send()` asks AuthService for one on every call,
   * which is exactly why signing out is enough to stop the engine answering.
   */
  signedOut(): void {
    const cancelled = this.ops.size
    for (const [, op] of this.ops) {
      try {
        op.reason = 'cancelled'
        op.controller.abort()
      } catch {
        /* ignore */
      }
    }
    this.ops.clear()
    this.history.clear()
    this.cachedStatus = null
    this.statusInFlight = null
    log('engine', 'signed out — cleared', { cancelledOps: cancelled })
  }

  // ------------------------------------------------------------------ transport

  /**
   * One operation, one AbortController, one timer. `cancel(opId)` and the timeout both abort the
   * same signal — the reason recorded on the way in is what tells them apart afterwards.
   */
  private async withOp<T>(opId: string | null, timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const key = opId ?? randomUUID()
    const op: RunningOp = { controller: new AbortController(), reason: null }
    this.ops.set(key, op)
    const timer = setTimeout(() => {
      op.reason = 'timeout'
      op.controller.abort()
    }, timeoutMs)
    try {
      return await run(op.controller.signal)
    } catch (e) {
      if (op.reason === 'cancelled') throw { kind: 'CANCELLED', message: 'Stopped.' } as EngineFailure
      if (op.reason === 'timeout')
        throw {
          kind: 'TIMEOUT',
          message: `Your coach did not answer within ${Math.round(timeoutMs / 1000)}s.`
        } as EngineFailure
      if (isEngineFailure(e)) throw e
      throw { kind: 'TRANSPORT', message: String(e instanceof Error ? e.message : e).slice(0, 300) } as EngineFailure
    } finally {
      clearTimeout(timer)
      this.ops.delete(key)
    }
  }

  private async send(fn: 'engine' | 'billing', body: unknown, signal: AbortSignal): Promise<Response> {
    const token = await this.opts.getAccessToken()
    if (!token) throw { kind: 'NOT_LOGGED_IN', message: 'Sign in to use your coach.' } as EngineFailure
    const res = await fetch(`${this.opts.baseUrl}/functions/v1/${fn}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: this.opts.anonKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal
    })
    if (!res.ok) throw await this.httpFailure(res)
    return res
  }

  /** HTTP status is the contract; the body only refines the wording. */
  private async httpFailure(res: Response): Promise<EngineFailure> {
    let payload: any = null
    let text = ''
    try {
      text = await res.text()
      payload = text ? JSON.parse(text) : null
    } catch {
      /* a non-JSON body is still an answer about the status code */
    }
    const message = (typeof payload?.message === 'string' && payload.message) || text.slice(0, 200) || res.statusText

    if (res.status === 401)
      return { kind: 'NOT_LOGGED_IN', message: 'That session has expired. Sign in again.' }
    if (res.status === 402) {
      this.emit('rateLimits', { usedPercent: 100, resetsAt: null }, payload)
      return {
        kind: 'LIMIT',
        message: message || 'You have used this month’s allowance.'
      }
    }
    if (res.status === 408 || res.status === 504)
      return { kind: 'TIMEOUT', message: 'Your coach took too long to answer.' }
    // 429 is the per-user rate limit, not the monthly allowance: waiting fixes it, a plan does not.
    if (res.status === 429)
      return { kind: 'TURN_FAILED', message: 'The engine is catching up — try again in a moment.' }
    return { kind: asKind(payload?.kind, 'TURN_FAILED'), message: message || `Request failed (${res.status}).` }
  }

  /**
   * A streaming operation. Frames are `data: <json>\n\n`; deltas are handed straight to the UI so
   * the Generating screen animates on real tokens rather than a spinner.
   */
  private async stream(op: StreamOp, payload: unknown, opId: string, hooks: Hooks): Promise<string> {
    return this.withOp(opId, this.timeoutMs, async (signal) => {
      const res = await this.send('engine', { op, payload }, signal)
      if (!res.body) throw { kind: 'TRANSPORT', message: 'Your coach sent no reply.' } as EngineFailure
      hooks.onStatus?.('Connected.', 'app-server')
      this.emit('transport', 'app-server' as EngineTransport)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let final = ''
      let sawDone = false

      const handle = (frame: string): void => {
        const data = frame
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('\n')
        if (!data) return
        let evt: any
        try {
          evt = JSON.parse(data)
        } catch {
          return
        }
        if (evt?.type === 'status' && typeof evt.message === 'string') hooks.onStatus?.(evt.message, 'app-server')
        else if (evt?.type === 'delta' && typeof evt.text === 'string') hooks.onDelta?.(evt.text)
        else if (evt?.type === 'done') {
          sawDone = true
          if (typeof evt.text === 'string') final = evt.text
        } else if (evt?.type === 'error') {
          throw {
            kind: asKind(evt.kind, 'TURN_FAILED'),
            message: typeof evt.message === 'string' ? evt.message : 'Your coach stopped part-way.'
          } as EngineFailure
        }
      }

      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '')
          let cut = buffer.indexOf('\n\n')
          while (cut !== -1) {
            const frame = buffer.slice(0, cut)
            buffer = buffer.slice(cut + 2)
            handle(frame)
            cut = buffer.indexOf('\n\n')
          }
        }
        if (buffer.trim()) handle(buffer)
      } finally {
        // Leaving the loop early (an error frame, a cancel) must not leave the socket reading.
        void reader.cancel().catch(() => undefined)
      }

      if (!sawDone && !final)
        throw { kind: 'TRANSPORT', message: 'The reply ended before your coach finished.' } as EngineFailure
      hooks.onMessage?.(final)
      return final
    })
  }

  /** A one-shot operation: `{ok:true,text}` or `{ok:false,kind,message}`. */
  private async oneShot(op: JsonOp, payload: unknown, opId: string | null, timeoutMs: number): Promise<string> {
    return this.withOp(opId, timeoutMs, async (signal) => {
      const res = await this.send('engine', { op, payload }, signal)
      const body = (await res.json()) as { ok?: boolean; text?: string; kind?: string; message?: string }
      if (!body?.ok)
        throw {
          kind: asKind(body?.kind, 'TURN_FAILED'),
          message: body?.message ?? 'Your coach could not answer that.'
        } as EngineFailure
      return String(body.text ?? '')
    })
  }

  // ------------------------------------------------------------------ operations

  /** One reply -> one validated lesson draft. The repair round happens server-side. */
  private draft(raw: string): NonNullable<ReturnType<typeof parseLessonJson>['draft']> {
    const parsed = parseLessonJson(raw)
    if (!parsed.ok || !parsed.draft) {
      log('engine', 'lesson JSON unusable', parsed.problems.join(' | ').slice(0, 300))
      throw {
        kind: 'PARSE_FAILED',
        message: `Your coach did not return a usable lesson: ${parsed.problems.join('; ').slice(0, 400)}`
      } as EngineFailure
    }
    return parsed.draft
  }

  /** Generate a lesson. Emits raw deltas through `onDelta`; returns a fully-formed Lesson. */
  async generateLesson(ask: string, level: SkillLevel, opId: string, hooks: Hooks = {}): Promise<Lesson> {
    hooks.onStatus?.('Asking your coach to plan the doing-path…')
    const text = await this.stream('generate', { ask, level }, opId, hooks)
    const draft = this.draft(text)

    const lesson: Lesson = {
      id: randomUUID(),
      title: draft.title,
      tool: draft.tool,
      goal: draft.goal,
      est_minutes: draft.est_minutes,
      prerequisites: draft.prerequisites,
      steps: draft.steps,
      coverSeed: Math.floor(Math.random() * 1_000_000),
      codexThreadId: null,
      createdAt: new Date().toISOString(),
      runs: [],
      version: 1
    }
    log('engine', 'lesson generated', {
      id: lesson.id,
      title: lesson.title,
      steps: lesson.steps.length,
      rawLen: text.length
    })
    return lesson
  }

  /**
   * Compile a recorded walkthrough into a lesson. Same planner, different evidence: instead of a
   * sentence about what someone wants to do, the model gets the ordered marks from someone who
   * already did it — including the element names, which become `target` and make the pointer
   * work on the recipient's machine.
   */
  async compileRecording(
    session: { name: string; audience: string; marks: RecordMark[] },
    opId: string,
    hooks: Hooks = {}
  ): Promise<Lesson> {
    hooks.onStatus?.('Reading your marks…')
    const text = await this.stream(
      'compile',
      { name: session.name, audience: session.audience, marks: session.marks },
      opId,
      hooks
    )
    const draft = this.draft(text)

    const lesson: Lesson = {
      id: randomUUID(),
      title: draft.title || session.name,
      tool: draft.tool,
      goal: draft.goal,
      est_minutes: draft.est_minutes,
      prerequisites: draft.prerequisites,
      steps: draft.steps,
      coverSeed: Math.floor(Math.random() * 1_000_000),
      codexThreadId: null,
      createdAt: new Date().toISOString(),
      runs: [],
      version: 1,
      recordedByYou: true,
      ...(session.audience.trim() ? { audience: session.audience.trim() } : {})
    }
    const recorded = new Set(session.marks.map((m) => m.element?.name).filter(Boolean))
    const kept = lesson.steps.filter((s) => s.target && recorded.has(s.target)).length
    const invented = lesson.steps.filter((s) => s.target && !recorded.has(s.target))
    // A target that was never recorded is a guess wearing a recorded target's clothes. Drop it:
    // pointing then falls back to mining `where`, which declines honestly instead of misleading.
    if (invented.length) {
      log('engine', 'dropping targets that were never recorded', invented.map((s) => s.target).join(' | ').slice(0, 200))
      lesson.steps = lesson.steps.map((s) => (s.target && !recorded.has(s.target) ? { ...s, target: undefined } : s))
    }
    log('engine', 'recording compiled', {
      id: lesson.id,
      title: lesson.title,
      steps: lesson.steps.length,
      marks: session.marks.length,
      targetsFromMarks: kept,
      targetsDropped: invented.length,
      audience: session.audience || null,
      rawLen: text.length
    })
    return lesson
  }

  /**
   * Coach a learner mid-lesson. The service holds no conversation, so the lesson and the tail of
   * this thread go up with every turn — which is also why a coach reply survives a restart of the
   * service but not of Courseless. `threadId` is always null; nothing persists it any more.
   */
  async coach(
    lesson: Lesson,
    message: string,
    stepContext: StepContext | null,
    opId: string,
    hooks: Hooks = {}
  ): Promise<{ text: string; threadId: string | null }> {
    const history = this.history.get(lesson.id) ?? []
    const text = await this.stream(
      'coach',
      {
        lesson: { title: lesson.title, tool: lesson.tool, goal: lesson.goal, steps: lesson.steps },
        message,
        stepContext: stepContext ?? null,
        history
      },
      opId,
      hooks
    )
    // Only a turn that actually completed belongs in the context of the next one.
    const next = [...history, { role: 'user' as const, text: message }, { role: 'assistant' as const, text }]
    this.history.set(lesson.id, next.slice(-COACH_HISTORY))
    return { text, threadId: null }
  }

  /** Drop a lesson's coach context — it ended, or the lesson is gone. */
  forgetCoach(lessonId: string): void {
    this.history.delete(lessonId)
  }

  async suggestNext(lesson: Lesson, runStats: unknown, opId: string): Promise<NextSuggestion> {
    const text = await this.oneShot(
      'suggest',
      { lesson: { title: lesson.title, tool: lesson.tool, goal: lesson.goal }, runStats: runStats ?? {} },
      opId,
      this.timeoutMs
    )
    const block = extractFirstJsonObject(text)
    if (block) {
      try {
        const obj = JSON.parse(block)
        const title = typeof obj.title === 'string' ? obj.title.trim() : ''
        const ask = typeof obj.ask === 'string' ? obj.ask.trim() : ''
        if (title && ask) return { title, ask }
      } catch {
        /* fall through */
      }
    }
    throw {
      kind: 'PARSE_FAILED',
      message: `Suggestion was not JSON: ${text.slice(0, 200)}`
    } as EngineFailure
  }

  /**
   * Look at one screenshot and answer in text. PointService owns the prompt and the verification
   * round — this only carries the image up and the reply back, on its own short leash.
   */
  async vision(imagePath: string, prompt: string): Promise<string> {
    const imagePngBase64 = readFileSync(imagePath).toString('base64')
    return this.oneShot('vision', { imagePngBase64, prompt }, null, VISION_TIMEOUT_MS)
  }

  // ------------------------------------------------------------------ plan

  async billingStatus(): Promise<BillingStatus> {
    return this.withOp(null, STATUS_TIMEOUT_MS, async (signal) => {
      const res = await this.send('billing', { action: 'status' }, signal)
      const body = (await res.json()) as Partial<BillingStatus>
      // Two booleans the UI branches on, so they are booleans here and not "undefined from an
      // older backend": a missing field must read as "no cancel scheduled, no billing account",
      // which is the same thing the app showed before these fields existed.
      return {
        ...(body as BillingStatus),
        cancelAtPeriodEnd: body.cancelAtPeriodEnd === true,
        hasBillingAccount: body.hasBillingAccount === true
      }
    })
  }

  async billingCheckout(plan: BillingPlanChoice): Promise<string> {
    return this.billingUrl({ action: 'checkout', plan })
  }

  async billingPortal(): Promise<string> {
    return this.billingUrl({ action: 'portal' })
  }

  private async billingUrl(body: Record<string, unknown>): Promise<string> {
    return this.withOp(null, STATUS_TIMEOUT_MS, async (signal) => {
      const res = await this.send('billing', body, signal)
      const payload = (await res.json()) as { url?: string }
      if (!payload?.url) throw { kind: 'TURN_FAILED', message: 'No page came back to open.' } as EngineFailure
      return payload.url
    })
  }

  // ------------------------------------------------------------------ lifecycle

  cancel(opId: string): boolean {
    const op = this.ops.get(opId)
    if (!op) return false
    log('engine', 'cancel', opId)
    op.reason = 'cancelled'
    op.controller.abort()
    return true
  }

  dispose(): void {
    for (const [, op] of this.ops) {
      try {
        op.reason = 'cancelled'
        op.controller.abort()
      } catch {
        /* ignore */
      }
    }
    this.ops.clear()
    this.history.clear()
  }
}
