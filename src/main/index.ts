// Courseless — main process entry.
// Single instance, tray, global hotkey, main + float windows, account + engine + storage services.

import { app, globalShortcut } from 'electron'
import { join, resolve } from 'node:path'
import { IPC, type AppInfo } from '../shared/ipc'
import { AuthService } from './services/AuthService'
import { EngineService } from './services/EngineService'
import { LessonStore } from './services/LessonStore'
import { LibraryService, registerLibraryIpc } from './services/LibraryService'
import { PermissionsService } from './services/PermissionsService'
import { PointService } from './services/PointService'
import { RecordService } from './services/RecordService'
import { SettingsStore } from './services/SettingsStore'
import { getRunnerState, registerIpc, teardownSession } from './ipc'
import { registerUpdater } from './update'
import { backendConfig, loadEnvFile } from './util/env'
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
  setDockIcon,
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

/** The browser rings this when a sign-in finishes, so the window can come forward. */
const PROTOCOL = 'courseless'
const PROTOCOL_PREFIX = `${PROTOCOL}://`

/**
 * `courseless://signed-in` is a doorbell, not a channel.
 *
 * Nothing is ever READ off the URL — no token, no pair id, no secret. It cannot be: a cold start
 * from a link is structurally signed out, because the secret that redeems a pairing died with the
 * process that invented it. The poll inside AuthService is the only transport. So the whole
 * handler is "bring the window forward", and it stays that way.
 */
let windowsExist = false

function handleDeepLink(url: string): void {
  log('main', 'deep link', url.slice(0, 120))
  // Before the first window there is nothing to raise, and bootstrap will show one anyway.
  if (!windowsExist) return
  showMainWindow()
}

// Registered in the first tick, at module scope, and NOT inside bootstrap: macOS delivers a
// cold-start `open-url` before any await has resolved and Electron does not queue it.
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})

try {
  if (process.defaultApp && process.argv.length >= 2) {
    // In dev the executable is Electron itself, so the entry script has to travel with it.
    // (macOS dev links land on Electron's own bundle id — expected, and not worth chasing.)
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL)
  }
} catch (e) {
  log('main', 'protocol registration failed', String(e).slice(0, 160))
}

// Two global shortcuts can be live at once, so neither may use `unregisterAll` — re-registering
// the summon hotkey (a settings change made mid-recording) must not silently take the mark key
// with it. Module scope, because `registerHotkey` is hoisted and runs during bootstrap.
let summonHotkey: string | null = null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  // On Windows a deep link arrives as a second launch, somewhere in argv — Chromium appends its
  // own flags, so the position is not stable and only a scan will do.
  app.on('second-instance', (_e, argv) => {
    const link = argv.find((a) => a.startsWith(PROTOCOL_PREFIX))
    if (link) handleDeepLink(link)
    else showMainWindow()
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

  // safeStorage needs a ready app before it can talk to the OS keychain, and AuthService reads
  // the stored session the moment it is constructed — so everything below waits here.
  await app.whenReady()

  // Before the first window: the Dock tile appears the moment the app activates, and setting the
  // icon afterwards means the learner watches an Electron logo turn into ours.
  setDockIcon()

  // Dev reads the repo's .env.local; a packaged build reads the environment it was given.
  if (!app.isPackaged) loadEnvFile(join(__dirname, '../../.env.local'))
  const backend = backendConfig()
  if (!backend) log('main', 'no backend configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)')

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
  // The account. Null only when the app was built without a backend — everything local still
  // works, and the engine says why it cannot answer instead of failing silently.
  const auth = backend
    ? new AuthService({
        url: backend.url,
        anonKey: backend.anonKey,
        siteUrl: backend.siteUrl,
        sessionFile: join(userData, 'auth.json')
      })
    : null
  if (auth) await auth.whenReady()

  const engine = new EngineService({
    baseUrl: backend?.url ?? '',
    anonKey: backend?.anonKey ?? '',
    getAccessToken: async () => (auth ? auth.getAccessToken() : null),
    accountEmail: () => auth?.getState().user?.email ?? null
  })

  engine.on('status', (s) => broadcast(IPC.engineStatus, s))
  engine.on('rateLimits', (info) => log('main', 'rateLimits', info))

  // Guided pointing. The OS helpers ship next to the seed lessons; in dev they sit at the project
  // root. Which helper is a platform fact PointService owns:
  //   win32   <resources>/uia-find.ps1 + screen-shot.ps1
  //   darwin  <resources>/mac/courseless-ax  (one universal binary, every mode)
  // The screenshot scratch dir is emptied by PointService after every call.
  const resourcesDir = app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources')
  const point = new PointService({
    resourcesDir,
    tempDir: join(app.getPath('temp'), 'courseless-point'),
    vision: (imagePath, prompt) => engine.vision(imagePath, prompt),
    canVision: () => !!auth?.isSignedIn(),
    // Courseless's own windows must not be mistaken for the app the learner is working in.
    selfPids: () => [process.pid],
    // ...and the two windows that float ABOVE that app least of all: the pointer sheet and the
    // recording pill both sit over the thing being taught.
    skipWindowIds: () => [...overlayNativeHandles(), ...recordNativeHandles()]
  })

  // The two macOS gates pointing needs. It borrows PointService's helper rather than spawning its
  // own: the helper's answer is the one that matters, because it is the process that will do the
  // reading. On win32 every method answers "nothing to grant".
  const permissions = new PermissionsService({ probe: (prompt) => point.permissions(prompt) })

  // Recording reuses PointService's accessibility plumbing rather than growing its own: one
  // helper contract, one exclusion list, one place where the OS is touched.
  const record = new RecordService({
    draftDir: join(userData, 'drafts'),
    elementFromPoint: () => point.elementFromPoint(),
    foreground: () => point.foreground(),
    onChange: (state) => broadcast(IPC.recordStateEvent, state)
  })

  // Signing in or out changes what the engine can do, so the status the whole UI reads is
  // recomputed at the source rather than in each window.
  //
  // Signing OUT does more than change a status: it ends the session, and everything that belonged
  // to it goes now rather than when someone notices. Wired here, below `record`, because the
  // teardown has a live recording to park.
  auth?.on('state', (state) => {
    broadcast(IPC.authStateEvent, state)
    if (state.status === 'signed-out') teardownSession({ record, engine, setMarkShortcut })
    engine.invalidateStatus()
  })

  const stallRaw = Number(process.env.COURSELESS_STALL_MS)
  const appInfo: AppInfo = {
    userDataPath: userData,
    lessonsPath: lessons.directory,
    logPath: join(userData, 'courseless-main.log'),
    version: app.getVersion(),
    isDev: !app.isPackaged,
    stallMsOverride: Number.isFinite(stallRaw) && stallRaw > 0 ? stallRaw : null,
    backendConfigured: !!backend,
    platform: process.platform
  }

  registerIpc({
    auth,
    engine,
    lessons,
    settings,
    point,
    permissions,
    record,
    appInfo,
    onHotkeyChange: (hotkey) => registerHotkey(hotkey),
    setMarkShortcut: (on) => setMarkShortcut(on)
  })

  // The curated shelf. Its own registration: it is a public read-only catalogue and nothing else
  // in the app depends on it being there.
  registerLibraryIpc(
    new LibraryService({
      url: backend?.url ?? '',
      anonKey: backend?.anonKey ?? '',
      lessons,
      settings
    })
  )

  // Background updates. Registered after the IPC surface and before the first window, so a
  // renderer that asks for the state on mount always finds a handler; the first check is ten
  // seconds out, well clear of startup.
  registerUpdater()

  createMainWindow(settings.get().theme)
  windowsExist = true

  // Windows cold start: the link came in on our own argv and `second-instance` will never fire,
  // because this IS the first instance.
  const launchLink = process.argv.find((a) => a.startsWith(PROTOCOL_PREFIX))
  if (launchLink) handleDeepLink(launchLink)

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
    engine.dispose()
    auth?.dispose()
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
  //
  // NOT ON MACOS. There, an app with no windows is a normal, expected state — it stays in the
  // Dock, keeps its menu bar and comes back on a Dock click or the summon hotkey (that is what
  // the `window-all-closed` exemption above is for). Quitting on the learner's behalf two seconds
  // after they close a window is the one thing a Mac app must never do, and it would also take
  // the tray item and both global shortcuts away with it.
  if (process.platform !== 'darwin') {
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
}
