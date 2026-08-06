// Courseless — main process entry.
// Single instance, tray, global hotkey, main + float windows, Codex + storage services.

import { app, globalShortcut } from 'electron'
import { join } from 'node:path'
import { IPC, type AppInfo } from '../shared/ipc'
import { CodexService } from './services/CodexService'
import { LessonStore } from './services/LessonStore'
import { PointService } from './services/PointService'
import { RecordService } from './services/RecordService'
import { SettingsStore } from './services/SettingsStore'
import { resolveCodexExe } from './services/codex/resolve'
import { getRunnerState, registerIpc } from './ipc'
import { initLog, log } from './util/log'
import {
  broadcast,
  createMainWindow,
  createTray,
  destroyTray,
  floatControl,
  getFloatWindow,
  getMainWindow,
  getRecordWindow,
  overlayNativeHandles,
  recordNativeHandles,
  sendToMain,
  setQuitting,
  showMainWindow
} from './windows'

// Optional remote debugging for automated verification (Playwright over CDP).
const debugPort = process.env.COURSELESS_REMOTE_DEBUG
if (debugPort) {
  app.commandLine.appendSwitch('remote-debugging-port', debugPort)
  app.commandLine.appendSwitch('remote-allow-origins', '*')
}
// The float widget must keep rendering while the user works in another app, and CDP screenshots
// need frames from occluded windows. Both require Chromium's backgrounding to stay off.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

/** Fixed, and deliberately not user-configurable: it exists for at most a few minutes at a time. */
const MARK_HOTKEY = 'CommandOrControl+Shift+M'

// Two global shortcuts can be live at once, so neither may use `unregisterAll` — re-registering
// the summon hotkey (a settings change made mid-recording) must not silently take the mark key
// with it. Module scope, because `registerHotkey` is hoisted and runs during bootstrap.
let summonHotkey: string | null = null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })
  void bootstrap()
}

async function bootstrap(): Promise<void> {
  const userData = app.getPath('userData')
  initLog(join(userData, 'courseless-main.log'))
  log('main', 'starting', {
    version: app.getVersion(),
    electron: process.versions.electron,
    userData,
    debugPort: debugPort ?? null
  })

  const settings = new SettingsStore(join(userData, 'settings.json'))
  // resources/seed-lessons ships the starter library; in dev it sits at the project root.
  const seedDir = app.isPackaged
    ? join(process.resourcesPath, 'seed-lessons')
    : join(__dirname, '../../resources/seed-lessons')
  const lessons = new LessonStore({
    dir: join(userData, 'lessons'),
    seedDir,
    tombstones: {
      get: () => settings.get().deletedBuiltins ?? [],
      add: (id) => {
        const current = settings.get().deletedBuiltins ?? []
        if (!current.includes(id)) settings.set({ deletedBuiltins: [...current, id] })
      }
    }
  })
  // A dedicated empty working root for codex: read-only sandbox with nothing interesting to read.
  const codex = new CodexService({ workDir: join(userData, 'codex-workdir') })
  codex.setPreferredModel(settings.get().model)

  codex.on('status', (s) => broadcast(IPC.codexStatus, s))
  codex.on('rateLimits', (info) => log('main', 'rateLimits', info))

  // Guided pointing. The two PowerShell helpers ship next to the seed lessons; in dev they sit
  // at the project root. The screenshot scratch dir is emptied by PointService after every call.
  const resourcesDir = app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources')
  const point = new PointService({
    resourcesDir,
    tempDir: join(app.getPath('temp'), 'courseless-point'),
    codexExe: () => resolveCodexExe(),
    // Courseless's own windows must not be mistaken for the app the learner is working in.
    selfPids: () => [process.pid],
    // ...and the two windows that float ABOVE that app least of all: the pointer sheet and the
    // recording pill both sit over the thing being taught.
    skipHwnds: () => [...overlayNativeHandles(), ...recordNativeHandles()]
  })

  // Recording reuses PointService's accessibility plumbing rather than growing its own: one
  // PowerShell contract, one exclusion list, one place where the OS is touched.
  const record = new RecordService({
    draftDir: join(userData, 'drafts'),
    elementFromPoint: () => point.elementFromPoint(),
    foreground: () => point.foreground(),
    onChange: (state) => broadcast(IPC.recordStateEvent, state)
  })

  const stallRaw = Number(process.env.COURSELESS_STALL_MS)
  const appInfo: AppInfo = {
    userDataPath: userData,
    lessonsPath: lessons.directory,
    logPath: join(userData, 'courseless-main.log'),
    version: app.getVersion(),
    isDev: !app.isPackaged,
    stallMsOverride: Number.isFinite(stallRaw) && stallRaw > 0 ? stallRaw : null
  }

  await app.whenReady()

  registerIpc({
    codex,
    lessons,
    settings,
    point,
    record,
    appInfo,
    onHotkeyChange: (hotkey) => registerHotkey(hotkey),
    setMarkShortcut: (on) => setMarkShortcut(on)
  })

  createMainWindow(settings.get().theme)

  createTray({
    onToggleFloat: () => {
      floatControl('toggle')
    },
    onRecord: () => {
      // The tray can only ASK: the start dialog belongs to the main window, where the name and
      // the audience get typed.
      showMainWindow()
      sendToMain(IPC.recordInvite, null)
    },
    onQuit: () => {
      quitApp()
    }
  })

  registerHotkey(settings.get().hotkey)

  app.on('activate', () => {
    if (!getMainWindow()) createMainWindow()
    else showMainWindow()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') quitApp()
  })

  app.on('before-quit', () => {
    setQuitting(true)
    globalShortcut.unregisterAll()
    codex.dispose()
    destroyTray()
    log('main', 'quitting', { markHotkeyStillRegistered: globalShortcut.isRegistered(MARK_HOTKEY) })
  })

  function quitApp(): void {
    setQuitting(true)
    app.quit()
  }

  function registerHotkey(accelerator: string): void {
    if (summonHotkey) {
      try {
        globalShortcut.unregister(summonHotkey)
      } catch {
        /* ignore */
      }
      summonHotkey = null
    }
    try {
      const ok = globalShortcut.register(accelerator, () => {
        const state = getRunnerState()
        log('main', 'hotkey fired', accelerator, `runnerActive=${state.active}`)
        if (state.active) floatControl('toggle')
        else showMainWindow()
      })
      if (ok) summonHotkey = accelerator
      log('main', `hotkey ${accelerator} registered=${ok}`)
    } catch (e) {
      log('main', 'hotkey registration failed', String(e))
    }
  }

  /**
   * Mark exists ONLY while a recording is running. A global key that stays registered after the
   * recording ends is a key stolen from every other app on the machine for nothing — and the
   * mark handler would have no session to add to anyway.
   */
  function setMarkShortcut(on: boolean): void {
    if (on) {
      if (globalShortcut.isRegistered(MARK_HOTKEY)) return
      try {
        const ok = globalShortcut.register(MARK_HOTKEY, () => {
          void record.mark()
        })
        log('main', `mark hotkey ${MARK_HOTKEY} registered=${ok}`)
      } catch (e) {
        log('main', 'mark hotkey registration failed', String(e))
      }
    } else {
      try {
        globalShortcut.unregister(MARK_HOTKEY)
      } catch {
        /* ignore */
      }
      log('main', `mark hotkey ${MARK_HOTKEY} unregistered (registered=${globalShortcut.isRegistered(MARK_HOTKEY)})`)
    }
  }

  // The float window is hidden rather than destroyed, so closing the main window while the
  // float is not on screen should end the session instead of leaving an invisible app behind.
  setInterval(() => {
    const main = getMainWindow()
    const float = getFloatWindow()
    // A live recording counts as a reason to stay: the pill is on screen and holds marks that
    // have not been compiled yet.
    if (!main && (!float || !float.isVisible()) && !getRecordWindow()) {
      log('main', 'no visible windows left — quitting')
      quitApp()
    }
  }, 2000).unref()
}
