// All ipcMain handlers. Renderer never touches node/electron directly.

import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { IPC, type AppInfo } from '../shared/ipc'
import { ANON_AUTHOR, buildLessonFile, exportFileName, validateLessonFile } from '../shared/lessonFile'
import {
  EMPTY_RUNNER_STATE,
  type CoachEvent,
  type ExportResult,
  type FloatCommand,
  type GenerateEvent,
  type ImportResult,
  type Lesson,
  type PointRequest,
  type PointResult,
  type RecordMark,
  type Result,
  type RunInput,
  type RunnerAction,
  type RunnerState,
  type Settings,
  type SkillLevel,
  type StepContext,
  type WinCommand
} from '../shared/types'
import { CodexService, toFailure } from './services/CodexService'
import type { LessonStore } from './services/LessonStore'
import type { PointService } from './services/PointService'
import type { RecordService } from './services/RecordService'
import type { SettingsStore } from './services/SettingsStore'
import { log } from './util/log'
import {
  broadcast,
  closeRecordPill,
  floatControl,
  floatResize,
  getFloatWindow,
  getMainWindow,
  getRecordWindow,
  invokeTrayMenuItem,
  overlayDismiss,
  overlayShow,
  recordPillResize,
  showMainWindow,
  showRecordPill
} from './windows'

let runnerState: RunnerState = { ...EMPTY_RUNNER_STATE }

export function getRunnerState(): RunnerState {
  return runnerState
}

export interface IpcContext {
  codex: CodexService
  lessons: LessonStore
  settings: SettingsStore
  point: PointService
  record: RecordService
  appInfo: AppInfo
  onHotkeyChange(hotkey: string): void
  /** Ctrl+Shift+M exists only while a recording is running. */
  setMarkShortcut(on: boolean): void
}

function sendToOthers(event: IpcMainInvokeEvent, channel: string, payload: unknown): void {
  const senderId = event.sender.id
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    if (win.webContents.id === senderId) continue
    win.webContents.send(channel, payload)
  }
}

export function registerIpc(ctx: IpcContext): void {
  const { codex, lessons, settings } = ctx

  // ---------------------------------------------------------------- codex
  ipcMain.handle(IPC.codexStatus, async (_e, force?: boolean) => codex.detectStatus(!!force))

  ipcMain.handle(
    IPC.codexGenerate,
    async (_e, args: { ask: string; level: SkillLevel }): Promise<{ opId: string }> => {
      const opId = randomUUID()
      const emit = (evt: GenerateEvent): void => broadcast(IPC.codexGenerateEvent, evt)
      log('ipc', 'generate', opId, args.ask.slice(0, 120), args.level)

      void (async () => {
        try {
          const lesson = await codex.generateLesson(args.ask, args.level, opId, {
            onDelta: (text) => emit({ opId, type: 'delta', text }),
            onStatus: (message, transport) => emit({ opId, type: 'status', message, transport }),
            onMessage: (text) => emit({ opId, type: 'message', text })
          })
          const saved = lessons.save(lesson)
          emit({ opId, type: 'done', lesson: saved })
        } catch (e) {
          const error = toFailure(e)
          log('ipc', 'generate failed', opId, error.kind, error.message.slice(0, 300))
          emit({ opId, type: 'error', error })
        }
      })()

      return { opId }
    }
  )

  ipcMain.handle(
    IPC.codexCoach,
    async (
      _e,
      args: { lessonId: string; message: string; stepContext: StepContext | null }
    ): Promise<{ opId: string }> => {
      const opId = randomUUID()
      const emit = (evt: CoachEvent): void => broadcast(IPC.codexCoachEvent, evt)
      const lesson = lessons.get(args.lessonId)
      if (!lesson) {
        setTimeout(
          () => emit({ opId, type: 'error', error: { kind: 'UNKNOWN', message: 'Lesson not found.' } }),
          0
        )
        return { opId }
      }
      log('ipc', 'coach', opId, args.lessonId, args.message.slice(0, 120))

      void (async () => {
        try {
          const res = await codex.coach(lesson, args.message, args.stepContext, opId, {
            onDelta: (text) => emit({ opId, type: 'delta', text }),
            onStatus: (message, transport) => emit({ opId, type: 'status', message, transport })
          })
          // keep the thread id fresh (a fallback turn may have created a new one)
          if (res.threadId && res.threadId !== lesson.codexThreadId) {
            lessons.save({ ...lesson, codexThreadId: res.threadId })
          }
          emit({ opId, type: 'done', text: res.text })
        } catch (e) {
          const error = toFailure(e)
          log('ipc', 'coach failed', opId, error.kind, error.message.slice(0, 300))
          emit({ opId, type: 'error', error })
        }
      })()

      return { opId }
    }
  )

  ipcMain.handle(
    IPC.codexSuggestNext,
    async (_e, args: { lessonId: string; runStats: unknown }): Promise<Result<{ title: string; ask: string }>> => {
      const lesson = lessons.get(args.lessonId)
      if (!lesson) return { ok: false, error: { kind: 'UNKNOWN', message: 'Lesson not found.' } }
      try {
        const value = await codex.suggestNext(lesson, args.runStats, randomUUID())
        return { ok: true, value }
      } catch (e) {
        return { ok: false, error: toFailure(e) }
      }
    }
  )

  ipcMain.handle(IPC.codexCancel, async (_e, opId: string) => codex.cancel(opId))

  // ---------------------------------------------------------------- lessons
  ipcMain.handle(IPC.lessonsList, async () => lessons.list())
  ipcMain.handle(IPC.lessonsGet, async (_e, id: string) => lessons.get(id))
  ipcMain.handle(IPC.lessonsSave, async (_e, lesson: Lesson) => lessons.save(lesson))
  ipcMain.handle(IPC.lessonsDelete, async (_e, id: string) => lessons.delete(id))
  ipcMain.handle(IPC.lessonsSaveRun, async (_e, args: { lessonId: string; run: RunInput }) =>
    lessons.saveRun(args.lessonId, args.run)
  )

  // ---------------------------------------------------------------- share / import
  //
  // The file dialogs live here rather than in the renderer because the renderer never sees a
  // filesystem path: it asks for "export this lesson" and gets back where it went.

  ipcMain.handle(IPC.lessonsExport, async (event, id: string): Promise<ExportResult> => {
    const lesson = lessons.get(id)
    if (!lesson) return { ok: false, error: 'That lesson is no longer here.' }
    const sender = BrowserWindow.fromWebContents(event.sender)
    const file = buildLessonFile(lesson, settings.get().displayName ?? '')
    const picked = await dialog.showSaveDialog(sender ?? getMainWindow()!, {
      title: 'Share this lesson',
      defaultPath: exportFileName(lesson),
      filters: [{ name: 'Courseless lesson', extensions: ['json'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    if (picked.canceled || !picked.filePath) return { ok: false, cancelled: true }
    try {
      writeFileSync(picked.filePath, JSON.stringify(file, null, 2), 'utf8')
      log('ipc', 'exported', id, picked.filePath, `authoredBy=${file.authoredBy}`)
      return { ok: true, path: picked.filePath }
    } catch (e) {
      log('ipc', 'export failed', String(e).slice(0, 200))
      return { ok: false, error: `Could not write the file: ${String(e).slice(0, 160)}` }
    }
  })

  ipcMain.handle(
    IPC.lessonsImport,
    async (event, payload?: { text: string; name?: string }): Promise<ImportResult> => {
      let text = payload?.text
      let name = payload?.name ?? 'the dropped file'
      if (typeof text !== 'string') {
        const sender = BrowserWindow.fromWebContents(event.sender)
        const picked = await dialog.showOpenDialog(sender ?? getMainWindow()!, {
          title: 'Open a shared lesson',
          filters: [{ name: 'Courseless lesson', extensions: ['json'] }],
          properties: ['openFile']
        })
        if (picked.canceled || picked.filePaths.length === 0) return { ok: false, cancelled: true }
        name = basename(picked.filePaths[0])
        try {
          text = readFileSync(picked.filePaths[0], 'utf8')
        } catch (e) {
          return { ok: false, error: `Could not read ${name}: ${String(e).slice(0, 140)}`, file: name }
        }
      }

      const check = validateLessonFile(text)
      if (!check.ok) {
        log('ipc', 'import rejected', name, check.error)
        return { ok: false, error: check.error, file: name }
      }

      // A new id, always: importing the same file twice gives two lessons, and importing a
      // lesson you already have never overwrites the runs you did on your own copy.
      const now = new Date().toISOString()
      const imported: Lesson = {
        ...check.file.lesson,
        id: randomUUID(),
        runs: [],
        codexThreadId: null,
        importedFrom: check.file.authoredBy || ANON_AUTHOR,
        importedAt: now
      }
      const saved = lessons.save(imported)
      log('ipc', 'imported', saved.id, saved.title, `from=${saved.importedFrom}`, `file=${name}`)
      return { ok: true, lesson: saved, authoredBy: saved.importedFrom ?? ANON_AUTHOR }
    }
  )

  ipcMain.handle(IPC.lessonsDuplicate, async (_e, id: string): Promise<Lesson | null> => {
    const source = lessons.get(id)
    if (!source) return null
    const copy: Lesson = {
      ...source,
      id: randomUUID(),
      title: `${source.title} (your copy)`,
      createdAt: new Date().toISOString(),
      runs: [],
      // A copy is yours: it is not a starter lesson, it is not featured, and it does not share
      // the original's engine thread.
      builtin: false,
      featured: false,
      codexThreadId: null,
      version: 1
    }
    delete copy.track
    const saved = lessons.save(copy)
    log('ipc', 'duplicated', id, '->', saved.id)
    return saved
  })

  // ---------------------------------------------------------------- recording
  //
  // Marks are captured in the main process because they come from the OS, and the state is
  // broadcast because two windows render it (the pill, and the main window's own banner).

  /** Stop -> compile -> save. Emits on the ORDINARY generate stream, so the Generating screen,
   *  its cancel button and its error state all work unchanged. */
  const compile = async (session: {
    id: string
    name: string
    audience: string
    marks: RecordMark[]
  }): Promise<void> => {
    const opId = randomUUID()
    const emit = (evt: GenerateEvent): void => broadcast(IPC.codexGenerateEvent, evt)
    ctx.record.compiling(opId)
    log('ipc', 'compiling recording', session.id, `${session.marks.length} marks`)
    try {
      const lesson = await codex.compileRecording(session, opId, {
        onDelta: (text) => emit({ opId, type: 'delta', text }),
        onStatus: (message, transport) => emit({ opId, type: 'status', message, transport }),
        onMessage: (text) => emit({ opId, type: 'message', text })
      })
      const saved = lessons.save(lesson)
      ctx.record.deleteDraft(session.id)
      ctx.record.finish()
      emit({ opId, type: 'done', lesson: saved })
    } catch (e) {
      const error = toFailure(e)
      // The marks are the part that cannot be redone — they are kept no matter what failed.
      const draft = ctx.record.saveDraft(session, error.message)
      ctx.record.failed(error.message)
      log('ipc', 'compile failed — marks kept as draft', draft.id, error.kind, error.message.slice(0, 200))
      emit({
        opId,
        type: 'error',
        error: {
          kind: error.kind,
          message:
            error.kind === 'CANCELLED'
              ? error.message
              : `${error.message} — your ${session.marks.length} marks are safe; try again from the Library.`
        }
      })
    }
  }

  ipcMain.handle(IPC.recordStart, async (_e, args: { name: string; audience: string }) => {
    const state = ctx.record.start(args.name, args.audience)
    if (state.phase === 'recording') {
      ctx.setMarkShortcut(true)
      showRecordPill()
      // The window gets out of the way: the author is about to work in another app.
      getMainWindow()?.minimize()
    }
    return state
  })

  ipcMain.handle(IPC.recordMark, async () => ctx.record.mark())
  ipcMain.handle(IPC.recordNote, async (_e, text: string) => {
    const state = ctx.record.note(text)
    // Typing a note means clicking the pill, which pulls focus out of the app being recorded.
    // Hand it straight back: the author is mid-task, and the next thing they do is not here.
    getRecordWindow()?.blur()
    return state
  })
  ipcMain.handle(IPC.recordUndo, async () => ctx.record.undo())
  ipcMain.handle(IPC.recordGetState, async () => ctx.record.getState())
  ipcMain.handle(IPC.recordPillHeight, async (_e, height: number) => recordPillResize(height))

  ipcMain.handle(IPC.recordStop, async () => {
    const session = ctx.record.takeForCompile()
    ctx.setMarkShortcut(false)
    closeRecordPill()
    if (!session) return ctx.record.getState()
    showMainWindow()
    if (session.marks.length === 0) {
      // Nothing was marked, so there is nothing to compile and nothing to apologise for.
      log('ipc', 'recording stopped with no marks')
      return ctx.record.cancel()
    }
    const state = ctx.record.compiling('pending')
    void compile(session)
    return state
  })

  ipcMain.handle(IPC.recordCancel, async () => {
    ctx.setMarkShortcut(false)
    closeRecordPill()
    const had = ctx.record.getState().marks.length
    const state = ctx.record.cancel()
    if (had) log('ipc', 'recording cancelled', `${had} marks discarded`)
    showMainWindow()
    return state
  })

  ipcMain.handle(IPC.recordDrafts, async () => ctx.record.drafts())
  ipcMain.handle(IPC.recordDraftDelete, async (_e, id: string) => ctx.record.deleteDraft(id))
  ipcMain.handle(IPC.recordDraftRetry, async (_e, id: string) => {
    const draft = ctx.record.getDraft(id)
    if (!draft) return ctx.record.getState()
    const state = ctx.record.resume(draft)
    void compile({ id: draft.id, name: draft.name, audience: draft.audience, marks: draft.marks })
    return state
  })

  // ---------------------------------------------------------------- float + runner sync
  ipcMain.handle(IPC.floatControl, async (_e, cmd: FloatCommand) => floatControl(cmd))

  // Only the widget may resize the widget. Same identity rule as the title bar, for the same
  // reason: a window that can resize another window is a bug waiting for a sender to get it wrong.
  ipcMain.handle(IPC.floatResize, async (event, height: number) => {
    const sender = BrowserWindow.fromWebContents(event.sender)
    const float = getFloatWindow()
    if (!sender || !float || sender.id !== float.id) {
      log('ipc', 'floatResize refused (not the float window)', height)
      return floatControl('status')
    }
    return floatResize(height)
  })

  ipcMain.handle(IPC.runnerSetState, async (event, state: RunnerState) => {
    runnerState = state
    sendToOthers(event, IPC.runnerStateEvent, state)
  })
  ipcMain.handle(IPC.runnerGetState, async () => runnerState)
  ipcMain.handle(IPC.runnerSendAction, async (event, action: RunnerAction) => {
    log('ipc', 'runner action', action.type, 'from', action.source)
    // The float's expand button means "take me back to the window" — only the main process can
    // raise it, so the window work happens here. It is still forwarded: the runner's pin button
    // reads its own state, and a button reading "Pinned" over a hidden widget is a lie.
    if (action.type === 'close' && action.source === 'float') {
      floatControl('close')
      showMainWindow()
    }
    // "Continue in window" is the same raise PLUS a renderer instruction (open the drawer), so it
    // does both: main moves the windows, the renderer opens the coach on the thread it already has.
    if (action.type === 'coach-open' && action.source === 'float') {
      floatControl('close')
      showMainWindow()
    }
    sendToOthers(event, IPC.runnerActionEvent, action)
  })

  // ---------------------------------------------------------------- custom title bar
  // Only the main window owns a title bar. The float widget is frameless and always-on-top;
  // letting it minimize/close "the window" would be a bug waiting to happen, so it is refused
  // by identity (sender must BE the main window, not merely a window).
  ipcMain.handle(IPC.winControl, async (event, cmd: WinCommand): Promise<boolean> => {
    const sender = BrowserWindow.fromWebContents(event.sender)
    const main = getMainWindow()
    if (!sender || !main || sender.id !== main.id) {
      log('ipc', 'winControl refused (not the main window)', cmd)
      return false
    }
    switch (cmd) {
      case 'minimize':
        sender.minimize()
        break
      case 'restore':
        // Pinning minimizes this window; finishing a run, or expanding out of the float, has to
        // bring it back. show()+focus() after restore() so it comes back in front, not just alive.
        if (sender.isMinimized()) sender.restore()
        sender.show()
        sender.focus()
        break
      case 'maximize':
        if (sender.isMaximized()) sender.unmaximize()
        else sender.maximize()
        break
      case 'close':
        sender.close()
        return false
      case 'query':
        break
    }
    if (sender.isDestroyed()) return false
    if (cmd !== 'query') {
      log('ipc', 'winControl', cmd, {
        maximized: sender.isMaximized(),
        minimized: sender.isMinimized()
      })
    }
    return sender.isMaximized()
  })

  // ---------------------------------------------------------------- guided pointing
  //
  // One point at a time, and only the newest one is allowed to reach the screen: a learner who
  // hammers "Show me" must never get an old step's coordinates flying in after the new step's.
  let pointSerial = 0
  ipcMain.handle(IPC.pointShow, async (_e, req: PointRequest): Promise<PointResult> => {
    const serial = ++pointSerial
    const result = await ctx.point.ground(req)
    if (serial !== pointSerial) {
      log('point', 'superseded — not shown', req.stepIndex)
      return result
    }
    if (result.outcome === 'point') {
      overlayShow(result.x, result.y, result.label)
      // Stale-screen guard: windows move. If the learner has switched to a window that is
      // neither ours nor the one the target lives in, the arrow is pointing at a coordinate that
      // no longer means anything — take it down rather than point at the wrong place.
      if (result.windowHwnd) {
        const mine = serial
        setTimeout(() => {
          void ctx.point.foreground().then((fg) => {
            if (!fg || mine !== pointSerial) return
            if (fg.self || fg.hwnd === result.windowHwnd) return
            log('point', 'foreground changed under the point — dismissing', fg.title || fg.process)
            overlayDismiss()
          })
        }, 1500).unref?.()
      }
    } else {
      overlayDismiss()
    }
    return result
  })

  ipcMain.handle(IPC.pointDismiss, async () => {
    pointSerial++
    overlayDismiss()
  })

  // ---------------------------------------------------------------- settings / info
  ipcMain.handle(IPC.settingsGet, async () => settings.get())
  ipcMain.handle(IPC.settingsSet, async (_e, patch: Partial<Settings>) => {
    const before = settings.get()
    const next = settings.set(patch)
    if (patch.model !== undefined) codex.setPreferredModel(next.model)
    if (next.hotkey !== before.hotkey) ctx.onHotkeyChange(next.hotkey)
    broadcast(IPC.settingsGet, next)
    return next
  })
  ipcMain.handle(IPC.appInfo, async () => ctx.appInfo)
  ipcMain.handle(IPC.openDataDir, async () => {
    // Renderer never passes a path — main opens the one folder it owns.
    const err = await shell.openPath(ctx.appInfo.userDataPath)
    if (err) log('main', 'openDataDir failed', err)
    return err === ''
  })

  // Verification harness only: fire a tray menu item's real click handler.
  if (process.env.COURSELESS_REMOTE_DEBUG) {
    ipcMain.handle(IPC.trayInvoke, async (_e, label: string) => invokeTrayMenuItem(label))
  }
}

/** Used by the tray / global shortcut to drive the runner without a renderer round-trip. */
export function pushRunnerAction(action: RunnerAction): void {
  broadcast(IPC.runnerActionEvent, action)
}

export function pushRunnerState(state: RunnerState): void {
  runnerState = state
  broadcast(IPC.runnerStateEvent, state)
}
