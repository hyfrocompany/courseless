// Typed IPC contract. Channel names live here so main / preload / renderer cannot drift.

import type {
  AuthResult,
  AuthState,
  BillingPlanChoice,
  BillingStatus,
  CoachEvent,
  EngineStatus,
  ExportResult,
  FloatCommand,
  FloatStatus,
  GenerateEvent,
  ImportResult,
  Lesson,
  NextSuggestion,
  OpStarted,
  OverlayPoint,
  PermissionKey,
  PermissionsState,
  PointRequest,
  PointResult,
  RecordDraft,
  RecordingState,
  Result,
  RunInput,
  RunnerAction,
  RunnerState,
  Settings,
  ShelfAddResult,
  ShelfResult,
  SkillLevel,
  StepContext,
  WinCommand
} from './types'

export const IPC = {
  // engine
  engineStatus: 'engine:status',
  engineGenerate: 'engine:generate',
  engineGenerateEvent: 'engine:generate:event',
  engineCoach: 'engine:coach',
  engineCoachEvent: 'engine:coach:event',
  engineSuggestNext: 'engine:suggest-next',
  engineCancel: 'engine:cancel',

  // account
  /** The primary way in: pair with the browser, come back signed in. */
  authBrowserSignIn: 'auth:browser-sign-in',
  authBrowserCancel: 'auth:browser-cancel',
  authSignIn: 'auth:sign-in',
  authSignUp: 'auth:sign-up',
  authSignOut: 'auth:sign-out',
  authResetPassword: 'auth:reset-password',
  authGetState: 'auth:get-state',
  /** main -> every window, whenever the session appears, refreshes or goes away */
  authStateEvent: 'auth:state',

  // plan
  billingStatus: 'billing:status',
  billingCheckout: 'billing:checkout',
  billingPortal: 'billing:portal',

  // lessons
  lessonsList: 'lessons:list',
  lessonsGet: 'lessons:get',
  lessonsSave: 'lessons:save',
  lessonsDelete: 'lessons:delete',
  lessonsSaveRun: 'lessons:save-run',
  lessonsExport: 'lessons:export',
  lessonsImport: 'lessons:import',
  lessonsDuplicate: 'lessons:duplicate',

  // curated cloud library (the shelf Courseless publishes)
  libraryShelf: 'library:shelf',
  libraryAdd: 'library:add',

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

  // OS permissions (macOS; on win32 these answer "nothing to grant")
  permissionsGet: 'permissions:get',
  permissionsRequest: 'permissions:request',
  permissionsOpenSettings: 'permissions:open-settings',

  // settings / misc
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  appInfo: 'app:info',

  // background updates
  updateGetState: 'update:get-state',
  /** main -> every window, whenever the background update changes phase */
  updateStateEvent: 'update:state',
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
  /** False when this build has no coach service behind it — the account screens say so. */
  backendConfigured: boolean
  /** process.platform, so the renderer can stop guessing from a deprecated navigator field. */
  platform: string
}

/**
 * Where the silent background update has got to. `ready` means a new version is on disk and will
 * be in place the next time the app starts — there is nothing for anyone to click.
 */
export interface UpdateState {
  status: 'idle' | 'checking' | 'downloading' | 'ready'
  /** The version being fetched, or the one waiting. Null when there is nothing in flight. */
  version: string | null
}

/** The surface exposed on window.courseless by the preload script. */
export interface CourselessApi {
  engineStatus(force?: boolean): Promise<EngineStatus>
  generateLesson(ask: string, level: SkillLevel): Promise<OpStarted>
  onGenerateEvent(cb: (e: GenerateEvent) => void): () => void
  coachSend(lessonId: string, message: string, stepContext: StepContext | null): Promise<OpStarted>
  onCoachEvent(cb: (e: CoachEvent) => void): () => void
  suggestNext(lessonId: string, runStats: unknown): Promise<Result<NextSuggestion>>
  cancel(opId: string): Promise<boolean>

  /**
   * The account. Tokens never cross this bridge: the renderer sends an address and a password,
   * and gets back either "done" or the sentence to show. The session itself lives in main.
   */
  auth: {
    /**
     * The way in: Courseless pairs with a browser tab, opens it, and waits. Resolves only when
     * the handoff finishes, is cancelled, or times out — up to five minutes.
     */
    browserSignIn(): Promise<AuthResult>
    /** Stop waiting. The pending `browserSignIn` resolves as cancelled. */
    cancelBrowserSignIn(): Promise<void>
    signIn(email: string, password: string): Promise<AuthResult>
    signUp(email: string, password: string): Promise<AuthResult>
    signOut(): Promise<AuthResult>
    resetPassword(email: string): Promise<AuthResult>
    getState(): Promise<AuthState>
    onState(cb: (s: AuthState) => void): () => void
  }

  /** Plan and usage. `checkout` and `portal` open the page in the system browser. */
  billing: {
    status(): Promise<Result<BillingStatus>>
    checkout(plan: BillingPlanChoice): Promise<Result<true>>
    portal(): Promise<Result<true>>
  }

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
   * The shelf Courseless publishes. Read straight from the public catalogue — no session, no
   * engine — and cached in main for ten minutes, so opening the Library is free.
   */
  library: {
    /** `force` skips the cache. Offline answers with the last list and says so. */
    shelf(force?: boolean): Promise<ShelfResult>
    /** Add one shelf lesson to this machine, through the ordinary import path. */
    add(id: string): Promise<ShelfAddResult>
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

  /**
   * The two macOS gates pointing needs. Cheap enough to poll (~1s) while a surface that shows
   * them is visible; on win32 every call answers `supported: false` and nothing renders.
   */
  permissions: {
    get(): Promise<PermissionsState>
    /**
     * Ask the OS once. macOS shows its own dialog the FIRST time and silently ignores every
     * later request, so after that this falls through to opening System Settings.
     */
    request(which: PermissionKey): Promise<PermissionsState>
    /** Open the System Settings pane for one of the two gates. */
    openSettings(which: PermissionKey): Promise<boolean>
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

  /**
   * The background updater, read-only on purpose: nothing in the UI may trigger a check, a
   * download or a restart. About shows a line when a build is staged, and that is the whole
   * surface.
   */
  update: {
    getState(): Promise<UpdateState>
    onState(cb: (s: UpdateState) => void): () => void
  }

  appInfo(): Promise<AppInfo>
  /** Open the lessons/settings folder in the OS file manager. */
  openDataDir(): Promise<boolean>
  /** verification-harness only — rejects unless the app was started with COURSELESS_REMOTE_DEBUG */
  trayInvoke(label: string): Promise<boolean>
}
