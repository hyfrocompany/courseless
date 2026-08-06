import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

let logFile: string | null = null

export function initLog(file: string): void {
  logFile = file
  try {
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, `\n===== courseless start ${new Date().toISOString()} =====\n`)
  } catch {
    /* logging must never crash the app */
  }
}

export function getLogPath(): string | null {
  return logFile
}

export function log(scope: string, ...parts: unknown[]): void {
  const line = `[${new Date().toISOString()}] [${scope}] ${parts
    .map((p) => (typeof p === 'string' ? p : safeJson(p)))
    .join(' ')}`
  // eslint-disable-next-line no-console
  console.log(line)
  if (!logFile) return
  try {
    appendFileSync(logFile, line + '\n')
  } catch {
    /* ignore */
  }
}

function safeJson(v: unknown): string {
  try {
    const s = JSON.stringify(v)
    return s === undefined ? String(v) : s.length > 4000 ? s.slice(0, 4000) + '…' : s
  } catch {
    return String(v)
  }
}
