// contextBridge surface. contextIsolation: true, nodeIntegration: false, sandbox: true.
// The renderer gets exactly this object on window.courseless and nothing else.

import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type AppInfo, type CourselessApi, type UpdateState } from '../shared/ipc'
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
} from '../shared/types'

/** Subscribe and hand back an unsubscribe function (renderer must be able to clean up). */
function sub<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: CourselessApi = {
  engineStatus: (force?: boolean) => ipcRenderer.invoke(IPC.engineStatus, force) as Promise<EngineStatus>,

  generateLesson: (ask: string, level: SkillLevel) =>
    ipcRenderer.invoke(IPC.engineGenerate, { ask, level }) as Promise<{ opId: string }>,
  onGenerateEvent: (cb: (e: GenerateEvent) => void) => sub<GenerateEvent>(IPC.engineGenerateEvent, cb),

  coachSend: (lessonId: string, message: string, stepContext: StepContext | null) =>
    ipcRenderer.invoke(IPC.engineCoach, { lessonId, message, stepContext }) as Promise<{ opId: string }>,
  onCoachEvent: (cb: (e: CoachEvent) => void) => sub<CoachEvent>(IPC.engineCoachEvent, cb),

  suggestNext: (lessonId: string, runStats: unknown) =>
    ipcRenderer.invoke(IPC.engineSuggestNext, { lessonId, runStats }) as Promise<Result<NextSuggestion>>,

  cancel: (opId: string) => ipcRenderer.invoke(IPC.engineCancel, opId) as Promise<boolean>,

  // Credentials go up, an answer comes back. No token is ever exposed on this bridge.
  auth: {
    browserSignIn: () => ipcRenderer.invoke(IPC.authBrowserSignIn) as Promise<AuthResult>,
    cancelBrowserSignIn: () => ipcRenderer.invoke(IPC.authBrowserCancel) as Promise<void>,
    signIn: (email: string, password: string) =>
      ipcRenderer.invoke(IPC.authSignIn, { email, password }) as Promise<AuthResult>,
    signUp: (email: string, password: string) =>
      ipcRenderer.invoke(IPC.authSignUp, { email, password }) as Promise<AuthResult>,
    signOut: () => ipcRenderer.invoke(IPC.authSignOut) as Promise<AuthResult>,
    resetPassword: (email: string) => ipcRenderer.invoke(IPC.authResetPassword, email) as Promise<AuthResult>,
    getState: () => ipcRenderer.invoke(IPC.authGetState) as Promise<AuthState>,
    onState: (cb: (s: AuthState) => void) => sub<AuthState>(IPC.authStateEvent, cb)
  },

  billing: {
    status: () => ipcRenderer.invoke(IPC.billingStatus) as Promise<Result<BillingStatus>>,
    checkout: (plan: BillingPlanChoice) => ipcRenderer.invoke(IPC.billingCheckout, plan) as Promise<Result<true>>,
    portal: () => ipcRenderer.invoke(IPC.billingPortal) as Promise<Result<true>>
  },

  lessons: {
    list: () => ipcRenderer.invoke(IPC.lessonsList) as Promise<Lesson[]>,
    get: (id: string) => ipcRenderer.invoke(IPC.lessonsGet, id) as Promise<Lesson | null>,
    save: (lesson: Lesson) => ipcRenderer.invoke(IPC.lessonsSave, lesson) as Promise<Lesson>,
    delete: (id: string) => ipcRenderer.invoke(IPC.lessonsDelete, id) as Promise<boolean>,
    saveRun: (lessonId: string, run: RunInput) =>
      ipcRenderer.invoke(IPC.lessonsSaveRun, { lessonId, run }) as Promise<Lesson | null>,
    export: (id: string) => ipcRenderer.invoke(IPC.lessonsExport, id) as Promise<ExportResult>,
    import: (payload?: { text: string; name?: string }) =>
      ipcRenderer.invoke(IPC.lessonsImport, payload) as Promise<ImportResult>,
    duplicate: (id: string) => ipcRenderer.invoke(IPC.lessonsDuplicate, id) as Promise<Lesson | null>
  },

  library: {
    shelf: (force?: boolean) => ipcRenderer.invoke(IPC.libraryShelf, force) as Promise<ShelfResult>,
    add: (id: string) => ipcRenderer.invoke(IPC.libraryAdd, id) as Promise<ShelfAddResult>
  },

  record: {
    start: (name: string, audience: string) =>
      ipcRenderer.invoke(IPC.recordStart, { name, audience }) as Promise<RecordingState>,
    mark: () => ipcRenderer.invoke(IPC.recordMark) as Promise<RecordingState>,
    note: (text: string) => ipcRenderer.invoke(IPC.recordNote, text) as Promise<RecordingState>,
    undo: () => ipcRenderer.invoke(IPC.recordUndo) as Promise<RecordingState>,
    stop: () => ipcRenderer.invoke(IPC.recordStop) as Promise<RecordingState>,
    cancel: () => ipcRenderer.invoke(IPC.recordCancel) as Promise<RecordingState>,
    getState: () => ipcRenderer.invoke(IPC.recordGetState) as Promise<RecordingState>,
    onState: (cb: (s: RecordingState) => void) => sub<RecordingState>(IPC.recordStateEvent, cb),
    onInvite: (cb: () => void) => sub<null>(IPC.recordInvite, () => cb()),
    pillHeight: (height: number) => ipcRenderer.invoke(IPC.recordPillHeight, height) as Promise<void>,
    drafts: () => ipcRenderer.invoke(IPC.recordDrafts) as Promise<RecordDraft[]>,
    retryDraft: (id: string) => ipcRenderer.invoke(IPC.recordDraftRetry, id) as Promise<RecordingState>,
    deleteDraft: (id: string) => ipcRenderer.invoke(IPC.recordDraftDelete, id) as Promise<boolean>
  },

  floatControl: (cmd: FloatCommand) => ipcRenderer.invoke(IPC.floatControl, cmd) as Promise<FloatStatus>,
  floatResize: (height: number) => ipcRenderer.invoke(IPC.floatResize, height) as Promise<FloatStatus>,

  winControl: (cmd: WinCommand) => ipcRenderer.invoke(IPC.winControl, cmd) as Promise<boolean>,
  onWinState: (cb: (isMaximized: boolean) => void) => sub<boolean>(IPC.winState, cb),

  point: {
    show: (req: PointRequest) => ipcRenderer.invoke(IPC.pointShow, req) as Promise<PointResult>,
    dismiss: () => ipcRenderer.invoke(IPC.pointDismiss) as Promise<void>,
    onOverlayPoint: (cb: (p: OverlayPoint) => void) => sub<OverlayPoint>(IPC.overlayPoint, cb),
    onOverlayDismiss: (cb: () => void) => sub<null>(IPC.overlayDismiss, () => cb())
  },

  permissions: {
    get: () => ipcRenderer.invoke(IPC.permissionsGet) as Promise<PermissionsState>,
    request: (which: PermissionKey) =>
      ipcRenderer.invoke(IPC.permissionsRequest, which) as Promise<PermissionsState>,
    openSettings: (which: PermissionKey) =>
      ipcRenderer.invoke(IPC.permissionsOpenSettings, which) as Promise<boolean>
  },

  runner: {
    setState: (state: RunnerState) => ipcRenderer.invoke(IPC.runnerSetState, state) as Promise<void>,
    getState: () => ipcRenderer.invoke(IPC.runnerGetState) as Promise<RunnerState>,
    onState: (cb: (s: RunnerState) => void) => sub<RunnerState>(IPC.runnerStateEvent, cb),
    sendAction: (action: RunnerAction) => ipcRenderer.invoke(IPC.runnerSendAction, action) as Promise<void>,
    onAction: (cb: (a: RunnerAction) => void) => sub<RunnerAction>(IPC.runnerActionEvent, cb)
  },

  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet) as Promise<Settings>,
    set: (patch: Partial<Settings>) => ipcRenderer.invoke(IPC.settingsSet, patch) as Promise<Settings>,
    // main broadcasts the new settings on the same channel after every set — this lets the float
    // window follow the theme without a second IPC surface.
    onChange: (cb: (s: Settings) => void) => sub<Settings>(IPC.settingsGet, cb)
  },

  update: {
    getState: () => ipcRenderer.invoke(IPC.updateGetState) as Promise<UpdateState>,
    onState: (cb: (s: UpdateState) => void) => sub<UpdateState>(IPC.updateStateEvent, cb)
  },

  appInfo: () => ipcRenderer.invoke(IPC.appInfo) as Promise<AppInfo>,

  openDataDir: () => ipcRenderer.invoke(IPC.openDataDir) as Promise<boolean>,

  trayInvoke: (label: string) => ipcRenderer.invoke(IPC.trayInvoke, label) as Promise<boolean>
}

contextBridge.exposeInMainWorld('courseless', api)
