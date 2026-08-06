// Typed IPC contract. Channel names live here so main / preload / renderer cannot drift.

import type {
  CodexStatus,
  CoachEvent,
  ExportResult,
  FloatCommand,
  FloatStatus,
  GenerateEvent,
  ImportResult,
  Lesson,
  NextSuggestion,
  OpStarted,
  OverlayPoint,
  PointRequest,
  PointResult,
  RecordDraft,
  RecordingState,
  Result,
  RunInput,
  RunnerAction,
  RunnerState,
  Settings,
  SkillLevel,
  StepContext,
  WinCommand
} from './types'

export const IPC = {
  // codex
  codexStatus: 'codex:status',
  codexGenerate: 'codex:generate',
  codexGenerateEvent: 'codex:generate:event',
  codexCoach: 'codex:coach',
  codexCoachEvent: 'codex:coach:event',
  codexSuggestNext: 'codex:suggest-next',
  codexCancel: 'codex:cancel',

  // lessons
  lessonsList: 'lessons:list',
  lessonsGet: 'lessons:get',
  lessonsSave: 'lessons:save',
  lessonsDelete: 'lessons:delete',
  lessonsSaveRun: 'lessons:save-run',
  lessonsExport: 'lessons:export',
  lessonsImport: 'lessons:import',
  lessonsDuplicate: 'lessons:duplicate',

  // recording (authoring)
  recordStart: 'record:start',
  recordMark: 'record:mark',
  recordNote: 'record:note',
  recordUndo: 'record:undo',
  recordStop: 'record:stop',
  recordCancel: 'record:cancel',
  recordGetState: 'record:get-state',
  /** main -> every window, on every recording change */
  recordStateEvent: 'record:state',
  /** pill -> main: the card grew or shrank, so the window must follow */
  recordPillHeight: 'record:pill-height',
  /** main -> main window: "open the start-a-recording dialog" (the tray asked) */
  recordInvite: 'record:invite',
  recordDrafts: 'record:drafts',
  recordDraftRetry: 'record:draft-retry',
  recordDraftDelete: 'record:draft-delete',

  // float + runner sync
  floatControl: 'float:control',
  /** float -> main: the widget wants to be taller (coach open) or shorter again */
  floatResize: 'float:resize',
  runnerSetState: 'runner:set-state',
  runnerGetState: 'runner:get-state',
  runnerStateEvent: 'runner:state',
  runnerSendAction: 'runner:send-action',
  runnerActionEvent: 'runner:action',

  // custom title bar (main window only)
  winControl: 'win:control',
  winState: 'win:state',

  // guided pointing
  pointShow: 'point:show',
  pointDismiss: 'point:dismiss',
  /** main -> overlay renderer */
  overlayPoint: 'overlay:point',
  overlayDismiss: 'overlay:dismiss',

  // settings / misc
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  appInfo: 'app:info',
  openDataDir: 'app:open-data-dir',
  /** verification-harness only; registered when COURSELESS_REMOTE_DEBUG is set */
  trayInvoke: 'app:tray-invoke'
} as const

export interface AppInfo {
  userDataPath: string
  lessonsPath: string
  logPath: string
  version: string
  isDev: boolean
  /** COURSELESS_STALL_MS — debug override for the stall-coach threshold. */
  stallMsOverride: number | null
}

/** The surface exposed on window.courseless by the preload script. */
export interface CourselessApi {
  codexStatus(force?: boolean): Promise<CodexStatus>
  generateLesson(ask: string, level: SkillLevel): Promise<OpStarted>
  onGenerateEvent(cb: (e: GenerateEvent) => void): () => void
  coachSend(lessonId: string, message: string, stepContext: StepContext | null): Promise<OpStarted>
  onCoachEvent(cb: (e: CoachEvent) => void): () => void
  suggestNext(lessonId: string, runStats: unknown): Promise<Result<NextSuggestion>>
  cancel(opId: string): Promise<boolean>

  lessons: {
    list(): Promise<Lesson[]>
    get(id: string): Promise<Lesson | null>
    save(lesson: Lesson): Promise<Lesson>
    delete(id: string): Promise<boolean>
    saveRun(lessonId: string, run: RunInput): Promise<Lesson | null>
    /** Save dialog -> <slug>.courseless.json. Runs, thread and library flags never leave. */
    export(id: string): Promise<ExportResult>
    /**
     * Bring a lesson in. With no argument this opens a file dialog; `text` is the drag-drop path
     * (the renderer read the dropped file itself, so no path ever crosses the bridge).
     */
    import(payload?: { text: string; name?: string }): Promise<ImportResult>
    /** Copy any lesson to a fresh, editable one of your own. */
    duplicate(id: string): Promise<Lesson | null>
  }

  /**
   * Recording a walkthrough. Marks are captured in the main process (they need the OS), and the
   * state is broadcast so the pill window and the main window always agree.
   */
  record: {
    start(name: string, audience: string): Promise<RecordingState>
    mark(): Promise<RecordingState>
    note(text: string): Promise<RecordingState>
    undo(): Promise<RecordingState>
    /** Stops and compiles. The lesson arrives on the normal generate stream. */
    stop(): Promise<RecordingState>
    cancel(): Promise<RecordingState>
    getState(): Promise<RecordingState>
    onState(cb: (s: RecordingState) => void): () => void
    /** The tray asked for a recording — the main window opens the start dialog. */
    onInvite(cb: () => void): () => void
    /** Pill window only: ask for a different window height as the card grows. */
    pillHeight(height: number): Promise<void>
    drafts(): Promise<RecordDraft[]>
    retryDraft(id: string): Promise<RecordingState>
    deleteDraft(id: string): Promise<boolean>
  }

  floatControl(cmd: FloatCommand): Promise<FloatStatus>
  /**
   * Float window only: ask for a taller (or shorter) widget. Width never changes. Clamped to
   * the widget's own range in main, which also decides whether it grows down or up.
   */
  floatResize(height: number): Promise<FloatStatus>

  /**
   * Custom title bar. Only the main window may drive this — the float window is frameless and
   * the handler ignores it. Resolves to `isMaximized` *after* the command ran.
   */
  winControl(cmd: WinCommand): Promise<boolean>
  /** Fires whenever the main window is maximized / unmaximized. */
  onWinState(cb: (isMaximized: boolean) => void): () => void

  point: {
    /**
     * Ground the step's target and, on success, fly the ghost cursor to it.
     * Resolves with the outcome so the caller can show an honest miss instead of a fake point.
     */
    show(req: PointRequest): Promise<PointResult>
    /** Take the overlay down (step change, Esc, float dismiss). */
    dismiss(): Promise<void>
    /** Overlay window only: the next place to fly to. */
    onOverlayPoint(cb: (p: OverlayPoint) => void): () => void
    onOverlayDismiss(cb: () => void): () => void
  }

  runner: {
    setState(state: RunnerState): Promise<void>
    getState(): Promise<RunnerState>
    onState(cb: (s: RunnerState) => void): () => void
    sendAction(action: RunnerAction): Promise<void>
    onAction(cb: (a: RunnerAction) => void): () => void
  }

  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
    /** Fires in every window whenever settings change (the main process already broadcasts them). */
    onChange(cb: (s: Settings) => void): () => void
  }

  appInfo(): Promise<AppInfo>
  /** Open the lessons/settings folder in the OS file manager. */
  openDataDir(): Promise<boolean>
  /** verification-harness only — rejects unless the app was started with COURSELESS_REMOTE_DEBUG */
  trayInvoke(label: string): Promise<boolean>
}
