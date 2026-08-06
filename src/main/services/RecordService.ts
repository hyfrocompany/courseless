// RecordService — "record it once, send the file".
//
// WHAT A RECORDING IS, EXACTLY
// A recording is a list of MOMENTS the author chose. Pressing Ctrl+Shift+M captures one:
//   when it happened, which window was in front, where the cursor was, and what the
//   accessibility tree calls the thing under it.
// That is the whole capture. There is no screen recording, no screenshot, no keylogging and no
// polling loop — between two marks Courseless is doing nothing at all. This is a product
// promise, not an implementation detail, so the capture path lives in one small file where it
// can be read in a minute.
//
// The element NAME is the part that makes sharing work: "New folder" is what the button is
// called on the recipient's machine too, so B4's pointer can find it there without ever having
// seen their screen.
//
// Electron-free, like CodexService and PointService: the shortcut, the pill window and the
// broadcast are injected.

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  EMPTY_RECORDING,
  type MarkElement,
  type RecordDraft,
  type RecordMark,
  type RecordingState
} from '../../shared/types'
import { log } from '../util/log'

import type { UiaMatch } from './PointService'

export interface RecordServiceOptions {
  /** Where the drafts live: <userData>/drafts. */
  draftDir: string
  /**
   * Capture the element under the cursor. Injected so this class does not spawn PowerShell
   * itself — PointService already owns that plumbing and the exclusion lists.
   */
  elementFromPoint(): Promise<UiaMatch | null>
  /** The window in front right now, our own windows excluded. */
  foreground(): Promise<{ hwnd: number; title: string; process: string; self: boolean } | null>
  /** Broadcast — every window renders from this one state. */
  onChange(state: RecordingState): void
}

const SAFE_ID = /^[A-Za-z0-9._-]+$/

function arr(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && x.length > 0)
  if (typeof v === 'string' && v) return [v]
  return []
}

export class RecordService {
  private opts: RecordServiceOptions
  private state: RecordingState = { ...EMPTY_RECORDING, marks: [] }
  /** Cleared when the note times out or the next mark lands. */
  private noteTimer: NodeJS.Timeout | null = null

  constructor(opts: RecordServiceOptions) {
    this.opts = opts
    try {
      mkdirSync(opts.draftDir, { recursive: true })
    } catch {
      /* ignore */
    }
  }

  getState(): RecordingState {
    return this.state
  }

  get recording(): boolean {
    return this.state.phase === 'recording'
  }

  private push(patch: Partial<RecordingState>): RecordingState {
    this.state = { ...this.state, ...patch }
    this.opts.onChange(this.state)
    return this.state
  }

  // ---------------------------------------------------------------- lifecycle

  start(name: string, audience: string): RecordingState {
    if (this.state.phase === 'recording') return this.state
    const id = randomUUID()
    log('record', 'started', { id, name, audience: audience || '(none)' })
    return this.push({
      phase: 'recording',
      id,
      name: name.trim(),
      audience: audience.trim(),
      startedAtMs: Date.now(),
      marks: [],
      capturing: false,
      noteFor: null,
      opId: null,
      error: null
    })
  }

  /**
   * One mark. Everything about it comes from a single accessibility read, so a mark costs one
   * short-lived PowerShell process and nothing else.
   */
  async mark(): Promise<RecordingState> {
    if (this.state.phase !== 'recording' || !this.state.startedAtMs) {
      // The hotkey only exists while recording, but a stale key repeat can still arrive: do
      // nothing, and leave no trace of having been asked.
      log('record', 'mark ignored — not recording')
      return this.state
    }
    // A second mark closes the previous note; the author moved on.
    this.closeNote()
    this.push({ capturing: true })

    const at = Date.now() - this.state.startedAtMs
    let hit: UiaMatch | null = null
    try {
      hit = await this.opts.elementFromPoint()
    } catch (e) {
      log('record', 'element read failed', String(e).slice(0, 160))
    }

    // The pill is always-on-top and sits over the desktop: if the cursor was on OUR window, the
    // element under it is ours and means nothing to the lesson. Keep the moment, drop the name.
    const ourOwn = !!hit?.self
    const element: MarkElement | null =
      hit && !ourOwn && hit.name
        ? {
            name: String(hit.name).trim(),
            controlType: String(hit.controlType || ''),
            ...(hit.automationId ? { automationId: String(hit.automationId) } : {}),
            ...(hit.className ? { className: String(hit.className) } : {}),
            rect: { x: hit.left, y: hit.top, w: hit.w, h: hit.h },
            ancestors: arr(hit.ancestors).slice(0, 5)
          }
        : null

    // Which app was this in? The foreground window is the honest answer, unless the author
    // clicked the pill (then the app they are teaching is the one behind us).
    let windowTitle = ''
    let process = ''
    if (hit && !ourOwn) {
      windowTitle = hit.windowTitle || ''
      process = hit.process || ''
    } else {
      const fg = await this.opts.foreground().catch(() => null)
      if (fg && !fg.self) {
        windowTitle = fg.title || ''
        process = fg.process || ''
      }
    }

    const mark: RecordMark = {
      id: randomUUID(),
      at,
      windowTitle,
      process,
      cursor: { x: hit?.pointX ?? 0, y: hit?.pointY ?? 0 },
      element
    }
    log('record', 'mark', {
      n: this.state.marks.length + 1,
      at,
      element: element?.name ?? null,
      type: element?.controlType ?? null,
      window: windowTitle.slice(0, 60),
      process
    })

    const next = this.push({
      marks: [...this.state.marks, mark],
      capturing: false,
      noteFor: mark.id
    })
    // The note is offered, never demanded: it disappears on its own.
    this.noteTimer = setTimeout(() => {
      if (this.state.noteFor === mark.id) this.push({ noteFor: null })
      this.noteTimer = null
    }, 6_000)
    this.noteTimer.unref?.()
    return next
  }

  private closeNote(): void {
    if (this.noteTimer) clearTimeout(this.noteTimer)
    this.noteTimer = null
  }

  /** Attach the author's one-liner to the mark whose note input is open. */
  note(text: string): RecordingState {
    const id = this.state.noteFor
    this.closeNote()
    const clean = text.trim().slice(0, 240)
    if (!id || !clean) return this.push({ noteFor: null })
    log('record', 'note', clean.slice(0, 80))
    return this.push({
      marks: this.state.marks.map((m) => (m.id === id ? { ...m, note: clean } : m)),
      noteFor: null
    })
  }

  /** Take back the last mark. Recording is a first draft; undo has to be free. */
  undo(): RecordingState {
    if (this.state.phase !== 'recording' || this.state.marks.length === 0) return this.state
    this.closeNote()
    const dropped = this.state.marks[this.state.marks.length - 1]
    log('record', 'undo', dropped.element?.name ?? '(no element)')
    return this.push({ marks: this.state.marks.slice(0, -1), noteFor: null })
  }

  /** Hand the marks over for compiling. The session stays in `compiling` until the engine ends. */
  takeForCompile(): { id: string; name: string; audience: string; marks: RecordMark[] } | null {
    if (this.state.phase !== 'recording' || !this.state.id) return null
    this.closeNote()
    const session = {
      id: this.state.id,
      name: this.state.name,
      audience: this.state.audience,
      marks: this.state.marks
    }
    log('record', 'stopped', { id: session.id, marks: session.marks.length })
    return session
  }

  compiling(opId: string): RecordingState {
    return this.push({ phase: 'compiling', opId, capturing: false, noteFor: null, error: null })
  }

  finish(): RecordingState {
    this.closeNote()
    return this.push({ ...EMPTY_RECORDING, marks: [] })
  }

  cancel(): RecordingState {
    this.closeNote()
    if (this.state.phase !== 'idle') log('record', 'cancelled', { marks: this.state.marks.length })
    return this.push({ ...EMPTY_RECORDING, marks: [] })
  }

  // ---------------------------------------------------------------- drafts

  private draftFile(id: string): string {
    if (!SAFE_ID.test(id)) throw new Error(`unsafe draft id: ${id}`)
    return join(this.opts.draftDir, `${id}.json`)
  }

  /**
   * A failed compile must never cost the author their recording. The marks go to disk, the pill
   * is gone, and the Library offers to try again — the expensive part (doing the task while
   * marking it) is not repeatable, so it is the part we keep.
   */
  saveDraft(session: { id: string; name: string; audience: string; marks: RecordMark[] }, error: string): RecordDraft {
    const draft: RecordDraft = {
      id: session.id,
      name: session.name,
      audience: session.audience,
      startedAt: new Date().toISOString(),
      marks: session.marks,
      failedAt: new Date().toISOString(),
      error: error.slice(0, 400)
    }
    try {
      mkdirSync(this.opts.draftDir, { recursive: true })
      const file = this.draftFile(draft.id)
      const tmp = `${file}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(draft, null, 2), 'utf8')
      renameSync(tmp, file)
      log('record', 'draft saved', draft.id, `${draft.marks.length} marks`)
    } catch (e) {
      log('record', 'draft save failed', String(e).slice(0, 200))
    }
    return draft
  }

  drafts(): RecordDraft[] {
    try {
      return readdirSync(this.opts.draftDir)
        .filter((n) => n.endsWith('.json'))
        .map((n) => {
          try {
            return JSON.parse(readFileSync(join(this.opts.draftDir, n), 'utf8')) as RecordDraft
          } catch {
            return null
          }
        })
        .filter((d): d is RecordDraft => !!d && Array.isArray(d.marks))
        .sort((a, b) => (b.failedAt ?? '').localeCompare(a.failedAt ?? ''))
    } catch {
      return []
    }
  }

  getDraft(id: string): RecordDraft | null {
    try {
      const file = this.draftFile(id)
      if (!existsSync(file)) return null
      return JSON.parse(readFileSync(file, 'utf8')) as RecordDraft
    } catch {
      return null
    }
  }

  deleteDraft(id: string): boolean {
    try {
      const file = this.draftFile(id)
      if (!existsSync(file)) return false
      unlinkSync(file)
      log('record', 'draft deleted', id)
      return true
    } catch {
      return false
    }
  }

  /** Put a draft back on the workbench so it can be compiled again. */
  resume(draft: RecordDraft): RecordingState {
    return this.push({
      phase: 'compiling',
      id: draft.id,
      name: draft.name,
      audience: draft.audience,
      startedAtMs: Date.now(),
      marks: draft.marks,
      capturing: false,
      noteFor: null,
      opId: null,
      error: null
    })
  }

  failed(message: string): RecordingState {
    return this.push({ ...EMPTY_RECORDING, marks: [], error: message })
  }
}
