// Shared type contracts between main, preload and renderer.
// Keep this file dependency-free (no electron/node imports) — it is bundled into all three.

// ---------------------------------------------------------------- lesson schema

export type SkillLevel = 'never' | 'few' | 'rusty'
export type FadeTier = 1 | 2 | 3

/** One doing-step. `hint_levels` escalate: nudge -> detail -> exact click path. */
export interface LessonStep {
  /** Imperative, one sentence. */
  action: string
  /** Precise UI location, in words. */
  where: string
  /** One line of motivation. */
  why: string
  /** Observable proof it worked. */
  checkpoint: string
  /** Exactly 3 entries: nudge, detail, exact path. */
  hint_levels: string[]
  /** 1 = guided, 2 = prompted, 3 = solo. */
  fade_tier: FadeTier
  /**
   * The on-screen element this step acts on, named the way it is LABELLED in the app
   * ("Insert tab", "Blank spreadsheet", "Commit to main"). 2-5 words. Optional: lessons
   * generated before B4 have none, and pointing falls back to a phrase mined from `where`.
   */
  target?: string
}

export interface RunStepStat {
  stepIndex: number
  seconds: number
  hintsUsed: number
  skipped: boolean
  done: boolean
}

export interface LessonRun {
  startedAt: string
  finishedAt: string
  perStep: RunStepStat[]
  /** (hints + 2 * skips) / steps — computed in the main process by LessonStore. */
  assistanceRate: number
  /**
   * The lesson version this run was recorded against. Step stats are stored by index, so once
   * the steps are reordered or deleted those indexes mean something else — Review says so out
   * loud rather than quietly comparing two different lessons. Absent on pre-B5 runs (= 1).
   */
  version?: number
}

export interface Lesson {
  id: string
  title: string
  tool: string
  goal: string
  est_minutes: number
  prerequisites: string[]
  steps: LessonStep[]
  /** Deterministic seed for the generated ocean-gradient cover art. */
  coverSeed: number
  /** Codex thread/session id — coaching continuity lives here. */
  codexThreadId: string | null
  createdAt: string
  runs: LessonRun[]
  /** Starter-library track, e.g. "Excel". Absent on user-generated lessons. */
  track?: string
  /** True for lessons shipped in resources/seed-lessons. */
  builtin?: boolean
  /** Featured pick inside the starter library. */
  featured?: boolean
  /**
   * Bumped by the step editor on a STRUCTURAL edit (add / delete / reorder). Runs carry the
   * version they were recorded against; when they disagree, Review says so. Absent = 1.
   */
  version?: number
  /** Compiled from a walkthrough the user recorded themselves, not from a typed request. */
  recordedByYou?: boolean
  /** Who the author said it was for ("new sales hires", "my mom, complete beginner"). */
  audience?: string
  /** Set on import: the name the file was authored under. Drives the "from <name>" row tag. */
  importedFrom?: string
  importedAt?: string
}

/** What the renderer sends up when a run finishes (assistanceRate is computed in main). */
export interface RunInput {
  startedAt: string
  finishedAt: string
  perStep: RunStepStat[]
}

// ---------------------------------------------------------------- codex

export type CodexTransport = 'app-server' | 'exec'

export interface CodexStatus {
  installed: boolean
  loggedIn: boolean
  version: string | null
  model: string | null
  exePath: string | null
  transport: CodexTransport | null
  error?: string
}

export type CodexErrorKind =
  | 'NOT_INSTALLED'
  | 'NOT_LOGGED_IN'
  | 'TIMEOUT'
  | 'PARSE_FAILED'
  | 'TURN_FAILED'
  | 'CANCELLED'
  | 'TRANSPORT'
  | 'UNKNOWN'

export interface CodexFailure {
  kind: CodexErrorKind
  message: string
}

export interface RateLimitInfo {
  usedPercent?: number
  windowDurationMins?: number
  resetsAt?: string | number | null
}

// ---------------------------------------------------------------- streaming events

export type GenerateEvent =
  | { opId: string; type: 'status'; message: string; transport?: CodexTransport }
  | { opId: string; type: 'delta'; text: string }
  | { opId: string; type: 'message'; text: string }
  | { opId: string; type: 'rateLimits'; rateLimits: RateLimitInfo | null; raw?: unknown }
  | { opId: string; type: 'done'; lesson: Lesson }
  | { opId: string; type: 'error'; error: CodexFailure }

export type CoachEvent =
  | { opId: string; type: 'status'; message: string; transport?: CodexTransport }
  | { opId: string; type: 'delta'; text: string }
  | { opId: string; type: 'message'; text: string }
  | { opId: string; type: 'done'; text: string }
  | { opId: string; type: 'error'; error: CodexFailure }

export interface StepContext {
  stepIndex: number
  total: number
  step?: LessonStep | null
}

export interface NextSuggestion {
  title: string
  ask: string
}

// ---------------------------------------------------------------- runner sync (main <-> float)

/** One turn of the coach conversation. ONE thread, whichever surface it is read on. */
export interface CoachLine {
  role: 'you' | 'coach'
  text: string
}

/**
 * The tail of that conversation, carried to the float so the compact chat and the drawer are the
 * same thread rather than two. The float shows a WINDOW onto it (the last few exchanges); the
 * main window owns the whole of it and does the sending.
 */
export interface RunnerCoachState {
  /** Most recent lines, oldest first. Capped — the float is 380px wide. */
  lines: CoachLine[]
  /** The reply currently streaming in, if any. */
  stream: string
  busy: boolean
  /** Length of the FULL thread, so the float can say what it is not showing. */
  total: number
}

export interface RunnerState {
  active: boolean
  lessonId: string | null
  title: string
  tool: string
  stepIndex: number
  total: number
  step: LessonStep | null
  /** 0 = no hint shown, 1..3 = hint level currently revealed. */
  hintLevel: number
  hintsUsed: number
  startedAtMs: number | null
  /** Set once per step when the learner has gone quiet past the stall threshold. */
  stalled?: boolean
  /** Mirrors the pointing state so the float can show it without owning the work. */
  pointing?: PointPhase
  /** The outcome of the last point on THIS step — drives the honest-miss note. */
  pointResult?: PointResult | null
  /** The coach thread's tail, for the float's compact chat. Null while nothing has been asked. */
  coach?: RunnerCoachState | null
}

export const EMPTY_RUNNER_STATE: RunnerState = {
  active: false,
  lessonId: null,
  title: '',
  tool: '',
  stepIndex: 0,
  total: 0,
  step: null,
  hintLevel: 0,
  hintsUsed: 0,
  startedAtMs: null,
  stalled: false,
  pointing: 'idle',
  pointResult: null,
  coach: null
}

/**
 * `coach-ask` carries the float's typed question to the window that owns the thread — the float
 * never calls the engine itself, or the two surfaces would be two conversations.
 * `coach-open` is "continue in window": raise the window with the drawer open, same thread.
 */
export type RunnerActionType =
  | 'done'
  | 'hint'
  | 'skip'
  | 'prev'
  | 'close'
  | 'point'
  | 'coach-ask'
  | 'coach-open'
export interface RunnerAction {
  type: RunnerActionType
  source: 'main' | 'float' | 'tray' | 'hotkey'
  /** `coach-ask` only. */
  text?: string
}

// ---------------------------------------------------------------- guided pointing

/** What the runner/float button is doing right now. */
export type PointPhase = 'idle' | 'finding' | 'shown'

/** What PointService was asked to find. The renderer sends the step; main derives the query. */
export interface PointRequest {
  lessonId: string
  stepIndex: number
  /** Explicit element name (step.target) — omitted for pre-B4 lessons. */
  target?: string
  /** Words describing where it lives; also the honest-miss copy. */
  where: string
  /** The step's imperative, used as vision context. */
  action: string
  /** The lesson's tool, used as the window hint and the wrong-app copy. */
  tool: string
  /** Skip the 30s per-step cache (the "Show me" button always re-grounds). */
  fresh?: boolean
}

/**
 * Exactly three outcomes, per the accuracy contract: a VERIFIED point, an honest miss, or
 * "that app isn't open". There is deliberately no fourth "best guess" state.
 */
export type PointResult =
  | {
      outcome: 'point'
      /** Physical screen pixels — the same space as UIA rects and CopyFromScreen. */
      x: number
      y: number
      label: string
      method: 'uia' | 'vision'
      verified: boolean
      /** The element name / description that was actually matched. */
      matched: string
      /** Window the match belongs to — the overlay drops itself if the learner leaves it. */
      windowHwnd?: number
      ms: number
    }
  | { outcome: 'miss'; where: string; tried: string; ms: number }
  | { outcome: 'wrong-app'; tool: string; foreground: string; ms: number }
  | { outcome: 'error'; message: string; ms: number }

/** What the overlay window renders. Coordinates are CSS px local to the overlay window. */
export interface OverlayPoint {
  id: number
  x: number
  y: number
  label: string
  /**
   * Local bounds of the MONITOR the point falls on. The overlay spans every display, so "near
   * the edge" (which flips the callout) means the edge of this screen, not of the whole desktop.
   */
  screen: { x: number; y: number; width: number; height: number }
}

// ---------------------------------------------------------------- recording (authoring)

/**
 * The element under the cursor at the moment a mark was taken, straight out of the
 * accessibility tree (uia-find.ps1 --from-point). `name` is what the app CALLS the thing, which
 * is exactly what a step's `target` needs to be for pointing to work on someone else's machine.
 */
export interface MarkElement {
  name: string
  controlType: string
  automationId?: string
  className?: string
  /** Physical screen pixels. */
  rect: { x: number; y: number; w: number; h: number }
  /** Named ancestors, nearest first — the label a person would say is often a level up. */
  ancestors: string[]
}

/**
 * One moment the author thought mattered. NOTHING else is captured: no screenshots, no
 * continuous capture, no keystrokes — a mark is a timestamp, a window, a cursor and a name.
 */
export interface RecordMark {
  id: string
  /** ms since the recording started. */
  at: number
  windowTitle: string
  process: string
  cursor: { x: number; y: number }
  element: MarkElement | null
  /** The author's own one-liner, if they typed one. */
  note?: string
}

export type RecordPhase = 'idle' | 'recording' | 'compiling'

/** Broadcast to every window so the pill and the main window can never disagree. */
export interface RecordingState {
  phase: RecordPhase
  id: string | null
  name: string
  audience: string
  startedAtMs: number | null
  marks: RecordMark[]
  /** A mark capture is in flight (the pill dims its counter for the ~0.5s it takes). */
  capturing: boolean
  /** Id of the mark whose note input is open, if any. */
  noteFor: string | null
  /** The compile operation — the main window follows it on the normal generate stream. */
  opId: string | null
  /** Set when a compile failed; the marks live on in a draft. */
  error?: string | null
}

export const EMPTY_RECORDING: RecordingState = {
  phase: 'idle',
  id: null,
  name: '',
  audience: '',
  startedAtMs: null,
  marks: [],
  capturing: false,
  noteFor: null,
  opId: null,
  error: null
}

/** A recording whose compile failed. The marks are never thrown away. */
export interface RecordDraft {
  id: string
  name: string
  audience: string
  startedAt: string
  marks: RecordMark[]
  failedAt: string
  error: string
}

// ---------------------------------------------------------------- sharing

/** What `lessons.export` did, or why it did not. */
export type ExportResult =
  | { ok: true; path: string }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: false; error: string }

/** What `lessons.import` did. The error NAMES the field that failed — never "invalid file". */
export type ImportResult =
  | { ok: true; lesson: Lesson; authoredBy: string }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: false; error: string; file?: string }

// ---------------------------------------------------------------- settings / float

export interface Settings {
  hotkey: string
  theme: 'light' | 'dark'
  model: string | null
  /** Ids of builtin (seed) lessons the user deleted — they must not resurrect on next launch. */
  deletedBuiltins: string[]
  /** False until the first-run screen has been dismissed. */
  onboarded: boolean
  /** Point at every new step automatically, not only when asked. Off by default. */
  pointAsYouGo: boolean
  /** Read each step aloud with the system voice. Off by default — Courseless is quiet. */
  speakSteps: boolean
  /** Nudge from the float when a step goes quiet for too long. On by default. */
  stallCoach: boolean
  /** The name written into lessons you share. Empty = "a Courseless user". */
  displayName: string
  /**
   * Lessons run pinned to the screen by default: the float carries the lesson and the window
   * steps aside. On by default — the screen is the classroom. Off swaps the two start CTAs.
   */
  startPinned: boolean
  /** The one-time "Courseless gets out of the way" card has been shown in the float. */
  pinExplainerSeen: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  hotkey: 'CommandOrControl+Shift+Space',
  theme: 'light',
  model: null,
  deletedBuiltins: [],
  onboarded: false,
  pointAsYouGo: false,
  speakSteps: false,
  stallCoach: true,
  displayName: '',
  startPinned: true,
  pinExplainerSeen: false
}

/**
 * Custom title bar commands. `query` mutates nothing — it just reports the maximized state.
 * `restore` un-minimizes and focuses: pinning a lesson MINIMIZES the window (taskbar presence
 * stays), so the window has to be able to come back when the run ends or the learner expands.
 */
export type WinCommand = 'minimize' | 'maximize' | 'close' | 'query' | 'restore'

export type FloatCommand = 'open' | 'close' | 'toggle' | 'status'
export interface FloatStatus {
  open: boolean
  visible: boolean
  alwaysOnTop: boolean
  bounds?: { x: number; y: number; width: number; height: number }
}

// ---------------------------------------------------------------- ipc results

export type Ok<T> = { ok: true; value: T }
export type Err = { ok: false; error: CodexFailure }
export type Result<T> = Ok<T> | Err

export interface OpStarted {
  opId: string
}
