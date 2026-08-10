// Silent background updates.
//
// The contract with the learner is that Courseless never interrupts them: a new version is
// fetched in the background and swapped in the next time they quit. Nothing pops up, nothing asks
// to restart, nothing steals focus in the middle of a lesson. The only visible trace is one line
// in Settings → About once a build is sitting on disk ready to go.
//
// Platform facts worth knowing before changing anything here:
//   macOS    electron-updater replaces the .app from the ZIP in the release, not the DMG, and it
//            refuses to run unless the installed copy is properly signed. That is why the mac
//            target list has `zip` in it and why the release script uploads latest-mac.yml.
//   Windows  the NSIS build is unsigned, so latest.yml carries no publisherName and
//            electron-updater skips its signature check. Adding a certificate later needs no
//            change here — the check turns itself on when the field appears.

import { app, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IPC, type UpdateState } from '../shared/ipc'
import { log } from './util/log'
import { broadcast } from './windows'

/** Late enough that the first window, the library scan and the session restore are all done. */
const FIRST_CHECK_MS = 10_000
const EVERY_MS = 4 * 60 * 60 * 1000

let state: UpdateState = { status: 'idle', version: null }

function set(next: UpdateState): void {
  state = next
  broadcast(IPC.updateStateEvent, state)
}

export function getUpdateState(): UpdateState {
  return state
}

export function registerUpdater(): void {
  ipcMain.handle(IPC.updateGetState, () => state)

  // `npm run dev` has no app-update.yml and no installed copy to replace. Checking would only
  // produce a confusing error in the log.
  if (!app.isPackaged) {
    log('update', 'dev build — no update checks')
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // Never a dialog, never a relaunch the learner did not ask for.
  autoUpdater.logger = {
    info: (m: unknown) => log('update', String(m).slice(0, 200)),
    warn: (m: unknown) => log('update', 'warn', String(m).slice(0, 200)),
    error: (m: unknown) => log('update', 'error', String(m).slice(0, 300)),
    debug: () => {}
  }

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', version: null }))
  autoUpdater.on('update-not-available', () => set({ status: 'idle', version: null }))
  autoUpdater.on('update-available', (info) => {
    log('update', 'available', info.version)
    set({ status: 'downloading', version: info.version })
  })
  autoUpdater.on('download-progress', (p) => {
    if (Math.round(p.percent) % 25 === 0) log('update', `downloading ${Math.round(p.percent)}%`)
  })
  autoUpdater.on('update-downloaded', (info) => {
    log('update', 'downloaded and staged', info.version)
    set({ status: 'ready', version: info.version })
  })
  // An unhandled 'error' from autoUpdater is a crash. Offline is the common case and it is not
  // worth a word to the learner: the next check in four hours will do.
  autoUpdater.on('error', (e) => {
    log('update', 'check failed', String(e).slice(0, 300))
    set({ status: state.status === 'ready' ? 'ready' : 'idle', version: state.version })
  })

  const check = (): void => {
    autoUpdater.checkForUpdates().catch((e) => {
      log('update', 'check threw', String(e).slice(0, 200))
    })
  }

  setTimeout(check, FIRST_CHECK_MS).unref()
  setInterval(check, EVERY_MS).unref()
  log('update', 'updater armed', { current: app.getVersion(), firstCheckMs: FIRST_CHECK_MS })
}
