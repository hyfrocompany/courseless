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
  /**
   * Legacy engine thread id. The engine is stateless now — coach context is rebuilt from the
   * lesson plus the last few turns held in the main process — so this is always null on new
   * lessons and is kept only so older files still load.
   */
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

// ---------------------------------------------------------------- engine

/** How the turn was carried. Streaming ops are `app-server`; one-shot JSON ops are `exec`. */
export type EngineTransport = 'app-server' | 'exec'

/**
 * What the engine can do right now. The field names outlive the local-CLI era on purpose — the
 * whole UI reads them — but the meanings are the hosted ones:
 *   installed  the engine is a service, so this is always true
 *   loggedIn   there is a signed-in account
 *   version    'cloud'
 *   model      the plan label the account is being served on
 *   exePath    always null
 *   transport  set once the service answered
 */
export interface EngineStatus {
  installed: boolean
  loggedIn: boolean
  version: string | null
  model: string | null
  exePath: string | null
  transport: EngineTransport | null
  error?: string
  /** The signed-in address, when there is one. */
  email?: string | null
  plan?: PlanId
}

export type EngineErrorKind =
  | 'NOT_LOGGED_IN'
  | 'TIMEOUT'
  | 'PARSE_FAILED'
  | 'TURN_FAILED'
  | 'CANCELLED'
  | 'TRANSPORT'
  /** This month's allowance is used up. The only failure a plan change fixes. */
  | 'LIMIT'
  | 'UNKNOWN'

export interface EngineFailure {
  kind: EngineErrorKind
  message: string
}

export interface RateLimitInfo {
  usedPercent?: number
  windowDurationMins?: number
  resetsAt?: string | number | null
}

// Names the rest of the app grew up with. Same shapes.
export type CodexTransport = EngineTransport
export type CodexStatus = EngineStatus
export type CodexErrorKind = EngineErrorKind
export type CodexFailure = EngineFailure

// ---------------------------------------------------------------- account

export interface AuthUser {
  id: string
  email: string
}

export interface AuthState {
  /** `unknown` only until the persisted session has been read at boot. */
  status: 'unknown' | 'signed-in' | 'signed-out'
  user: AuthUser | null
}

export const EMPTY_AUTH_STATE: AuthState = { status: 'unknown', user: null }

/**
 * Every auth command answers the same way: it worked, or here is the sentence to show.
 * `cancelled` marks the one failure that is not news — the person changed their mind.
 */
export type AuthResult =
  | { ok: true; needsConfirmation?: boolean }
  | { ok: false; error: string; cancelled?: boolean }

// ---------------------------------------------------------------- plan / usage

export type PlanId = 'free' | 'pro' | 'max'
export type SubscriptionStatus = 'none' | 'active' | 'trialing' | 'past_due' | 'canceled'

/** Counted per calendar month, UTC. */
export interface UsageCounts {
  lessons: number
  coachTurns: number
  visionCalls: number
}

export interface BillingStatus {
  plan: PlanId
  status: SubscriptionStatus
  currentPeriodEnd: string | null
  usage: UsageCounts
  /** Null on the unlimited plan — there is no meter to draw. */
  limits: UsageCounts | null
}

/** What checkout was asked for: which plan, and at which cadence. */
export type BillingPlanChoice = 'pro_monthly' | 'pro_annual' | 'max_monthly' | 'max_annual'

// ---------------------------------------------------------------- streaming events

export type GenerateEvent =
  | { opId: string; type: 'status'; message: string; transport?: EngineTransport }
  | { opId: string; type: 'delta'; text: string }
  | { opId: string; type: 'message'; text: string }
  | { opId: string; type: 'rateLimits'; rateLimits: RateLimitInfo | null; raw?: unknown }
  | { opId: string; type: 'done'; lesson: Lesson }
  | { opId: string; type: 'error'; error: EngineFailure }

export type CoachEvent =
  | { opId: string; type: 'status'; message: string; transport?: EngineTransport }
  | { opId: string; type: 'delta'; text: string }
  | { opId: string; type: 'message'; text: string }
  | { opId: string; type: 'done'; text: string }
  | { opId: string; type: 'error'; error: EngineFailure }

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
      /**
       * The one screen coordinate space this app has, per platform:
       *   win32  physical screen pixels — the same space as UIA rects and CopyFromScreen.
       *   darwin POINTS, top-left origin — the same space as AX rects, CGWindowList bounds and
       *          Electron's own DIP screen/window bounds. NOT pixels: on a Retina display a point
       *          is two pixels, and the only place the two spaces meet is the screenshot boundary
       *          (PointService multiplies/divides by the helper's `scaleFactor` there).
       */
      x: number
      y: number
      label: string
      /** `uia` means "read out of the OS accessibility tree" — UIA on win32, AX on darwin. */
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
  /** This month's looks at the screen are used up. Not a miss: nothing was even tried. */
  | { outcome: 'limit'; message: string; ms: number }
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

// ---------------------------------------------------------------- OS permissions (macOS)

/**
 * `unknown` is not "probably fine": it is the honest answer before anything has been asked, and
 * on win32 forever — Windows has no equivalent gate, so the UI that renders these never appears
 * there.
 */
export type PermissionState = 'unknown' | 'granted' | 'denied'

export interface PermissionsState {
  accessibility: PermissionState
  screenRecording: PermissionState
  /**
   * True once Screen Recording has been granted to a process that started without it. macOS does
   * not hand the grant to a running process — the app has to be relaunched — and saying so is the
   * difference between "granted, still broken" and an instruction the person can act on.
   */
  needsRelaunch: boolean
  /** False on win32: there is nothing to grant, so nothing to show. */
  supported: boolean
}

export const UNKNOWN_PERMISSIONS: PermissionsState = {
  accessibility: 'unknown',
  screenRecording: 'unknown',
  needsRelaunch: false,
  supported: false
}

/** Which of the two gates a request/deep-link is about. */
export type PermissionKey = 'accessibility' | 'screenRecording'

// ---------------------------------------------------------------- recording (authoring)

/**
 * The element under the cursor at the moment a mark was taken, straight out of the accessibility
 * tree (uia-find.ps1 -Mode from-point on win32, courseless-ax --mode at-point on darwin). `name`
 * is what the app CALLS the thing, which is exactly what a step's `target` needs to be for
 * pointing to work on someone else's machine.
 */
export interface MarkElement {
  name: string
  controlType: string
  automationId?: string
  className?: string
  /** Physical screen pixels on win32; POINTS (top-left origin) on darwin. See PointResult.x. */
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

// ---------------------------------------------------------------- curated cloud library

/**
 * One row of the shelf Courseless publishes. The lesson payload itself never crosses the bridge —
 * the renderer only needs enough to draw a row and decide whether it is already here.
 */
export interface ShelfLesson {
  /** The published slug. Stable across re-publishes, and what `library:add` is asked for. */
  id: string
  title: string
  tool: string
  /** Shelf grouping ("Excel", "Claude Code"). Shelf metadata, not part of the lesson. */
  track: string
  featured: boolean
  goal: string
  steps: number
  estMinutes: number
  /** Deterministic seed for the cover art, carried from the published lesson. */
  coverSeed: number
  /** Already in this library — the row says so instead of offering to add it twice. */
  added: boolean
}

/**
 * What the shelf looks like right now. `offline` is the honest state: the fetch failed and what
 * is in `items` is whatever was cached, which may be nothing at all.
 */
export interface ShelfResult {
  items: ShelfLesson[]
  offline: boolean
  /** When the list in hand arrived. Null when nothing ever has. */
  fetchedAt: string | null
}

/** Adding a shelf lesson runs through the same import path a dropped file does. */
export type ShelfAddResult = { ok: true; lesson: Lesson } | { ok: false; error: string }

/** Monthly or annual — what the plan cards are priced in, and what the upgrade pill buys. */
export type PlanInterval = 'monthly' | 'annual'

// ---------------------------------------------------------------- settings / float

export interface Settings {
  hotkey: string
  theme: 'light' | 'dark'
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
  /**
   * Ids of curated shelf lessons already added. The lesson itself gets a fresh uuid on import, so
   * the published slug has to be remembered here for the shelf to know what it has already given.
   */
  libraryAdded: string[]
  /** Last cadence chosen on the plan cards. The upgrade pill buys at the same one. */
  planInterval: PlanInterval
}

export const DEFAULT_SETTINGS: Settings = {
  hotkey: 'CommandOrControl+Shift+Space',
  theme: 'light',
  deletedBuiltins: [],
  onboarded: false,
  pointAsYouGo: false,
  speakSteps: false,
  stallCoach: true,
  displayName: '',
  startPinned: true,
  pinExplainerSeen: false,
  libraryAdded: [],
  planInterval: 'monthly'
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
export type Err = { ok: false; error: EngineFailure }
export type Result<T> = Ok<T> | Err

export interface OpStarted {
  opId: string
}
