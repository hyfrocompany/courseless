// JSON-RPC 2.0 client for `codex app-server` (newline-delimited JSON over stdio).
//
// Protocol shapes are taken from the generated app-server TypeScript bindings for codex-cli
// 0.146.0 and from the verified capture in research/codex-integration.md:
//   initialize -> initialized (notification) -> thread/start -> turn/start
//   notifications: item/agentMessage/delta, item/completed, turn/completed (turn.status),
//                  account/rateLimits/updated, thread/tokenUsage/updated, error
//   cancel: turn/interrupt { threadId, turnId }   (BOTH fields required)

import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { CodexFailure, RateLimitInfo } from '../../../shared/types'
import { log } from '../../util/log'

const REQUEST_TIMEOUT_MS = 45_000
export const TURN_TIMEOUT_MS = 120_000

interface PendingReq {
  method: string
  resolve(v: any): void
  reject(e: CodexFailure): void
  timer: NodeJS.Timeout
}

interface TurnCtx {
  threadId: string
  turnId: string | null
  deltaText: string
  lastMessage: string | null
  onDelta?: (d: string) => void
  settled: boolean
  timer: NodeJS.Timeout | null
  cancelRequested: boolean
  resolve(text: string): void
  reject(e: CodexFailure): void
}

export interface StartedThread {
  threadId: string
  model: string | null
}

function fail(kind: CodexFailure['kind'], message: string): CodexFailure {
  return { kind, message }
}

export class AppServerClient extends EventEmitter {
  private child: ChildProcess | null = null
  private buf = ''
  private nextId = 1
  private pending = new Map<number, PendingReq>()
  private turns = new Map<string, TurnCtx>() // keyed by threadId (one live turn per thread)
  private starting: Promise<void> | null = null
  private stopping = false
  /** Threads this app-server process currently has loaded. */
  private liveThreads = new Set<string>()

  model: string | null = null
  serverInfo: Record<string, unknown> | null = null

  constructor(
    private exePath: string,
    private workDir: string
  ) {
    super()
  }

  isRunning(): boolean {
    return !!this.child && this.child.exitCode === null && !this.child.killed
  }

  hasThread(threadId: string): boolean {
    return this.liveThreads.has(threadId)
  }

  // ------------------------------------------------------------------ lifecycle

  async ensureStarted(): Promise<void> {
    if (this.isRunning()) return
    if (this.starting) return this.starting
    this.starting = this.start().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async start(): Promise<void> {
    this.stopping = false
    this.buf = ''
    this.liveThreads.clear()

    log('app-server', 'spawning', this.exePath)
    const child = spawn(this.exePath, ['app-server'], {
      cwd: this.workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.child = child

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => this.onStdout(chunk))
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (d: string) => {
      const t = d.trim()
      if (t) log('app-server/stderr', t.slice(0, 400))
    })
    child.on('error', (err) => {
      log('app-server', 'spawn error', String(err))
      this.teardown(fail('TRANSPORT', `app-server spawn failed: ${String(err)}`))
    })
    child.on('close', (code) => {
      log('app-server', 'closed code=' + code)
      const wasStopping = this.stopping
      this.teardown(fail('TRANSPORT', `app-server exited (code ${code})`))
      if (!wasStopping) this.emit('crash', code)
    })

    // handshake
    const res = await this.request('initialize', {
      clientInfo: { name: 'courseless', title: 'Courseless', version: '0.1.0' },
      capabilities: { experimentalApi: true, requestAttestation: false }
    })
    this.serverInfo = res as Record<string, unknown>
    this.notify('initialized', {})
    log('app-server', 'initialized', (res as any)?.userAgent ?? '')
  }

  stop(): void {
    this.stopping = true
    const child = this.child
    if (!child) return
    try {
      child.stdin?.end()
    } catch {
      /* ignore */
    }
    try {
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      } else {
        child.kill('SIGTERM')
      }
    } catch {
      /* ignore */
    }
    this.child = null
  }

  private teardown(err: CodexFailure): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
    for (const [, t] of this.turns) {
      if (t.timer) clearTimeout(t.timer)
      if (!t.settled) {
        t.settled = true
        t.reject(t.cancelRequested ? fail('CANCELLED', 'cancelled') : err)
      }
    }
    this.turns.clear()
    this.liveThreads.clear()
    this.child = null
  }

  // ------------------------------------------------------------------ transport

  private send(msg: unknown): void {
    if (!this.child?.stdin?.writable) throw fail('TRANSPORT', 'app-server stdin not writable')
    this.child.stdin.write(JSON.stringify(msg) + '\n')
  }

  request<T = any>(method: string, params: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = this.nextId++
      let timer: NodeJS.Timeout
      try {
        this.send({ jsonrpc: '2.0', id, method, params })
      } catch (e) {
        reject(e as CodexFailure)
        return
      }
      timer = setTimeout(() => {
        this.pending.delete(id)
        reject(fail('TIMEOUT', `${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, { method, resolve, reject, timer })
    })
  }

  notify(method: string, params: unknown): void {
    try {
      this.send({ jsonrpc: '2.0', method, params })
    } catch (e) {
      log('app-server', 'notify failed', method, String((e as CodexFailure)?.message ?? e))
    }
  }

  private onStdout(chunk: string): void {
    this.buf += chunk
    let nl: number
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl).replace(/\r$/, '')
      this.buf = this.buf.slice(nl + 1)
      if (!line.trim()) continue
      let msg: any
      try {
        msg = JSON.parse(line)
      } catch {
        log('app-server', 'unparseable line', line.slice(0, 200))
        continue
      }
      this.dispatch(msg)
    }
  }

  private dispatch(msg: any): void {
    // response to one of our requests
    if (msg.id !== undefined && msg.method === undefined) {
      const p = this.pending.get(msg.id)
      if (!p) return
      clearTimeout(p.timer)
      this.pending.delete(msg.id)
      if (msg.error) p.reject(fail('TURN_FAILED', `${p.method}: ${msg.error.message ?? 'rpc error'}`))
      else p.resolve(msg.result)
      return
    }
    // server -> client request: must be answered or the turn stalls
    if (msg.id !== undefined && msg.method) {
      this.answerServerRequest(msg)
      return
    }
    // notification
    if (msg.method) this.onNotification(msg.method, msg.params ?? {})
  }

  private answerServerRequest(msg: any): void {
    const m: string = msg.method
    log('app-server', 'server request', m)
    let result: unknown
    if (m === 'execCommandApproval' || m === 'applyPatchApproval') {
      result = { decision: 'abort' }
    } else if (m.endsWith('/requestApproval')) {
      result = { decision: 'decline' }
    } else if (m === 'mcpServer/elicitation/request') {
      result = { action: 'decline' }
    } else {
      try {
        this.send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'unsupported by courseless' } })
      } catch {
        /* ignore */
      }
      return
    }
    try {
      this.send({ jsonrpc: '2.0', id: msg.id, result })
    } catch {
      /* ignore */
    }
  }

  private onNotification(method: string, params: any): void {
    const threadId: string | undefined = params?.threadId
    const ctx = threadId ? this.turns.get(threadId) : undefined

    switch (method) {
      case 'item/agentMessage/delta': {
        const d: string = params?.delta ?? ''
        if (ctx && d) {
          ctx.deltaText += d
          ctx.onDelta?.(d)
        }
        return
      }
      case 'item/completed': {
        const item = params?.item
        if (ctx && item?.type === 'agentMessage' && typeof item.text === 'string') {
          ctx.lastMessage = item.text
        }
        return
      }
      case 'turn/completed': {
        if (!ctx) return
        const status: string = params?.turn?.status ?? 'completed'
        const errMsg: string | undefined = params?.turn?.error?.message
        if (status === 'completed') this.settleTurn(ctx, null)
        else if (status === 'interrupted') this.settleTurn(ctx, fail('CANCELLED', 'turn interrupted'))
        else this.settleTurn(ctx, fail('TURN_FAILED', errMsg ?? `turn ${status}`))
        return
      }
      case 'turn/failed': {
        // not in the 0.146.0 notification enum (failure arrives via turn/completed status),
        // handled defensively in case a future release splits it out.
        if (!ctx) return
        this.settleTurn(ctx, fail('TURN_FAILED', params?.error?.message ?? 'turn failed'))
        return
      }
      case 'error': {
        const willRetry = params?.willRetry !== false
        const message: string = params?.error?.message ?? params?.message ?? 'unknown error'
        log('app-server', 'error notification', `willRetry=${willRetry}`, message.slice(0, 300))
        this.emit('warning', message)
        if (ctx && !willRetry) this.settleTurn(ctx, fail('TURN_FAILED', message))
        return
      }
      case 'account/rateLimits/updated': {
        const snap = params?.rateLimits
        const primary = snap?.primary
        const info: RateLimitInfo | null = primary
          ? {
              usedPercent: primary.usedPercent,
              windowDurationMins: primary.windowDurationMins,
              resetsAt: primary.resetsAt ?? null
            }
          : null
        this.emit('rateLimits', info, snap)
        return
      }
      case 'thread/started': {
        if (params?.threadId) this.liveThreads.add(params.threadId)
        return
      }
      default:
        return
    }
  }

  private settleTurn(ctx: TurnCtx, err: CodexFailure | null): void {
    if (ctx.settled) return
    ctx.settled = true
    if (ctx.timer) clearTimeout(ctx.timer)
    this.turns.delete(ctx.threadId)
    if (err) ctx.reject(err)
    else ctx.resolve(ctx.lastMessage ?? ctx.deltaText)
  }

  // ------------------------------------------------------------------ high level

  async startThread(opts: { cwd?: string; ephemeral?: boolean; model?: string | null } = {}): Promise<StartedThread> {
    await this.ensureStarted()
    const params: Record<string, unknown> = {
      cwd: opts.cwd ?? this.workDir,
      sandbox: 'read-only',
      approvalPolicy: 'never'
    }
    if (opts.ephemeral) params.ephemeral = true
    if (opts.model) params.model = opts.model
    const res = await this.request<any>('thread/start', params)
    const threadId: string = res?.thread?.id
    if (!threadId) throw fail('TRANSPORT', 'thread/start returned no thread id')
    if (res?.model) this.model = res.model
    if (!opts.ephemeral) this.liveThreads.add(threadId)
    log('app-server', 'thread/start', threadId, 'model=' + (res?.model ?? '?'))
    return { threadId, model: res?.model ?? null }
  }

  async resumeThread(threadId: string, cwd?: string): Promise<StartedThread> {
    await this.ensureStarted()
    const res = await this.request<any>('thread/resume', {
      threadId,
      cwd: cwd ?? this.workDir,
      sandbox: 'read-only',
      approvalPolicy: 'never'
    })
    const id: string = res?.thread?.id ?? threadId
    if (res?.model) this.model = res.model
    this.liveThreads.add(id)
    log('app-server', 'thread/resume', id)
    return { threadId: id, model: res?.model ?? null }
  }

  /** Runs one turn on a thread and resolves with the final assistant text. */
  async runTurn(
    threadId: string,
    text: string,
    opts: { onDelta?: (d: string) => void; timeoutMs?: number } = {}
  ): Promise<string> {
    await this.ensureStarted()
    if (this.turns.has(threadId)) throw fail('TRANSPORT', 'a turn is already running on this thread')

    const timeoutMs = opts.timeoutMs ?? TURN_TIMEOUT_MS
    let ctx!: TurnCtx
    const promise = new Promise<string>((resolve, reject) => {
      ctx = {
        threadId,
        turnId: null,
        deltaText: '',
        lastMessage: null,
        onDelta: opts.onDelta,
        settled: false,
        timer: null,
        cancelRequested: false,
        resolve,
        reject
      }
    })
    this.turns.set(threadId, ctx)
    ctx.timer = setTimeout(() => {
      ctx.cancelRequested = true
      void this.interrupt(threadId).catch(() => undefined)
      this.settleTurn(ctx, fail('TIMEOUT', `no turn completion in ${timeoutMs}ms`))
    }, timeoutMs)

    try {
      const res = await this.request<any>('turn/start', {
        threadId,
        input: [{ type: 'text', text, text_elements: [] }]
      })
      ctx.turnId = res?.turn?.id ?? null
      // A turn can already be terminal by the time the response lands (fast failures).
      const status: string | undefined = res?.turn?.status
      if (status === 'failed') {
        this.settleTurn(ctx, fail('TURN_FAILED', res?.turn?.error?.message ?? 'turn failed'))
      }
    } catch (e) {
      this.settleTurn(ctx, (e as CodexFailure)?.kind ? (e as CodexFailure) : fail('TRANSPORT', String(e)))
    }

    return promise
  }

  async interrupt(threadId: string): Promise<void> {
    const ctx = this.turns.get(threadId)
    if (!ctx) return
    ctx.cancelRequested = true
    if (!ctx.turnId) {
      this.settleTurn(ctx, fail('CANCELLED', 'cancelled before turn started'))
      return
    }
    try {
      await this.request('turn/interrupt', { threadId, turnId: ctx.turnId }, 10_000)
      // turn/completed with status "interrupted" settles the turn; belt-and-braces below.
      setTimeout(() => {
        const still = this.turns.get(threadId)
        if (still && still === ctx) this.settleTurn(ctx, fail('CANCELLED', 'cancelled'))
      }, 3000)
    } catch (e) {
      this.settleTurn(ctx, fail('CANCELLED', 'cancelled'))
      log('app-server', 'interrupt failed', String((e as CodexFailure)?.message ?? e))
    }
  }
}
