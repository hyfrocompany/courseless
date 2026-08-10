// PointService — turn "the Insert tab" into an exact pair of screen coordinates, or admit it
// could not.
//
// THE ACCURACY CONTRACT (owner directive; this file is where it is enforced)
// There are exactly three allowed outcomes:
//   1. `point`      a VERIFIED location
//   2. `miss`       "couldn't spot it — it should be: <where>"
//   3. `wrong-app`  "open <tool> first"
// Pointing at the wrong place is a hard failure, worse than not pointing at all. So:
//   * Accessibility hits (UIA on Windows, AX on macOS) are exact by construction — the rect comes
//     straight from the OS a11y tree — but are scoped to the right window: a name match in an
//     unrelated window is rejected (`acceptable()`). That scoping covers the SHELL too: the macOS
//     menu bar belongs to the frontmost app, so a menu-bar hit is only allowed when the name
//     matched EXACTLY and the surface belongs to the lesson's tool (or is a genuinely ownerless OS
//     surface, the Dock). Without that rule a step naming TextEdit's "Format" menu lands on
//     "System Informat-ion" in Terminal's menu bar, verified — the exact failure this file exists
//     to prevent.
//   * Vision hits are model CLAIMS. Every one is self-verified with a second look at a crop of
//     the SAME screenshot before it is allowed on screen — unless a11y already corroborated it.
//     The one exception is a second look that never ARRIVES (see VERIFY_BUDGET_MS): a check that
//     timed out is not a check that failed, and throwing away a good first look scores worse than
//     showing it with `verified: false`.
//   * If nothing on screen belongs to the lesson's tool and the target is not a shell surface,
//     we say "open <tool> first" rather than hunting an unrelated screen.
//
// Electron-free: paths and the display metric are injected, exactly like CodexService.
//
// TWO OPERATING SYSTEMS, ONE CONTRACT
// Every OS fact this file needs arrives as one compact line of JSON from a short-lived child
// process, and the two platforms ship a different child:
//   win32   powershell.exe -File resources/uia-find.ps1 | screen-shot.ps1   (UIA + MSAA, physical px)
//   darwin  resources/mac/courseless-ax                                     (AX + ScreenCaptureKit, POINTS)
// The shapes differ in exactly three places — `role` vs `controlType`, `windowId` vs `hwnd`, and
// the `shell` vs `taskbar` how-bucket — so the darwin reply is normalised into the Windows shape
// at the seam (`fromAx`) and NOTHING downstream of `cli()` knows which OS it is on, except:
//   * the `shell`/`taskbar` bucket name (acceptable/rank),
//   * MSAA, which has no macOS equivalent and is skipped,
//   * the screenshot boundary, where darwin points meet screenshot pixels via `scaleFactor`.

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { PointRequest, PointResult } from '../../shared/types'
import { log } from '../util/log'

const IS_DARWIN = process.platform === 'darwin'

/** The `how` prefix a shell surface (taskbar / Dock / menu bar) comes back under. */
const SHELL_HOW = IS_DARWIN ? 'shell' : 'taskbar'

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
  /**
   * darwin name-mode only, and only for prose-shaped roles: the ancestor ROLES, nearest first.
   * A bare AXStaticText is a line of text; the same node inside AXRow/AXOutline is a sidebar row.
   * See `insideListContainer`.
   */
  containers?: string[] | string
  /**
   * darwin name-mode only. True when the rect is NOT the matched element's own — a menu item in a
   * CLOSED menu, wearing the rect of the AXMenuBarItem that opens it. A real sighting outranks it.
   */
  promoted?: boolean
  /** from-point only: the pixel that was hit-tested (the cursor, when no -X/-Y was given). */
  pointX?: number
  pointY?: number
}

/**
 * One match out of courseless-ax. Same fields, two different names: the accessibility API on
 * macOS calls a control type a ROLE ("AXButton") and identifies a window by CGWindowID rather
 * than HWND. There is no automationId and no className — AX has no equivalent of either.
 *
 * Coordinates are POINTS, top-left origin (see PointResult.x).
 */
export interface AxMatch extends Omit<UiaMatch, 'controlType' | 'windowHwnd'> {
  role: string
  windowId: number
}

interface AxWindow {
  windowId: number
  title: string
  process: string
  pid: number
  how: string
  self: boolean
  /** POINTS, top-left origin. Present on darwin; the ps1 does not report window rects. */
  left?: number
  top?: number
  w?: number
  h?: number
}

/**
 * One physical display, in the same coordinate space as everything else on this platform.
 * darwin only: it is the map the vision fallback needs to know which screen to capture.
 */
export interface DisplayInfo {
  id: number
  left: number
  top: number
  w: number
  h: number
  scaleFactor: number
  main: boolean
}

interface UiaResult {
  ok: boolean
  mode: string
  ms: number
  foreground: { hwnd: number; title: string; class: string; process: string; pid: number; self: boolean } | null
  windows: {
    hwnd: number
    title: string
    class: string
    process: string
    pid: number
    how: string
    self: boolean
    left?: number
    top?: number
    w?: number
    h?: number
  }[]
  matches: UiaMatch[]
  /** darwin only: backing scale of the main display, the one bridge between points and pixels. */
  scaleFactor?: number
  /** darwin only: every active display. Empty on win32, where one capture covers them all. */
  displays?: DisplayInfo[]
  error?: string
}

/** darwin -> the Windows shape. role becomes controlType, windowId becomes windowHwnd. */
function fromAx(m: AxMatch): UiaMatch {
  const { role, windowId, ...rest } = m
  return { ...rest, controlType: role ?? '', windowHwnd: windowId ?? 0 }
}

function windowFromAx(w: AxWindow): UiaResult['windows'][number] {
  return {
    hwnd: w.windowId ?? 0,
    title: w.title ?? '',
    class: '',
    process: w.process ?? '',
    pid: w.pid ?? 0,
    how: w.how ?? '',
    self: !!w.self,
    left: w.left,
    top: w.top,
    w: w.w,
    h: w.h
  }
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

/**
 * Prose naming a surface that is on screen whatever is running, so "open <tool> first" does not
 * apply to it. This gates ONLY the wrong-app bail-out — never whether a shell match is allowed
 * (see `acceptable`), because tying candidacy to the step's wording meant rewording a step changed
 * where the arrow landed.
 *
 * darwin note: "the menu bar" is deliberately NOT in this list. macOS's menu bar shows the
 * FRONTMOST app's menus, so a step that says "the Format menu in the menu bar" of an app that is
 * not running is precisely the wrong-app case — treating it as a shell surface is what let a
 * TextEdit step go hunting through Terminal's menus.
 */
const SHELL_RE = IS_DARWIN
  ? /\b(dock|finder|spotlight|control cent(?:re|er)|system settings|system preferences|apple menu|launchpad|mission control|desktop|notification cent(?:re|er))/i
  : /\b(start menu|start button|taskbar|task bar|system tray|notification area|desktop|file explorer|windows explorer|search box|search bar|run dialog|start\b)/i

/**
 * Shell surfaces that belong to no application at all. A match on one of these is judged on its
 * own name, because there is no owning app to check it against. The macOS menu bar is NOT here:
 * it is app-owned (its `process` is the frontmost app), which is exactly what makes the ownership
 * test in `acceptable` work.
 */
const OS_SHELL_OWNER_RE = IS_DARWIN
  ? /^(dock|control cent(?:re|er)|spotlight|notification cent(?:re|er)|window ?server|finder)$/i
  : /^(explorer|shell_?traywnd|searchapp|searchhost|startmenuexperiencehost)$/i

/**
 * Container roles that turn a run of text into a row someone clicks. macOS vocabulary only —
 * win32 never reports `containers`, so this can never widen the Windows filter.
 */
const LIST_CONTAINER_RE = /^(AXRow|AXCell|AXOutline|AXList|AXTable|AXBrowser|AXTabGroup)$/

/**
 * Steps that are about TYPING have no element to point at. "Run git init at the PowerShell
 * command prompt" names a place, not a control, and mining a word out of it ("PowerShell") is
 * how a pointer ends up on a line of scrollback text in an unrelated terminal. Recognise these
 * and decline: an honest "nothing to point at here" beats an arrow over prose.
 */
const TYPING_RE = IS_DARWIN
  ? /\b(terminal|iterm|terminal window|zsh|bash|type\b|typing|paste|press (?:enter|return)|run the command|at the prompt|command line|keyboard shortcut|shortcut)\b/i
  : /\b(command prompt|terminal window|type\b|typing|paste|press enter|run the command|at the prompt|command line|keyboard shortcut|shortcut)\b/i

/**
 * Control types that are never "the thing you click". Matching prose is the classic wrong point.
 * On darwin these are AX roles; the set carries BOTH vocabularies because a mark recorded on one
 * machine can be read on the other and an unknown name must never accidentally pass the filter.
 */
const PROSE_TYPES = new Set(
  IS_DARWIN
    ? [
        'AXStaticText',
        'AXTextArea',
        'AXScrollBar',
        'AXSplitter',
        'AXHeading',
        'AXWebArea',
        'AXToolbar',
        'AXSeparator',
        'AXValueIndicator'
      ]
    : ['Text', 'Document', 'Separator', 'Thumb', 'ScrollBar', 'TitleBar', 'StatusBar']
)

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
  /**
   * Directory holding the OS helpers (dev: <root>/resources).
   *   win32   uia-find.ps1, screen-shot.ps1
   *   darwin  mac/courseless-ax  (one universal binary, every mode)
   */
  resourcesDir: string
  /** Scratch dir for the throwaway screenshots. Emptied after every call. */
  tempDir: string
  /** One look at one screenshot — EngineService.vision. Returns the reply text. */
  vision(imagePath: string, prompt: string): Promise<string>
  /** False when nobody is signed in: the screen is then never captured at all. */
  canVision(): boolean
  /** Our own process ids, so "the window behind Courseless" can be found. */
  selfPids(): number[]
  /**
   * Native window ids that must never be searched — the pointer overlay above all.
   * win32 HWNDs; CGWindowIDs on darwin. Same list, same purpose, different number space.
   */
  skipWindowIds?(): number[]
}

const UIA_TIMEOUT_MS = 4_000
const SHOT_TIMEOUT_MS = 8_000
/**
 * The leash on the SECOND look — the crop check — as opposed to the engine's own 30s bound.
 *
 * Measured: the first look is worth 2.5pt of accuracy. The crop check normally answers in ~5s, but
 * when it stalls it stalls all the way to the engine's 30s ceiling, and the whole call then reports
 * a miss at 34.5s — a good answer thrown away, slowly. So the check gets 12s and one retry, and if
 * BOTH attempts time out the first look is shown with `verified: false` and a matched-string that
 * says so. A check that never arrived is not a check that failed; a check that ANSWERS "no" still
 * kills the point, which is the case the accuracy contract actually cares about.
 */
const VERIFY_BUDGET_MS = 12_000
/** A TCC probe is a couple of syscalls; anything slower is a wedged helper, not a slow answer. */
const PERMISSIONS_TIMEOUT_MS = 3_000
const CACHE_MS = 30_000
/** Windows move. A capture older than this cannot be trusted for a second look. */
const STALE_MS = 3_000

export class PointService {
  private opts: PointServiceOptions
  private cache = new Map<string, { at: number; fgHwnd: number; result: PointResult }>()
  /** Set by the last vision call when it failed for a reason worth reporting. */
  private lastVisionFailure: { kind: string; message: string } | null = null

  constructor(opts: PointServiceOptions) {
    this.opts = opts
    try {
      mkdirSync(opts.tempDir, { recursive: true })
    } catch {
      /* ignore */
    }
  }

  // ---------------------------------------------------------------- process plumbing

  /** darwin: the one compiled helper, every mode. */
  private helperPath(): string {
    return join(this.opts.resourcesDir, 'mac', 'courseless-ax')
  }

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

  /**
   * darwin's half of runPs. Same contract — one line of JSON, a hard deadline, never throws.
   *
   * `detached: true` puts the helper in its own process group so the timeout can SIGKILL the
   * GROUP: the AX side of the helper can block for seconds inside an unresponsive app (App Nap),
   * and killing only the leader would leave that work running. SIGKILL rather than SIGTERM for
   * the same reason a wedged process cannot be asked politely — it is exactly the taskkill /T /F
   * this replaces.
   */
  private runHelper(label: string, args: string[], timeoutMs: number): Promise<string> {
    return new Promise((resolve) => {
      let out = ''
      let err = ''
      let done = false
      const child = spawn(this.helperPath(), args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true })
      const finish = (): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        if (err.trim()) log('point', `${label} stderr`, err.trim().slice(0, 300))
        resolve(out)
      }
      const timer = setTimeout(() => {
        if (done) return
        log('point', `${label} timed out after ${timeoutMs}ms — killing`)
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL')
        } catch {
          try {
            child.kill('SIGKILL')
          } catch {
            /* ignore */
          }
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

  /**
   * Run the platform's helper and read the one JSON line out of it.
   * `script` names the PowerShell file on win32 and is only a log label on darwin — the whole
   * argv differs between the two, so every caller builds its own.
   */
  private async cli<T>(script: string, args: string[], timeoutMs: number): Promise<T | null> {
    const raw = IS_DARWIN
      ? await this.runHelper(script, args, timeoutMs)
      : await this.runPs(script, args, timeoutMs)
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

  // ---------------------------------------------------------------- the accessibility tree

  private skipArgs(): string[] {
    const skip = this.opts.skipWindowIds?.() ?? []
    if (!skip.length) return []
    return IS_DARWIN ? ['--exclude-window', skip.join(',')] : ['-ExcludeHwnd', skip.join(',')]
  }

  /** darwin replies in the AX vocabulary; put it in the one this file speaks. */
  private normalize(res: unknown): UiaResult | null {
    if (!res) return null
    if (!IS_DARWIN) {
      const win = res as UiaResult
      win.matches = arr<UiaMatch>(win.matches)
      win.windows = arr(win.windows)
      return win
    }
    const ax = res as {
      ok: boolean
      mode: string
      ms: number
      scaleFactor?: number
      error?: string
      foreground?: AxWindow | null
      windows?: AxWindow[]
      matches?: AxMatch[]
      displays?: DisplayInfo[]
    }
    const fg = ax.foreground ? windowFromAx(ax.foreground) : null
    return {
      ok: !!ax.ok,
      mode: ax.mode ?? '',
      ms: ax.ms ?? 0,
      scaleFactor: ax.scaleFactor,
      displays: arr<DisplayInfo>(ax.displays),
      error: ax.error,
      foreground: fg,
      windows: arr<AxWindow>(ax.windows).map(windowFromAx),
      matches: arr<AxMatch>(ax.matches).map(fromAx)
    }
  }

  /**
   * Search the accessibility tree by name.
   *
   * `msaa` is a Windows-only axis: the older MSAA tree exists because managed UIA cannot see
   * inside NetUIHWND (File Explorer's whole ribbon). macOS has one accessibility API and no
   * second tree to fall back to, so on darwin the argument is ignored and the retry never runs.
   */
  private async find(name: string, hint: string, msaa: 'auto' | 'only' = 'auto'): Promise<UiaResult | null> {
    const args = IS_DARWIN
      ? [
          '--mode',
          'name',
          '--name',
          name,
          '--window-hint',
          hint || '',
          '--exclude-pid',
          this.opts.selfPids().join(','),
          ...this.skipArgs(),
          '--max',
          '10'
        ]
      : [
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
        ]
    const res = await this.cli<unknown>(
      IS_DARWIN ? 'courseless-ax name' : 'uia-find.ps1',
      args,
      !IS_DARWIN && msaa === 'only' ? UIA_TIMEOUT_MS + 2_000 : UIA_TIMEOUT_MS
    )
    return this.normalize(res)
  }

  /** Foreground window right now — used to drop a point the learner has navigated away from. */
  async foreground(): Promise<{ hwnd: number; title: string; process: string; self: boolean } | null> {
    const args = IS_DARWIN
      ? ['--mode', 'windows', '--exclude-pid', this.opts.selfPids().join(','), ...this.skipArgs()]
      : ['-Mode', 'windows', '-ExcludePid', this.opts.selfPids().join(','), ...this.skipArgs()]
    const res = this.normalize(await this.cli<unknown>(IS_DARWIN ? 'courseless-ax windows' : 'uia-find.ps1', args, UIA_TIMEOUT_MS))
    return res?.foreground ?? null
  }

  /** The element under a point — B5's recorder marks. Exposed here so B5 has no new plumbing. */
  async elementFromPoint(x?: number, y?: number): Promise<UiaMatch | null> {
    const args = IS_DARWIN
      ? ['--mode', 'at-point', '--exclude-pid', this.opts.selfPids().join(','), ...this.skipArgs()]
      : ['-Mode', 'from-point', '-ExcludePid', this.opts.selfPids().join(','), ...this.skipArgs()]
    if (typeof x === 'number' && typeof y === 'number') {
      args.push(IS_DARWIN ? '--x' : '-X', String(Math.round(x)), IS_DARWIN ? '--y' : '-Y', String(Math.round(y)))
    }
    const res = this.normalize(await this.cli<unknown>(IS_DARWIN ? 'courseless-ax at-point' : 'uia-find.ps1', args, UIA_TIMEOUT_MS))
    return res?.matches[0] ?? null
  }

  /**
   * The two macOS TCC gates, straight from the process that will actually need them — the helper
   * inherits the grant from its responsible process, so its answer is the one that matters.
   * Null on win32 (nothing to grant) and whenever the helper could not be run.
   */
  async permissions(prompt = false): Promise<{ accessibility: boolean; screenRecording: boolean } | null> {
    if (!IS_DARWIN) return null
    const res = await this.cli<{ ok: boolean; accessibility?: boolean; screenRecording?: boolean }>(
      'courseless-ax permissions',
      prompt ? ['--mode', 'permissions', '--prompt'] : ['--mode', 'permissions'],
      PERMISSIONS_TIMEOUT_MS
    )
    if (!res) return null
    return { accessibility: !!res.accessibility, screenRecording: !!res.screenRecording }
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
    if (PROSE_TYPES.has(m.controlType) && !PointService.rowNotProse(m)) return false
    // Nor is a container far larger than the label it holds: a whole pane named after its
    // heading is not a target either.
    // ...nor a sentence. Accessible names legitimately carry status ("Action Center, 27 new
    // notifications"), so the test is prose-shaped LENGTH in words, not characters.
    const name = (m.name || '').trim()
    if (!m.exact && name.split(/\s+/).length > 12) return false
    const how = m.how.split('/')[0]
    if (m.self) return selfIsTool
    if (how === 'hint') return true
    // The always-present surface: 'taskbar' on win32, 'shell' (Dock / menu bar) on darwin.
    //
    // This bucket is the one with no window of its own to vouch for it, and on macOS it carries
    // the menu bar — which belongs to whichever app is frontmost. So it is judged on two things
    // the wording of the step cannot change:
    //   * the name matched EXACTLY (a loose hit here is how "Format" became "System Information"),
    //   * and the surface belongs to the lesson's tool, or belongs to nobody (the Dock).
    // Nothing about the step's PROSE is consulted: shell surfaces are additive candidates always,
    // because "the sidebar of the Finder window" and "the list on the left" are the same request.
    if (how === SHELL_HOW) {
      if (!IS_DARWIN) {
        // win32 keeps its existing rule and only GAINS the tool-owned exact case, so a taskbar
        // candidate that was accepted before is still accepted.
        if (shellTarget) return true
        return m.exact && hintTokens.some((t) => `${m.windowTitle} ${m.process}`.toLowerCase().includes(t))
      }
      if (!m.exact) return false
      if (hintTokens.length === 0) return true
      const hay = `${m.windowTitle} ${m.process}`.toLowerCase()
      if (hintTokens.some((t) => hay.includes(t))) return true
      return OS_SHELL_OWNER_RE.test((m.process || '').trim())
    }
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

  /**
   * The ONE hole in the prose filter, kept as small as it can be.
   *
   * A Finder sidebar row is an AXStaticText — the same role as the paragraph of scrollback the
   * filter exists to reject — so rejecting the role wholesale means "Applications" can only ever
   * resolve to the Go menu, 469pt away from the row the step is describing. Everything below has
   * to be true at once, and every one of them is a property of the ELEMENT, not of the step:
   *   * darwin only, and only AXStaticText (the role that carries list rows),
   *   * the name matched EXACTLY — no substring may take this path,
   *   * the rect is label-shaped, not a paragraph and not a pane,
   *   * and the a11y tree says it sits in a row / outline / list / table.
   * A line of prose in a terminal has none of the last two, which is what keeps the old rule
   * intact for the case it was written for.
   */
  private static rowNotProse(m: UiaMatch): boolean {
    if (!IS_DARWIN || m.controlType !== 'AXStaticText' || !m.exact) return false
    if (m.w < 8 || m.h < 8 || m.h > 44 || m.w > 480) return false
    if (m.w * m.h > 12_000) return false
    return arr<string>(m.containers).some((r) => LIST_CONTAINER_RE.test(r))
  }

  private rank(m: UiaMatch, hintTokens: string[]): number {
    const how = m.how.split('/')[0]
    let s = 0
    if (m.exact) s += 100
    // A menu item whose menu is CLOSED is reported wearing the rect of the menu-bar item that
    // opens it. That is a useful answer when it is the only one, and the wrong answer whenever the
    // same name is also visible somewhere real — so it never outranks an unpromoted match.
    if (m.promoted || m.how.includes('/menu/')) s -= 45
    if (how === 'hint') s += 60
    else if (how === 'foreground') s += 50
    else if (how === 'behind') s += 40
    else if (how === SHELL_HOW) s += 30
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
   * The whole desktop as one image.
   *
   * `w/h` are always the PIXEL dimensions of the file. `x/y` are the origin of the capture in the
   * coordinate space the rest of this file works in — physical pixels on win32, points on darwin
   * — so screenshot pixel (0,0) is screen coordinate (x,y) after dividing by `scaleFactor`. On a
   * machine with a monitor to the LEFT of the primary the origin is negative.
   *
   * `scaleFactor` is 1 on win32 (UIA already speaks pixels) and the display's backing scale on
   * darwin (2 on Retina) — it is the ONLY bridge between the two spaces.
   */
  private async capture(
    displayId?: number
  ): Promise<{ path: string; w: number; h: number; x: number; y: number; scaleFactor: number; monitors: number } | null> {
    const path = join(this.opts.tempDir, `shot-${randomUUID()}.png`)
    const res = await this.cli<{
      ok: boolean
      path: string
      w: number
      h: number
      x: number
      y: number
      scaleFactor?: number
      monitors?: number
    }>(
      IS_DARWIN ? 'courseless-ax shot' : 'screen-shot.ps1',
      IS_DARWIN
        ? // The helper drops our own windows out of the frame the same way -IncludeLayered:$false
          // does on Windows: the pointer sheet and the recording pill must never be in the image
          // the engine is asked to read.
          //
          // ONE display per capture — that is all ScreenCaptureKit's SCContentFilter(display:)
          // can do. Omitting --display means the main one, which is why `ground` walks the display
          // list rather than assuming the target is on the primary monitor.
          [
            '--mode',
            'shot',
            '--path',
            path,
            '--exclude-pid',
            this.opts.selfPids().join(','),
            ...(displayId != null ? ['--display', String(displayId)] : [])
          ]
        : ['-Mode', 'capture', '-Path', path],
      SHOT_TIMEOUT_MS
    )
    if (!res?.ok) return null
    const scaleFactor = IS_DARWIN ? res.scaleFactor || 1 : 1
    // darwin captures exactly one display, so a capture is never "more than one monitor" there.
    // On win32 one BitBlt covers the whole virtual desktop and the ps1 reports how many screens
    // went into it.
    const monitors = IS_DARWIN ? 1 : Math.max(1, res.monitors ?? 1)
    return { path: res.path, w: res.w, h: res.h, x: res.x ?? 0, y: res.y ?? 0, scaleFactor, monitors }
  }

  /**
   * Which screens to look at, best first.
   *
   * ScreenCaptureKit captures ONE display, so on a two-monitor desk the vision fallback used to be
   * blind to everything that was not on the primary. The a11y census we have already paid for
   * carries both the display list and the candidate windows' rects, so the order costs nothing:
   * the display holding the tool's own window first (that is where the target almost always is),
   * then the main display, then the rest — and the search stops at the first screen that answers.
   *
   * win32 (and a single-display Mac) returns `[undefined]`: one capture, no --display argument,
   * byte-identical to what this did before.
   */
  private displayOrder(uia: UiaResult | null): (number | undefined)[] {
    const displays = uia?.displays ?? []
    if (!IS_DARWIN || displays.length < 2) return [undefined]
    const windows = uia?.windows ?? []
    const anchor =
      windows.find((w) => w.how === 'hint' && w.w) ??
      windows.find((w) => w.how === 'foreground' && w.w) ??
      windows.find((w) => w.how === 'behind' && w.w)
    const centre = anchor?.w
      ? { x: (anchor.left ?? 0) + anchor.w / 2, y: (anchor.top ?? 0) + (anchor.h ?? 0) / 2 }
      : null
    const score = (d: DisplayInfo): number => {
      let s = d.main ? 1 : 0
      if (centre && centre.x >= d.left && centre.x < d.left + d.w && centre.y >= d.top && centre.y < d.top + d.h) s += 10
      return s
    }
    return [...displays].sort((a, b) => score(b) - score(a)).map((d) => d.id)
  }

  /** x/y/w/h are PIXELS of `input` on both platforms — the crop never leaves image space. */
  private async crop(input: string, x: number, y: number, w: number, h: number): Promise<string | null> {
    const path = join(this.opts.tempDir, `crop-${randomUUID()}.png`)
    const res = await this.cli<{ ok: boolean; path: string }>(
      IS_DARWIN ? 'courseless-ax crop' : 'screen-shot.ps1',
      IS_DARWIN
        ? [
            '--mode',
            'crop',
            '--in',
            input,
            '--path',
            path,
            '--x',
            String(Math.round(x)),
            '--y',
            String(Math.round(y)),
            '--w',
            String(Math.round(w)),
            '--h',
            String(Math.round(h))
          ]
        : [
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

  /**
   * One look at one image, on its own leash. Anything that is not an answer — a refusal, a
   * timeout, a service that is not there — comes back as the empty string, which reads downstream
   * as "could not see it" and ends in an honest miss. The engine bounds this at 30s itself.
   *
   * `budgetMs` puts a SHORTER leash on top of that (see VERIFY_BUDGET_MS) and reports which of the
   * two happened, because "the check timed out" and "the check said no" are different answers and
   * the caller treats them differently. A raced-out call is abandoned, not cancelled: the engine
   * finishes on its own and the reply is dropped.
   */
  private async askVision(imagePath: string, prompt: string, budgetMs = 0): Promise<{ text: string; timedOut: boolean }> {
    this.lastVisionFailure = null
    const call = this.opts.vision(imagePath, prompt).then(
      (text) => ({ text, timedOut: false }),
      (e: unknown) => {
        const kind = (e as { kind?: string })?.kind
        const message = (e as { message?: string })?.message
        // A used-up allowance is the one failure that is not a failure to SEE. It is remembered so
        // the outcome can say what actually happened instead of "couldn't spot it".
        if (kind) this.lastVisionFailure = { kind, message: message ?? '' }
        log('point', 'vision call failed', String(kind ?? ''), String(message ?? e).slice(0, 200))
        return { text: '', timedOut: kind === 'TIMEOUT' }
      }
    )
    if (!budgetMs) return call
    let timer: ReturnType<typeof setTimeout> | undefined
    const raced = await Promise.race([
      call,
      // Deliberately NOT unref'd: this timer is the thing being awaited, not background work.
      new Promise<{ text: string; timedOut: boolean }>((resolve) => {
        timer = setTimeout(() => resolve({ text: '', timedOut: true }), budgetMs)
      })
    ])
    if (timer) clearTimeout(timer)
    return raced
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

    // ---- 1. the accessibility tree
    const uia = await this.find(query, req.tool)
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
    //
    // WINDOWS ONLY. macOS has a single accessibility API — there is no second, older tree hiding
    // the controls the first one missed — so this retry would be the same query twice.
    if (!IS_DARWIN && candidates.length === 0 && query && (uia?.matches.length ?? 0) > 0) {
      const deep = await this.find(query, req.tool, 'only')
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
    // Nobody signed in means nothing can look at the screen — so the screen is not captured.
    if (!this.opts.canVision()) {
      return remember({ outcome: 'miss', where: req.where, tried: query, ms: Date.now() - t0 })
    }
    const files: string[] = []
    try {
      // One capture per display, best screen first, stopping at the first one that answers. On
      // win32 and on a single-display Mac this loop runs exactly once with no --display argument.
      let captured = 0
      for (const displayId of this.displayOrder(uia)) {
        const shot = await this.capture(displayId)
        if (!shot) continue
        captured++
        const shotAt = Date.now()
        files.push(shot.path)
        // "Wider than a large single monitor" is not something to guess at from a width: a wide
        // ultrawide is one screen and a 2x Retina panel is not two. The capture itself now says
        // how many monitors went into it (always 1 on darwin, where we grab one display).
        const monitors = shot.monitors > 1 ? ' It spans more than one monitor side by side.' : ''
        // Vision models answer on a 0-1000 grid whatever the prompt asks for, so the prompt asks
        // for the grid and this code does the arithmetic. Asking for pixels scores near zero.
        const prompt = [
          `This is a ${shot.w}x${shot.h} screenshot of a ${IS_DARWIN ? 'macOS' : 'Windows'} desktop.${monitors}`,
          `Find the on-screen element: "${query}".`,
          `Context: the learner is using ${req.tool || 'this app'} and the current step is "${req.action}".`,
          `It should be at: ${req.where}.`,
          'Reply with ONLY this JSON object and nothing else:',
          '{"x": <0-1000>, "y": <0-1000>, "confidence": <0 to 1>}',
          'x,y is the CENTRE of that element in NORMALISED coordinates on a 0-1000 grid: x=0 is the',
          'left edge and x=1000 the right edge of the image, y=0 the top and y=1000 the bottom.',
          'Do not answer in pixels.',
          'If the element is not visible in this screenshot, reply {"x":-1,"y":-1,"confidence":0}.'
        ].join('\n')
        const reply = await this.askVision(shot.path, prompt)
        const obj = PointService.json(reply.text)
        const nx = Number(obj?.x)
        const ny = Number(obj?.y)
        const confidence = Number(obj?.confidence)
        log('point', 'vision', JSON.stringify({ query, display: displayId ?? 'main', nx, ny, confidence, replyLen: reply.text.length }))

        if (this.lastVisionFailure?.kind === 'LIMIT') {
          const message = this.lastVisionFailure.message
          this.lastVisionFailure = null
          return remember({
            outcome: 'limit',
            message: message || 'This month’s looks at the screen are used up.',
            ms: Date.now() - t0
          })
        }

        const onGrid = Number.isFinite(nx) && Number.isFinite(ny) && nx >= 0 && ny >= 0 && nx <= 1000 && ny <= 1000
        // Not on this screen — try the next one before giving up.
        if (!onGrid || !Number.isFinite(confidence) || confidence < 0.4) continue

        // 0-1000 grid -> screenshot pixels. `x`/`y` stay in IMAGE PIXELS from here on, because the
        // crop below is taken out of this same image and crops are pixels on both platforms.
        const x = Math.min(shot.w - 1, (nx / 1000) * shot.w)
        const y = Math.min(shot.h - 1, (ny / 1000) * shot.h)

        // ...and out into screen space, which is physical pixels on win32 and POINTS on darwin —
        // hence the divide, which is a no-op on Windows (scaleFactor 1) and the difference between
        // pointing at the button and pointing at a quarter of the way to it on a Retina Mac. The
        // origin is this display's own, so a second monitor's coordinates land on it and not on a
        // mirror image of the primary.
        const screenX = x / shot.scaleFactor + shot.x
        const screenY = y / shot.scaleFactor + shot.y

        // Self-verification. A model claim is not evidence — look again at a crop before showing it.
        // Skipped only when UIA corroborated the same spot in the same window (spec §accuracy).
        const corroborated =
          confidence >= 0.85 &&
          (uia?.matches ?? []).some((m) => Math.abs(m.x - screenX) <= 120 && Math.abs(m.y - screenY) <= 120)
        let unchecked = false
        if (!corroborated) {
          // The crop MUST come from the same capture — that is what makes the second look a check
          // on the first answer rather than a new question. (An earlier version aged out the
          // capture here, which made verification impossible: the engine call itself takes ~5s.)
          // 240x180 of SCREEN, not of image: on a 2x display a 240px crop is 120pt across, half a
          // toolbar button and far too little context for the second look to mean anything.
          const cw = Math.round(240 * shot.scaleFactor)
          const ch = Math.round(180 * shot.scaleFactor)
          const cropPath = await this.crop(shot.path, x - cw / 2, y - ch / 2, cw, ch)
          if (!cropPath) {
            return remember({ outcome: 'miss', where: req.where, tried: query, ms: Date.now() - t0 })
          }
          files.push(cropPath)
          const verifyPrompt = [
            `This is a ${cw}x${ch} crop taken from a ${IS_DARWIN ? 'macOS' : 'Windows'} screen, centred on a candidate location.`,
            `Does this crop contain the element "${query}" (context: ${req.tool || 'a desktop app'})?`,
            'Reply with ONLY this JSON object: {"match": true} or {"match": false}.'
          ].join('\n')
          // Two attempts, VERIFY_BUDGET_MS each. A stalled check is retried once; a check that
          // ANSWERS is taken at its word the first time.
          let vObj: any = null
          let vTimedOut = false
          for (let attempt = 0; attempt < 2; attempt++) {
            const v = await this.askVision(cropPath, verifyPrompt, VERIFY_BUDGET_MS)
            vObj = PointService.json(v.text)
            vTimedOut = v.timedOut && !vObj
            if (!vTimedOut) break
            log('point', 'vision verify timed out', JSON.stringify({ query, attempt: attempt + 1 }))
          }
          const match = vObj?.match === true || vObj?.match === 'true'
          log('point', 'vision verify', JSON.stringify({ query, match, timedOut: vTimedOut }))
          if (!match && !vTimedOut) continue
          // Both looks at the crop timed out. The first look is still the first look — measured at
          // 2.5pt — so it is shown, and it is shown as UNCHECKED rather than as verified.
          unchecked = vTimedOut
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
          verified: !unchecked,
          matched: `${query} (seen on screen, confidence ${confidence.toFixed(2)}${
            unchecked ? ', not double-checked — the second look timed out' : corroborated ? ', corroborated' : ', crop-checked'
          })`,
          ms: Date.now() - t0
        })
      }
      if (!captured) {
        return remember({ outcome: 'error', message: 'Could not capture the screen.', ms: Date.now() - t0 })
      }
      return remember({ outcome: 'miss', where: req.where, tried: query, ms: Date.now() - t0 })
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
