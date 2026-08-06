// Fallback transport: one `codex exec` process per turn (JSONL on stdout, whole messages only).
//
// Verified command lines (research/codex-integration.md §8):
//   codex.exe exec --json --sandbox read-only --skip-git-repo-check --ignore-user-config -C <dir> "<prompt>"
//   codex.exe exec resume <thread_id> --json --skip-git-repo-check --ignore-user-config "<prompt>"
// `resume` accepts neither -C nor -s: the working dir MUST come from the spawn cwd option.

import { spawn } from 'node:child_process'
import type { CodexFailure } from '../../../shared/types'
import { log } from '../../util/log'

export const EXEC_TIMEOUT_MS = 120_000

export interface ExecTurnOptions {
  exePath: string
  prompt: string
  workDir: string
  threadId?: string | null
  model?: string | null
  timeoutMs?: number
  onThread?: (threadId: string) => void
  onMessage?: (text: string) => void
  onWarning?: (text: string) => void
}

export interface ExecTurnResult {
  threadId: string | null
  text: string
}

export interface ExecTurnHandle {
  promise: Promise<ExecTurnResult>
  cancel(): void
}

/** turn.failed.error.message is often a JSON *string* wrapping {status, error:{message}}. */
export function classifyTurnFailure(message: string): CodexFailure {
  let status: number | null = null
  let msg = message
  try {
    const inner = JSON.parse(message)
    status = inner?.status ?? null
    msg = inner?.error?.message ?? message
  } catch {
    /* plain string message */
  }
  if (status === 401 || /401 Unauthorized/.test(message))
    return { kind: 'NOT_LOGGED_IN', message: msg }
  if (status === 429) return { kind: 'TURN_FAILED', message: `rate limited: ${msg}` }
  return { kind: 'TURN_FAILED', message: msg }
}

export function runExecTurn(opts: ExecTurnOptions): ExecTurnHandle {
  const timeoutMs = opts.timeoutMs ?? EXEC_TIMEOUT_MS
  const args = opts.threadId
    ? ['exec', 'resume', opts.threadId, '--json', '--skip-git-repo-check', '--ignore-user-config']
    : [
        'exec',
        '--json',
        '--sandbox',
        'read-only',
        '--skip-git-repo-check',
        '--ignore-user-config',
        '-C',
        opts.workDir
      ]
  if (opts.model) args.push('-m', opts.model)
  args.push(opts.prompt)

  let cancelled = false
  let failure: CodexFailure | null = null
  let threadId: string | null = opts.threadId ?? null
  let finalText = ''
  let stderrBuf = ''
  let settled = false

  const child = spawn(opts.exePath, args, {
    cwd: opts.workDir, // REQUIRED for resume (no -C flag there)
    stdio: ['ignore', 'pipe', 'pipe'], // CRITICAL: stdin closed or codex hangs forever
    windowsHide: true
  })

  function killTree(): void {
    if (child.exitCode !== null) return
    try {
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      } else {
        child.kill('SIGTERM')
      }
    } catch {
      /* ignore */
    }
  }

  const timer = setTimeout(() => {
    failure = { kind: 'TIMEOUT', message: `no completion in ${timeoutMs}ms` }
    killTree()
  }, timeoutMs)

  const promise = new Promise<ExecTurnResult>((resolve, reject) => {
    let buf = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      buf += chunk
      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, '')
        buf = buf.slice(nl + 1)
        if (!line.trim()) continue
        let evt: any
        try {
          evt = JSON.parse(line)
        } catch {
          continue // a bad line must never kill the stream
        }
        switch (evt.type) {
          case 'thread.started':
            threadId = evt.thread_id
            if (threadId) opts.onThread?.(threadId)
            break
          case 'item.completed':
            if (evt.item?.type === 'agent_message') {
              finalText = evt.item.text ?? ''
              opts.onMessage?.(finalText)
            } else if (evt.item?.type === 'error') {
              opts.onWarning?.(evt.item.message ?? '')
            }
            break
          case 'turn.failed':
            failure = classifyTurnFailure(evt.error?.message ?? 'unknown failure')
            break
          case 'error':
            opts.onWarning?.(evt.message ?? '')
            break
          default:
            break
        }
      }
    })

    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (d: string) => {
      stderrBuf += d
    }) // NEVER treat stderr as failure

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject({ kind: 'NOT_INSTALLED', message: `failed to spawn codex: ${String(err)}` } as CodexFailure)
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      log('codex/exec', `close code=${code} thread=${threadId ?? '-'} textLen=${finalText.length}`)
      if (cancelled) return reject({ kind: 'CANCELLED', message: 'cancelled by user' } as CodexFailure)
      if (failure) return reject(failure)
      if (code === 2)
        return reject({ kind: 'UNKNOWN', message: `bad usage: ${stderrBuf.trim().slice(0, 400)}` } as CodexFailure)
      if (code !== 0)
        return reject({
          kind: 'TURN_FAILED',
          message: `codex exited ${code}: ${stderrBuf.trim().slice(0, 400)}`
        } as CodexFailure)
      resolve({ threadId, text: finalText })
    })
  })

  return {
    promise,
    cancel(): void {
      cancelled = true
      killTree()
    }
  }
}
