// CodexService — the heart of Courseless.
//
// Two transports, per the verified integration guide:
//   PRIMARY   persistent `codex app-server` (JSON-RPC/stdio): token deltas, warm ~1.2s turns,
//             graceful turn/interrupt, rateLimits passthrough. Auto-restarts up to 2 times.
//   FALLBACK  `codex exec --json` / `codex exec resume <id> --json`: whole messages only,
//             one process per turn, taskkill /T /F to cancel.
//
// Every operation is bounded by a 120s hard timeout and fails with a typed error:
//   NOT_INSTALLED | NOT_LOGGED_IN | TIMEOUT | PARSE_FAILED | TURN_FAILED | CANCELLED | TRANSPORT

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdirSync } from 'node:fs'
import type {
  CodexFailure,
  CodexStatus,
  CodexTransport,
  Lesson,
  NextSuggestion,
  RateLimitInfo,
  RecordMark,
  SkillLevel,
  StepContext
} from '../../shared/types'
import { log } from '../util/log'
import { AppServerClient, TURN_TIMEOUT_MS } from './codex/AppServerClient'
import { runExecTurn } from './codex/exec'
import {
  buildCoachFallbackPrompt,
  buildCoachPrompt,
  buildGeneratePrompt,
  buildRecordPrompt,
  buildRepairPrompt,
  buildSuggestPrompt,
  extractFirstJsonObject,
  parseLessonJson
} from './codex/prompts'
import { resolveCodexExe } from './codex/resolve'

const MAX_APP_SERVER_RESTARTS = 2

export function isCodexFailure(e: unknown): e is CodexFailure {
  return !!e && typeof e === 'object' && typeof (e as CodexFailure).kind === 'string'
}

export function toFailure(e: unknown): CodexFailure {
  if (isCodexFailure(e)) return e
  return { kind: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) }
}

interface TurnResult {
  threadId: string | null
  text: string
  transport: CodexTransport
}

interface TurnRequest {
  opId: string
  prompt: string
  threadId?: string | null
  onDelta?: (d: string) => void
  onTransport?: (t: CodexTransport) => void
}

function capture(
  exe: string,
  args: string[],
  timeoutMs = 15_000
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let done = false
    const child = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const timer = setTimeout(() => {
      if (done) return
      done = true
      try {
        if (process.platform === 'win32' && child.pid)
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
        else child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      resolve({ code: null, stdout, stderr })
    }, timeoutMs)
    child.stdout?.on('data', (d) => (stdout += d))
    child.stderr?.on('data', (d) => (stderr += d))
    child.on('error', () => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr })
    })
    child.on('close', (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

/**
 * Config is injected — CodexService imports NOTHING from electron so a plain Node harness
 * (scripts/generate-seeds.mts) can drive the exact same pipeline.
 */
export interface CodexServiceOptions {
  /** Empty scratch directory used as the agent's working root (read-only sandbox). */
  workDir: string
  /** Explicit path to codex(.exe). Omit to auto-discover. */
  codexExePath?: string | null
  /** Hard timeout per turn. Default 120s. */
  timeoutMs?: number
}

export class CodexService extends EventEmitter {
  private appServer: AppServerClient | null = null
  private appServerBroken = false
  private restarts = 0
  private cachedStatus: CodexStatus | null = null
  private statusInFlight: Promise<CodexStatus> | null = null
  private ops = new Map<string, { cancel(): void }>()
  private preferredModel: string | null = null
  private workDir: string
  private codexExePath: string | null
  private timeoutMs: number

  constructor(options: CodexServiceOptions) {
    super()
    this.workDir = options.workDir
    this.codexExePath = options.codexExePath ?? null
    this.timeoutMs = options.timeoutMs ?? TURN_TIMEOUT_MS
    try {
      mkdirSync(this.workDir, { recursive: true })
    } catch {
      /* ignore */
    }
  }

  private exe(force = false): string | null {
    return resolveCodexExe(this.codexExePath, force)
  }

  setPreferredModel(model: string | null): void {
    this.preferredModel = model && model.trim() ? model.trim() : null
  }

  // ------------------------------------------------------------------ status

  async detectStatus(force = false): Promise<CodexStatus> {
    if (this.cachedStatus && !force) return this.cachedStatus
    // Coalesce concurrent probes (React StrictMode fires the boot effect twice).
    if (this.statusInFlight) return this.statusInFlight
    this.statusInFlight = this.detectStatusInner(force).finally(() => {
      this.statusInFlight = null
    })
    return this.statusInFlight
  }

  private async detectStatusInner(force: boolean): Promise<CodexStatus> {
    const exePath = this.exe(force)
    if (!exePath) {
      this.cachedStatus = {
        installed: false,
        loggedIn: false,
        version: null,
        model: null,
        exePath: null,
        transport: null,
        error: 'Codex CLI not found. Install it with: npm install -g @openai/codex'
      }
      return this.cachedStatus
    }

    const ver = await capture(exePath, ['--version'], 10_000)
    const version = (ver.stdout || ver.stderr).trim().split('\n')[0] || null
    if (ver.code !== 0 && !version) {
      this.cachedStatus = {
        installed: false,
        loggedIn: false,
        version: null,
        model: null,
        exePath,
        transport: null,
        error: 'Found codex but it would not run.'
      }
      return this.cachedStatus
    }

    // exit code is the contract, not the string
    const login = await capture(exePath, ['login', 'status'], 15_000)
    const loggedIn = login.code === 0

    let model = this.preferredModel ?? this.appServer?.model ?? null
    let transport: CodexTransport | null = null
    if (loggedIn) {
      transport = this.appServerBroken ? 'exec' : 'app-server'
      if (!model && !this.appServerBroken) {
        // Ephemeral probe thread: gives us the real model name and warms the server.
        // `ephemeral` keeps it off disk so we do not litter ~/.codex/sessions.
        try {
          const client = await this.ensureAppServer()
          const t = await client.startThread({ ephemeral: true })
          model = t.model
        } catch (e) {
          log('codex', 'model probe failed', String(toFailure(e).message).slice(0, 200))
          transport = this.appServerBroken ? 'exec' : 'app-server'
        }
      }
    }

    this.cachedStatus = {
      installed: true,
      loggedIn,
      version,
      model,
      exePath,
      transport,
      error: loggedIn ? undefined : 'Not logged in. Run `codex login` in a terminal, then re-check.'
    }
    log('codex', 'status', this.cachedStatus)
    return this.cachedStatus
  }

  private async requireReady(): Promise<{ exePath: string }> {
    const status = await this.detectStatus()
    if (!status.installed || !status.exePath)
      throw { kind: 'NOT_INSTALLED', message: status.error ?? 'Codex CLI not found.' } as CodexFailure
    if (!status.loggedIn)
      throw {
        kind: 'NOT_LOGGED_IN',
        message: 'Codex is installed but not logged in. Run `codex login`, then re-check.'
      } as CodexFailure
    return { exePath: status.exePath }
  }

  // ------------------------------------------------------------------ app-server plumbing

  private async ensureAppServer(): Promise<AppServerClient> {
    const exePath = this.exe()
    if (!exePath) throw { kind: 'NOT_INSTALLED', message: 'Codex CLI not found.' } as CodexFailure
    if (!this.appServer) {
      this.appServer = new AppServerClient(exePath, this.workDir)
      this.appServer.on('crash', (code: number | null) => {
        this.restarts += 1
        log('codex', `app-server crashed (code=${code}) restart budget ${this.restarts}/${MAX_APP_SERVER_RESTARTS}`)
        if (this.restarts > MAX_APP_SERVER_RESTARTS) {
          this.appServerBroken = true
          log('codex', 'app-server disabled — falling back to exec transport for the rest of the session')
        }
        this.emit('transport', this.appServerBroken ? 'exec' : 'app-server')
      })
      this.appServer.on('rateLimits', (info: RateLimitInfo | null, raw: unknown) => {
        this.emit('rateLimits', info, raw)
      })
      this.appServer.on('warning', (m: string) => log('codex', 'warning', m.slice(0, 300)))
    }
    await this.appServer.ensureStarted()
    return this.appServer
  }

  private markAppServerUnusable(reason: string): void {
    this.restarts += 1
    log('codex', 'app-server unusable:', reason, `(${this.restarts}/${MAX_APP_SERVER_RESTARTS})`)
    if (this.restarts > MAX_APP_SERVER_RESTARTS) this.appServerBroken = true
  }

  // ------------------------------------------------------------------ one turn, either transport

  private async runTurn(req: TurnRequest): Promise<TurnResult> {
    const { exePath } = await this.requireReady()

    // ---- primary: app-server
    if (!this.appServerBroken) {
      try {
        const client = await this.ensureAppServer()
        let threadId = req.threadId ?? null
        if (threadId && !client.hasThread(threadId)) {
          try {
            await client.resumeThread(threadId)
          } catch (e) {
            log('codex', 'thread/resume failed, using exec resume instead', toFailure(e).message.slice(0, 200))
            return await this.runExec(exePath, req, threadId)
          }
        }
        if (!threadId) {
          const started = await client.startThread({ model: this.preferredModel })
          threadId = started.threadId
          if (started.model) this.touchModel(started.model)
        }
        req.onTransport?.('app-server')
        this.ops.set(req.opId, { cancel: () => void client.interrupt(threadId!).catch(() => undefined) })
        try {
          const text = await client.runTurn(threadId, req.prompt, {
            onDelta: req.onDelta,
            timeoutMs: this.timeoutMs
          })
          return { threadId, text, transport: 'app-server' }
        } finally {
          this.ops.delete(req.opId)
        }
      } catch (e) {
        const f = toFailure(e)
        // Model/user level failures are real answers — do not retry them on the other transport.
        if (f.kind === 'CANCELLED' || f.kind === 'TIMEOUT' || f.kind === 'TURN_FAILED' || f.kind === 'NOT_LOGGED_IN')
          throw f
        this.markAppServerUnusable(f.message)
      }
    }

    // ---- fallback: exec
    return this.runExec(exePath, req, req.threadId ?? null)
  }

  private async runExec(exePath: string, req: TurnRequest, threadId: string | null): Promise<TurnResult> {
    req.onTransport?.('exec')
    const handle = runExecTurn({
      exePath,
      prompt: req.prompt,
      workDir: this.workDir,
      threadId,
      model: this.preferredModel,
      timeoutMs: this.timeoutMs,
      onThread: (id) => {
        threadId = id
      },
      onMessage: (text) => {
        // exec has no deltas — surface the whole message once so the UI still moves.
        req.onDelta?.(text)
      },
      onWarning: (w) => log('codex/exec', 'warning', w.slice(0, 200))
    })
    this.ops.set(req.opId, { cancel: () => handle.cancel() })
    try {
      const res = await handle.promise
      return { threadId: res.threadId ?? threadId, text: res.text, transport: 'exec' }
    } finally {
      this.ops.delete(req.opId)
    }
  }

  private touchModel(model: string): void {
    if (this.cachedStatus && !this.cachedStatus.model) {
      this.cachedStatus = { ...this.cachedStatus, model }
      this.emit('status', this.cachedStatus)
    }
  }

  // ------------------------------------------------------------------ operations

  /**
   * One planning prompt -> one validated lesson draft, with a single repair round if the reply
   * was not usable JSON. Shared by "ask for a lesson" and "compile my recording", so the repair
   * loop, the parser and the failure message exist once.
   */
  private async plan(
    prompt: string,
    opId: string,
    hooks: {
      onDelta?: (d: string) => void
      onStatus?: (m: string, t?: CodexTransport) => void
      onMessage?: (text: string) => void
    }
  ): Promise<{ draft: NonNullable<ReturnType<typeof parseLessonJson>['draft']>; threadId: string | null; transport: CodexTransport; rawLen: number }> {
    const first = await this.runTurn({
      opId,
      prompt,
      onDelta: hooks.onDelta,
      onTransport: (t) => hooks.onStatus?.(`Connected via ${t}.`, t)
    })
    hooks.onMessage?.(first.text)

    let parsed = parseLessonJson(first.text)
    let raw = first.text
    if (!parsed.ok) {
      log('codex', 'lesson JSON invalid, repairing', parsed.problems.join(' | ').slice(0, 300))
      hooks.onStatus?.('Reply was not valid lesson JSON — asking Codex to fix it…')
      const repaired = await this.runTurn({
        opId,
        threadId: first.threadId,
        prompt: buildRepairPrompt(parsed.problems, first.text),
        onDelta: hooks.onDelta
      })
      raw = repaired.text
      hooks.onMessage?.(repaired.text)
      parsed = parseLessonJson(repaired.text)
    }

    if (!parsed.ok || !parsed.draft) {
      throw {
        kind: 'PARSE_FAILED',
        message: `Codex did not return a usable lesson: ${parsed.problems.join('; ').slice(0, 400)}`
      } as CodexFailure
    }
    return { draft: parsed.draft, threadId: first.threadId, transport: first.transport, rawLen: raw.length }
  }

  /** Generate a lesson. Emits raw deltas through `onDelta`; returns a fully-formed Lesson. */
  async generateLesson(
    ask: string,
    level: SkillLevel,
    opId: string,
    hooks: {
      onDelta?: (d: string) => void
      onStatus?: (m: string, t?: CodexTransport) => void
      onMessage?: (text: string) => void
    } = {}
  ): Promise<Lesson> {
    hooks.onStatus?.('Asking Codex to plan your doing-path…')
    const { draft, threadId, transport, rawLen } = await this.plan(buildGeneratePrompt(ask, level), opId, hooks)

    const lesson: Lesson = {
      id: randomUUID(),
      title: draft.title,
      tool: draft.tool,
      goal: draft.goal,
      est_minutes: draft.est_minutes,
      prerequisites: draft.prerequisites,
      steps: draft.steps,
      coverSeed: Math.floor(Math.random() * 1_000_000),
      codexThreadId: threadId,
      createdAt: new Date().toISOString(),
      runs: [],
      version: 1
    }
    log('codex', 'lesson generated', {
      id: lesson.id,
      title: lesson.title,
      steps: lesson.steps.length,
      thread: lesson.codexThreadId,
      transport,
      rawLen
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
    hooks: {
      onDelta?: (d: string) => void
      onStatus?: (m: string, t?: CodexTransport) => void
      onMessage?: (text: string) => void
    } = {}
  ): Promise<Lesson> {
    hooks.onStatus?.('Reading your marks…')
    const { draft, threadId, transport, rawLen } = await this.plan(buildRecordPrompt(session), opId, hooks)

    const lesson: Lesson = {
      id: randomUUID(),
      title: draft.title || session.name,
      tool: draft.tool,
      goal: draft.goal,
      est_minutes: draft.est_minutes,
      prerequisites: draft.prerequisites,
      steps: draft.steps,
      coverSeed: Math.floor(Math.random() * 1_000_000),
      codexThreadId: threadId,
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
      log('codex', 'dropping targets that were never recorded', invented.map((s) => s.target).join(' | ').slice(0, 200))
      lesson.steps = lesson.steps.map((s) => (s.target && !recorded.has(s.target) ? { ...s, target: undefined } : s))
    }
    log('codex', 'recording compiled', {
      id: lesson.id,
      title: lesson.title,
      steps: lesson.steps.length,
      marks: session.marks.length,
      targetsFromMarks: kept,
      targetsDropped: invented.length,
      audience: session.audience || null,
      transport,
      rawLen
    })
    return lesson
  }

  /** Continue the SAME codex thread so the model still has the lesson in context. */
  async coach(
    lesson: Lesson,
    message: string,
    stepContext: StepContext | null,
    opId: string,
    hooks: { onDelta?: (d: string) => void; onStatus?: (m: string, t?: CodexTransport) => void } = {}
  ): Promise<{ text: string; threadId: string | null }> {
    const threadId = lesson.codexThreadId
    if (threadId) {
      try {
        const res = await this.runTurn({
          opId,
          threadId,
          prompt: buildCoachPrompt(message, stepContext, lesson.title),
          onDelta: hooks.onDelta,
          onTransport: (t) => hooks.onStatus?.(`Coaching via ${t} (same thread).`, t)
        })
        return { text: res.text, threadId: res.threadId }
      } catch (e) {
        const f = toFailure(e)
        if (f.kind === 'CANCELLED' || f.kind === 'NOT_LOGGED_IN' || f.kind === 'NOT_INSTALLED') throw f
        log('codex', 'coach on existing thread failed, retrying with embedded context', f.message.slice(0, 200))
      }
    }
    // No thread (or the thread is gone): re-establish context explicitly.
    hooks.onStatus?.('Thread unavailable — re-sending the lesson as context.')
    const res = await this.runTurn({
      opId,
      prompt: buildCoachFallbackPrompt(lesson, message, stepContext),
      onDelta: hooks.onDelta
    })
    return { text: res.text, threadId: res.threadId }
  }

  async suggestNext(lesson: Lesson, runStats: unknown, opId: string): Promise<NextSuggestion> {
    const res = await this.runTurn({
      opId,
      threadId: lesson.codexThreadId,
      prompt: buildSuggestPrompt(lesson, runStats)
    })
    const block = extractFirstJsonObject(res.text)
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
      message: `Suggestion was not JSON: ${res.text.slice(0, 200)}`
    } as CodexFailure
  }

  cancel(opId: string): boolean {
    const op = this.ops.get(opId)
    if (!op) return false
    log('codex', 'cancel', opId)
    op.cancel()
    return true
  }

  dispose(): void {
    for (const [, op] of this.ops) {
      try {
        op.cancel()
      } catch {
        /* ignore */
      }
    }
    this.ops.clear()
    this.appServer?.stop()
    this.appServer = null
  }
}
