// PointService — turn "the Insert tab" into an exact pair of screen coordinates, or admit it
// could not.
//
// THE ACCURACY CONTRACT (owner directive; this file is where it is enforced)
// There are exactly three allowed outcomes:
//   1. `point`      a VERIFIED location
//   2. `miss`       "couldn't spot it — it should be: <where>"
//   3. `wrong-app`  "open <tool> first"
// Pointing at the wrong place is a hard failure, worse than not pointing at all. So:
//   * UIA hits are exact by construction (rect straight from the OS a11y tree) but are scoped to
//     the right window: a name match in an unrelated window is rejected (`acceptable()`).
//   * Vision hits are model CLAIMS. Every one is self-verified with a second look at a crop of
//     the SAME screenshot before it is allowed on screen — unless UIA already corroborated it.
//   * If nothing on screen belongs to the lesson's tool and the target is not a shell surface,
//     we say "open <tool> first" rather than hunting an unrelated screen.
//
// Electron-free: paths and the display metric are injected, exactly like CodexService.

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { PointRequest, PointResult } from '../../shared/types'
import { log } from '../util/log'

// ---------------------------------------------------------------- helpers

/** One match out of uia-find.ps1. The last four fields only appear in `from-point` mode. */
export interface UiaMatch {
  x: number
  y: number
  left: number
  top: number
  w: number
  h: number
  name: string
  controlType: string
  exact: boolean
  how: string
  windowHwnd: number
  windowTitle: string
  process: string
  pid: number
  self: boolean
  /** from-point only: named ancestors, nearest first (PowerShell may collapse a 1-item array). */
  ancestors?: string[] | string
  automationId?: string
  className?: string
  /** from-point only: the pixel that was hit-tested (the cursor, when no -X/-Y was given). */
  pointX?: number
  pointY?: number
}

interface UiaResult {
  ok: boolean
  mode: string
  ms: number
  foreground: { hwnd: number; title: string; class: string; process: string; pid: number; self: boolean } | null
  windows: { hwnd: number; title: string; class: string; process: string; pid: number; how: string; self: boolean }[]
  matches: UiaMatch[]
  error?: string
}

/** PowerShell's ConvertTo-Json collapses one-element arrays into objects. Undo that. */
function arr<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[]
  if (v && typeof v === 'object') return [v as T]
  return []
}

function words(s: string): string[] {
  return (s || '')
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((w) => w.length >= 3)
}

const STOP = new Set([
  'the',
  'and',
  'for',
  'your',
  'with',
  'from',
  'into',
  'this',
  'that',
  'you',
  'button',
  'menu',
  'window',
  'panel',
  'click',
  'open',
  'select',
  'app',
  'application'
])

/** Shell surfaces are always present, so "the app isn't open" never applies to them. */
const SHELL_RE = /\b(start menu|start button|taskbar|task bar|system tray|notification area|desktop|file explorer|windows explorer|search box|search bar|run dialog|start\b)/i

/**
 * Steps that are about TYPING have no element to point at. "Run git init at the PowerShell
 * command prompt" names a place, not a control, and mining a word out of it ("PowerShell") is
 * how a pointer ends up on a line of scrollback text in an unrelated terminal. Recognise these
 * and decline: an honest "nothing to point at here" beats an arrow over prose.
 */
const TYPING_RE =
  /\b(command prompt|terminal window|type\b|typing|paste|press enter|run the command|at the prompt|command line|keyboard shortcut|shortcut)\b/i

/** Control types that are never "the thing you click". Matching prose is the classic wrong point. */
const PROSE_TYPES = new Set(['Text', 'Document', 'Separator', 'Thumb', 'ScrollBar', 'TitleBar', 'StatusBar'])

/**
 * Pre-B4 lessons have no `target`. Mine the most element-like phrase out of `where` — a quoted
 * phrase, then a Title Case run — and return '' rather than guess when the step is not about a
 * control at all.
 */
export function deriveTarget(where: string, action: string): string {
  const src = `${where} ${action}`
  const quoted = src.match(/["“”'']([^"“”'']{2,44})["“”'']/)
  if (quoted) return quoted[1].trim()
  if (TYPING_RE.test(src)) return ''
  // "Insert tab", "PivotTable Fields pane", "Current Repository dropdown"
  const title = (where || '').match(/\b([A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){0,3})\b/)
  if (title && title[1].length >= 3 && !/^(The|A|An|You|Your|In|On|At|Top|Left|Right)$/.test(title[1]))
    return title[1].trim()
  return ''
}

export interface PointServiceOptions {
  /** Directory holding uia-find.ps1 / screen-shot.ps1 (dev: <root>/resources). */
  resourcesDir: string
  /** Scratch dir for the throwaway screenshots. Emptied after every call. */
  tempDir: string
  /** Absolute path to codex(.exe) — reused from CodexService's resolver. */
  codexExe(): string | null
  /** Our own process ids, so "the window behind Courseless" can be found. */
  selfPids(): number[]
  /** Window handles that must never be searched — the pointer overlay above all. */
  skipHwnds?(): number[]
}

const UIA_TIMEOUT_MS = 4_000
const SHOT_TIMEOUT_MS = 8_000
const VISION_TIMEOUT_MS = 30_000
const CACHE_MS = 30_000
/** Windows move. A capture older than this cannot be trusted for a second look. */
const STALE_MS = 3_000

export class PointService {
  private opts: PointServiceOptions
  private cache = new Map<string, { at: number; fgHwnd: number; result: PointResult }>()

  constructor(opts: PointServiceOptions) {
    this.opts = opts
    try {
      mkdirSync(opts.tempDir, { recursive: true })
    } catch {
      /* ignore */
    }
  }

  // ---------------------------------------------------------------- process plumbing

  private runPs(script: string, args: string[], timeoutMs: number): Promise<string> {
    return new Promise((resolve) => {
      let out = ''
      let err = ''
      let done = false
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(this.opts.resourcesDir, script), ...args],
        { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
      )
      const finish = (): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        if (err.trim()) log('point', `${script} stderr`, err.trim().slice(0, 300))
        resolve(out)
      }
      const timer = setTimeout(() => {
        if (done) return
        log('point', `${script} timed out after ${timeoutMs}ms — killing`)
        try {
          if (child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
        } catch {
          /* ignore */
        }
        finish()
      }, timeoutMs)
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (d) => (out += d))
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (d) => (err += d))
      child.on('error', (e) => {
        err += String(e)
        finish()
      })
      child.on('close', finish)
    })
  }

  private async ps<T>(script: string, args: string[], timeoutMs: number): Promise<T | null> {
    const raw = await this.runPs(script, args, timeoutMs)
    const line = raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('{'))
      .pop()
    if (!line) return null
    try {
      return JSON.parse(line) as T
    } catch (e) {
      log('point', `${script} unparseable output`, String(e).slice(0, 160), raw.slice(0, 200))
      return null
    }
  }

  // ---------------------------------------------------------------- UIA

  private skipArgs(): string[] {
    const skip = this.opts.skipHwnds?.() ?? []
    return skip.length ? ['-ExcludeHwnd', skip.join(',')] : []
  }

  private async uiaFind(name: string, hint: string, msaa: 'auto' | 'only' = 'auto'): Promise<UiaResult | null> {
    const res = await this.ps<UiaResult>(
      'uia-find.ps1',
      [
        '-Mode',
        'name',
        '-Name',
        name,
        '-WindowHint',
        hint || '',
        '-ExcludePid',
        this.opts.selfPids().join(','),
        ...this.skipArgs(),
        '-Msaa',
        msaa,
        '-Max',
        '10'
      ],
      msaa === 'only' ? UIA_TIMEOUT_MS + 2_000 : UIA_TIMEOUT_MS
    )
    if (!res) return null
    res.matches = arr<UiaMatch>(res.matches)
    res.windows = arr(res.windows)
    return res
  }

  /** Foreground window right now — used to drop a point the learner has navigated away from. */
  async foreground(): Promise<{ hwnd: number; title: string; process: string; self: boolean } | null> {
    const res = await this.ps<UiaResult>(
      'uia-find.ps1',
      ['-Mode', 'windows', '-ExcludePid', this.opts.selfPids().join(','), ...this.skipArgs()],
      UIA_TIMEOUT_MS
    )
    return res?.foreground ?? null
  }

  /** The element under a point — B5's recorder marks. Exposed here so B5 has no new plumbing. */
  async elementFromPoint(x?: number, y?: number): Promise<UiaMatch | null> {
    const args = ['-Mode', 'from-point', '-ExcludePid', this.opts.selfPids().join(','), ...this.skipArgs()]
    if (typeof x === 'number' && typeof y === 'number') args.push('-X', String(Math.round(x)), '-Y', String(Math.round(y)))
    const res = await this.ps<UiaResult>('uia-find.ps1', args, UIA_TIMEOUT_MS)
    return res ? (arr<UiaMatch>(res.matches)[0] ?? null) : null
  }

  /**
   * The wrong-window rejection. A match may only be shown when it belongs to a window that has a
   * plausible claim on the lesson's tool: it matched the hint, it is the app behind us, it is the
   * shell (for shell targets), or it is Courseless itself when Courseless IS the tool.
   */
  private acceptable(m: UiaMatch, hintTokens: string[], shellTarget: boolean, selfIsTool: boolean, query: string): boolean {
    // A line of prose that happens to contain the words is not the thing the learner clicks.
    // This is the rule that stops the pointer landing on terminal scrollback that reads
    // "Windows PowerShell" when the step said "at the PowerShell command prompt".
    if (PROSE_TYPES.has(m.controlType)) return false
    // Nor is a container far larger than the label it holds: a whole pane named after its
    // heading is not a target either.
    // ...nor a sentence. Accessible names legitimately carry status ("Action Center, 27 new
    // notifications"), so the test is prose-shaped LENGTH in words, not characters.
    const name = (m.name || '').trim()
    if (!m.exact && name.split(/\s+/).length > 12) return false
    const how = m.how.split('/')[0]
    if (m.self) return selfIsTool
    if (how === 'hint') return true
    if (how === 'taskbar') return shellTarget
    if (how === 'foreground' || how === 'behind') {
      // The foreground app is where the learner is working. Accept it unless the lesson named a
      // tool this window plainly is not.
      if (hintTokens.length === 0) return true
      const hay = `${m.windowTitle} ${m.process}`.toLowerCase()
      if (hintTokens.some((t) => hay.includes(t))) return true
      // Foreground with no hint agreement: still acceptable for an EXACT name hit (the learner is
      // looking right at it), never for a loose contains match.
      return m.exact
    }
    return false
  }

  private rank(m: UiaMatch, hintTokens: string[]): number {
    const how = m.how.split('/')[0]
    let s = 0
    if (m.exact) s += 100
    if (how === 'hint') s += 60
    else if (how === 'foreground') s += 50
    else if (how === 'behind') s += 40
    else if (how === 'taskbar') s += 30
    const hay = `${m.windowTitle} ${m.process}`.toLowerCase()
    if (hintTokens.some((t) => hay.includes(t))) s += 25
    if (m.self) s -= 200
    // Size is a shape test, not a "smaller is better" gradient.
    //
    // Two things carry the same name for different reasons: a PANE named after the heading it
    // contains (too big to be a target) and a bare ICON of the same command (too small to be the
    // one a step describes). File Explorer has both "New folder" buttons — a 22x24 glyph in the
    // title bar and the 42x66 labelled button on the ribbon — and a step that says "on the Home
    // tab of the ribbon" means the second one. A monotonic penalty on area always picked the
    // glyph.
    const area = Math.max(1, m.w * m.h)
    if (area > 60_000) s -= Math.min(30, Math.log2(area / 60_000) * 8)
    else if (area < 900) s -= 6
    return s
  }

  // ---------------------------------------------------------------- vision

  /**
   * The whole virtual desktop, physical pixels. `x/y` is the origin: on a machine with a monitor
   * to the LEFT of the primary it is negative, and screenshot pixel (0,0) is screen pixel (x,y).
   */
  private async capture(): Promise<{ path: string; w: number; h: number; x: number; y: number } | null> {
    const path = join(this.opts.tempDir, `shot-${randomUUID()}.png`)
    const res = await this.ps<{ ok: boolean; path: string; w: number; h: number; x: number; y: number }>(
      'screen-shot.ps1',
      ['-Mode', 'capture', '-Path', path],
      SHOT_TIMEOUT_MS
    )
    if (!res?.ok) return null
    return { path: res.path, w: res.w, h: res.h, x: res.x ?? 0, y: res.y ?? 0 }
  }

  private async crop(input: string, x: number, y: number, w: number, h: number): Promise<string | null> {
    const path = join(this.opts.tempDir, `crop-${randomUUID()}.png`)
    const res = await this.ps<{ ok: boolean; path: string }>(
      'screen-shot.ps1',
      [
        '-Mode',
        'crop',
        '-In',
        input,
        '-Path',
        path,
        '-X',
        String(Math.round(x)),
        '-Y',
        String(Math.round(y)),
        '-W',
        String(Math.round(w)),
        '-H',
        String(Math.round(h))
      ],
      SHOT_TIMEOUT_MS
    )
    return res?.ok ? res.path : null
  }

  /** One `codex exec -i <png>` turn, read-only, own timeout, stdin closed. Returns the reply. */
  private askVision(imagePath: string, prompt: string): Promise<string> {
    const exe = this.opts.codexExe()
    if (!exe) return Promise.resolve('')
    return new Promise((resolve) => {
      let out = ''
      let done = false
      const child = spawn(
        exe,
        [
          'exec',
          '-i',
          imagePath,
          '--json',
          '--sandbox',
          'read-only',
          '--skip-git-repo-check',
          '-c',
          'model_reasoning_effort=low',
          prompt
        ],
        { cwd: this.opts.tempDir, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
      )
      const finish = (): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve(out)
      }
      const timer = setTimeout(() => {
        if (done) return
        log('point', 'vision call timed out — killing')
        try {
          if (child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
        } catch {
          /* ignore */
        }
        finish()
      }, VISION_TIMEOUT_MS)
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (d) => (out += d))
      child.on('error', finish)
      child.on('close', finish)
    })
  }

  /** Pull the agent's final message out of the exec JSONL stream. */
  private static agentMessage(jsonl: string): string {
    let text = ''
    for (const line of jsonl.split('\n')) {
      const t = line.trim()
      if (!t.startsWith('{')) continue
      try {
        const o = JSON.parse(t)
        const item = o?.item ?? o?.msg ?? o
        if (item?.type === 'agent_message' && typeof item.text === 'string') text = item.text
        else if (o?.type === 'item.completed' && item?.text && item?.item_type === 'agent_message') text = item.text
      } catch {
        /* partial line */
      }
    }
    return text
  }

  private static json(raw: string): any {
    if (!raw) return null
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
    const body = fenced ? fenced[1] : raw
    const start = body.indexOf('{')
    const end = body.lastIndexOf('}')
    if (start === -1 || end <= start) return null
    try {
      return JSON.parse(body.slice(start, end + 1))
    } catch {
      return null
    }
  }

  // ---------------------------------------------------------------- the operation

  async ground(req: PointRequest): Promise<PointResult> {
    const t0 = Date.now()
    const query = (req.target || '').trim() || deriveTarget(req.where, req.action)
    const hintTokens = words(req.tool).filter((w) => !STOP.has(w))
    const shellTarget = SHELL_RE.test(`${query} ${req.where} ${req.action}`)
    const selfIsTool = /courseless/i.test(req.tool)
    const key = `${req.lessonId}:${req.stepIndex}`

    // ---- 0. is there anything to point AT?
    // Typing steps, "read the output" steps and anything else without a control are answered
    // honestly instead of being made to fit. This is the difference between a pointer you can
    // trust and one that lands on whatever word it recognised.
    if (!query) {
      const res: PointResult = { outcome: 'miss', where: req.where, tried: '', ms: Date.now() - t0 }
      log('point', 'nothing pointable in this step', req.where.slice(0, 80))
      return res
    }

    // ---- 1. UIA
    const uia = await this.uiaFind(query, req.tool)
    const fg = uia?.foreground
    const fgLabel = fg ? fg.title || fg.process : 'nothing'

    // cache: same step, same foreground window, still fresh
    if (!req.fresh) {
      const hit = this.cache.get(key)
      if (hit && Date.now() - hit.at < CACHE_MS && hit.fgHwnd === (fg?.hwnd ?? 0)) {
        log('point', 'cache hit', key, hit.result.outcome)
        return hit.result
      }
    }

    const remember = (result: PointResult): PointResult => {
      this.cache.set(key, { at: Date.now(), fgHwnd: fg?.hwnd ?? 0, result })
      const base = { method: 'method' in result ? result.method : result.outcome, target: query, ms: result.ms }
      log(
        'point',
        'result',
        JSON.stringify(
          result.outcome === 'point'
            ? { ...base, x: result.x, y: result.y, verified: result.verified, matched: result.matched }
            : { ...base, outcome: result.outcome }
        )
      )
      return result
    }

    if (uia?.error) log('point', 'uia error', uia.error.slice(0, 200))

    const usable = (matches: UiaMatch[]): UiaMatch[] => {
      const seen = new Set<string>()
      return matches
        .filter((m) => {
          const k = `${m.windowHwnd}:${m.left},${m.top},${m.w},${m.h}`
          if (seen.has(k)) return false
          seen.add(k)
          return true
        })
        .filter((m) => this.acceptable(m, hintTokens, shellTarget, selfIsTool, query))
        .sort((a, b) => this.rank(b, hintTokens) - this.rank(a, hintTokens))
    }

    let candidates = usable(uia?.matches ?? [])

    // ---- 1b. the older accessibility tree
    //
    // UIA can find matches that are all unusable and, by finding them, stop looking. The case
    // that forced this: the runner shows the step's own words, so searching for "New folder"
    // hits the SENTENCE "Click New folder on the Home tab" in OUR window, and the button in
    // Explorer's ribbon — which managed UIA cannot see at all — is never reached.
    //
    // So when nothing survived the filter, ask again through MSAA before giving up. It costs one
    // short-lived process; the alternative (vision) costs two engine calls and ~8 seconds.
    //
    // Only worth doing when UIA returned something and we rejected all of it: if it returned
    // nothing, the first pass already swept MSAA on its own, and repeating it would double the
    // cost of every honest miss.
    if (candidates.length === 0 && query && (uia?.matches.length ?? 0) > 0) {
      const deep = await this.uiaFind(query, req.tool, 'only')
      const deepCandidates = usable(deep?.matches ?? [])
      if (deepCandidates.length > 0) {
        log('point', 'msaa found what uia could not', deepCandidates[0].name, deepCandidates[0].how)
        candidates = deepCandidates
      }
    }

    if (candidates.length > 0) {
      const m = candidates[0]
      return remember({
        outcome: 'point',
        x: m.x,
        y: m.y,
        label: req.action || query,
        method: 'uia',
        verified: true,
        matched: `${m.name} (${m.controlType}) in ${m.windowTitle || m.process}`,
        windowHwnd: m.windowHwnd,
        ms: Date.now() - t0
      })
    }

    // ---- 2. foreground sanity — never hunt an unrelated screen
    const anyToolWindow =
      hintTokens.length === 0 ||
      (uia?.windows ?? []).some((w) => {
        if (w.self && !selfIsTool) return false
        const hay = `${w.title} ${w.process}`.toLowerCase()
        return hintTokens.some((t) => hay.includes(t))
      })
    if (!anyToolWindow && !shellTarget) {
      return remember({ outcome: 'wrong-app', tool: req.tool, foreground: fgLabel, ms: Date.now() - t0 })
    }

    // ---- 3. vision
    if (!this.opts.codexExe()) {
      return remember({ outcome: 'miss', where: req.where, tried: query, ms: Date.now() - t0 })
    }
    const shot = await this.capture()
    if (!shot) {
      return remember({ outcome: 'error', message: 'Could not capture the screen.', ms: Date.now() - t0 })
    }
    const shotAt = Date.now()
    const files = [shot.path]
    try {
      const monitors = shot.w > 2200 ? ' It spans more than one monitor side by side.' : ''
      const prompt = [
        `This is a ${shot.w}x${shot.h} screenshot of a Windows desktop.${monitors}`,
        `Find the on-screen element: "${query}".`,
        `Context: the learner is using ${req.tool || 'this app'} and the current step is "${req.action}".`,
        `It should be at: ${req.where}.`,
        'Reply with ONLY this JSON object and nothing else:',
        '{"x": <integer pixel>, "y": <integer pixel>, "confidence": <0 to 1>}',
        'x,y is the CENTRE of that element in screenshot pixel coordinates, origin top-left.',
        'If the element is not visible in this screenshot, reply {"x":-1,"y":-1,"confidence":0}.'
      ].join('\n')
      const reply = PointService.agentMessage(await this.askVision(shot.path, prompt))
      const obj = PointService.json(reply)
      const x = Number(obj?.x)
      const y = Number(obj?.y)
      const confidence = Number(obj?.confidence)
      log('point', 'vision', JSON.stringify({ query, x, y, confidence, replyLen: reply.length }))

      const inBounds = Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x < shot.w && y < shot.h
      if (!inBounds || !Number.isFinite(confidence) || confidence < 0.4) {
        return remember({ outcome: 'miss', where: req.where, tried: query, ms: Date.now() - t0 })
      }

      // Vision answers in SCREENSHOT pixels; everything else in this file is SCREEN pixels.
      const screenX = x + shot.x
      const screenY = y + shot.y

      // Self-verification. A model claim is not evidence — look again at a crop before showing it.
      // Skipped only when UIA corroborated the same spot in the same window (spec §accuracy).
      const corroborated =
        confidence >= 0.85 &&
        (uia?.matches ?? []).some((m) => Math.abs(m.x - screenX) <= 120 && Math.abs(m.y - screenY) <= 120)
      if (!corroborated) {
        // The crop MUST come from the same capture — that is what makes the second look a check
        // on the first answer rather than a new question. (An earlier version aged out the
        // capture here, which made verification impossible: the engine call itself takes ~5s.)
        const cw = 240
        const ch = 180
        const cropPath = await this.crop(shot.path, x - cw / 2, y - ch / 2, cw, ch)
        if (!cropPath) {
          return remember({ outcome: 'miss', where: req.where, tried: query, ms: Date.now() - t0 })
        }
        files.push(cropPath)
        const verifyPrompt = [
          `This is a ${cw}x${ch} crop taken from a Windows screen, centred on a candidate location.`,
          `Does this crop contain the element "${query}" (context: ${req.tool || 'a desktop app'})?`,
          'Reply with ONLY this JSON object: {"match": true} or {"match": false}.'
        ].join('\n')
        const vReply = PointService.agentMessage(await this.askVision(cropPath, verifyPrompt))
        const vObj = PointService.json(vReply)
        const match = vObj?.match === true || vObj?.match === 'true'
        log('point', 'vision verify', JSON.stringify({ query, match, replyLen: vReply.length }))
        if (!match) {
          return remember({ outcome: 'miss', where: req.where, tried: query, ms: Date.now() - t0 })
        }
      }

      // Stale-screen guard, in the place it actually belongs: a vision round trip takes seconds,
      // and a coordinate read off a screen the learner has since navigated away from is exactly
      // the wrong-place point the contract forbids.
      if (Date.now() - shotAt > STALE_MS) {
        const now = await this.foreground()
        if (now && fg && now.hwnd !== fg.hwnd) {
          log('point', 'foreground changed while reading the screen — honest miss', now.title || now.process)
          return remember({ outcome: 'miss', where: req.where, tried: query, ms: Date.now() - t0 })
        }
      }

      return remember({
        outcome: 'point',
        x: Math.round(screenX),
        y: Math.round(screenY),
        label: req.action || query,
        method: 'vision',
        verified: true,
        matched: `${query} (seen on screen, confidence ${confidence.toFixed(2)}${corroborated ? ', corroborated' : ', crop-checked'})`,
        ms: Date.now() - t0
      })
    } finally {
      // Privacy: the capture existed only for the duration of the engine call.
      for (const f of files) {
        try {
          rmSync(f, { force: true })
        } catch {
          /* ignore */
        }
      }
    }
  }

  clearCache(): void {
    this.cache.clear()
  }
}
