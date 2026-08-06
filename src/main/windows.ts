// Window + tray + global shortcut management.
//   main window   1200x800 (min 960x640)
//   float widget  380x300 frameless + transparent, always-on-top at 'screen-saver' level, hidden
//                 (not destroyed) on close, loaded on the #/float route of the renderer bundle.

import { BrowserWindow, Menu, Tray, app, nativeImage, screen, shell } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import type { FloatCommand, FloatStatus, OverlayPoint } from '../shared/types'
import { courselessIconPng } from './util/icon'
import { log } from './util/log'

let mainWindow: BrowserWindow | null = null
let floatWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

export function setQuitting(v: boolean): void {
  quitting = v
}

function preloadPath(): string {
  return join(__dirname, '../preload/index.js')
}

function rendererFile(): string {
  return join(__dirname, '../renderer/index.html')
}

function loadRoute(win: BrowserWindow, hash?: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(hash ? `${devUrl}#${hash}` : devUrl)
  } else {
    void win.loadFile(rendererFile(), hash ? { hash } : undefined)
  }
}

export function appIcon(size = 32) {
  return nativeImage.createFromBuffer(courselessIconPng(size))
}

// ---------------------------------------------------------------- main window

/** `theme` only picks the pre-paint background colour — without it a dark-mode user gets a
 *  white flash on every launch. Everything else about theming lives in the renderer. */
export function createMainWindow(theme: 'light' | 'dark' = 'light'): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: theme === 'dark' ? '#0A1420' : '#F7F9FB',
    title: 'Courseless',
    icon: appIcon(64),
    autoHideMenuBar: true,
    // The app draws its own title bar (Nav header + WindowControls). Windows keeps the resize
    // borders and the snap layouts; everything visible is ours.
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  win.once('ready-to-show', () => {
    win.show()
    log('windows', 'main window shown')
  })
  win.on('closed', () => {
    mainWindow = null
  })
  // The custom title bar has to follow OS-driven maximize too (double-click, Win+Up, snap).
  const pushWinState = (): void => {
    if (!win.isDestroyed()) win.webContents.send(IPC.winState, win.isMaximized())
  }
  win.on('maximize', pushWinState)
  win.on('unmaximize', pushWinState)
  // Moving a window while the pointer overlay is up dismisses the pointer. Two reasons: a
  // pointed target inside a moving window is stale, and the drag-vs-overlay interaction was
  // reported as the window "glitching all over the place" (root cause: the overlay's forwarded
  // mouse events corrupting Chromium's self-managed caption drag — forward is now off, this is
  // the second line of defence). NOTE: app-region drags never enter the OS move loop
  // (Chromium repositions the window itself), so WM_ENTERSIZEMOVE alone is not enough — 'move'
  // fires for both mechanisms. overlayDismiss() is idempotent and cheap when nothing is shown.
  win.hookWindowMessage(0x0231 /* WM_ENTERSIZEMOVE — native move loops (kbd move, some drags) */, () =>
    overlayDismiss('main entersizemove')
  )
  win.on('move', () => overlayDismiss('main window moved'))
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  loadRoute(win)
  mainWindow = win
  return win
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function showMainWindow(): BrowserWindow {
  const win = getMainWindow() ?? createMainWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  return win
}

// ---------------------------------------------------------------- float window

/** The widget's fixed width, its resting height, and the tallest it goes (coach open). */
const FLOAT_W = 380
const FLOAT_H = 300
const FLOAT_MAX_H = 480

/**
 * Windows hands a frameless window a smaller client rect than asked for, and loses a few more
 * pixels on each subsequent setContentSize. Converge on the real size instead of trusting it.
 */
function setContentSizeExact(win: BrowserWindow, w: number, h: number): void {
  let reqW = w
  let reqH = h
  for (let i = 0; i < 4; i++) {
    const [aw, ah] = win.getContentSize()
    if (aw === w && ah === h) return
    reqW += w - aw
    reqH += h - ah
    win.setContentSize(reqW, reqH)
  }
}

export function createFloatWindow(): BrowserWindow {
  if (floatWindow && !floatWindow.isDestroyed()) return floatWindow
  const display = screen.getPrimaryDisplay()
  const { x, y, width, height } = display.workArea
  const w = FLOAT_W
  const h = FLOAT_H
  const win = new BrowserWindow({
    width: w,
    height: h,
    // Windows still reserves an invisible resize border on frameless windows; without this the
    // web content came out 332x236 instead of the specified 380x260.
    useContentSize: true,
    x: x + width - w - 24,
    y: y + height - h - 24,
    frame: false,
    // created resizable so the size can be corrected below, then locked with setResizable(false):
    // a non-resizable Windows window clamps setContentSize to the size it was born with.
    resizable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    // B2: the widget paints its own rounded card with an ambient shadow, so the window itself is
    // transparent. backgroundColor must be fully transparent or Windows composites it opaque.
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    title: 'Courseless coach',
    icon: appIcon(32),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  // Windows hands back a smaller client rect than asked for (measured: 380x260 -> 332x236, and
  // each setContentSize loses another 16x8).
  setContentSizeExact(win, w, h)
  win.setPosition(x + width - w - 24, y + height - h - 24)
  win.setResizable(false)
  log('windows', 'float geometry', {
    scaleFactor: display.scaleFactor,
    contentSize: win.getContentSize(),
    bounds: win.getBounds()
  })
  // 'screen-saver' keeps it above full-screen apps and other always-on-top windows.
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // keep a distinct window title (see the overlay for why)
  win.on('page-title-updated', (e) => {
    e.preventDefault()
  })
  win.setTitle('Courseless coach')
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault() // hidden, never destroyed — keeps state and reopens instantly
    win.hide()
    log('windows', 'float hidden (close intercepted)')
  })
  win.on('closed', () => {
    floatWindow = null
  })
  // Same drag-vs-overlay guard as the main window: moving the float dismisses the pointer.
  win.hookWindowMessage(0x0231 /* WM_ENTERSIZEMOVE */, () => overlayDismiss('float entersizemove'))
  win.on('move', () => overlayDismiss('float moved'))
  loadRoute(win, '/float')
  floatWindow = win
  return win
}

export function getFloatWindow(): BrowserWindow | null {
  return floatWindow && !floatWindow.isDestroyed() ? floatWindow : null
}

/** Set when growing had to push the widget up the screen — see floatResize. */
let floatPushedUp = false

/**
 * Grow (or shrink) the widget when the coach opens inside it.
 *
 * Two Windows facts shape this:
 *  1. a non-resizable window CLAMPS setContentSize to the size it was born with, so the lock has
 *     to come off for the duration of the call and go straight back on (the same born-resizable
 *     -> size -> lock sequence the overlay needed);
 *  2. the widget rests 24px off the bottom of the work area, so "expand downward" would push it
 *     under the taskbar. It grows downward when there is room and is pushed up when there is not.
 *
 * The push has to be remembered. Growing bottom-anchored and then shrinking top-anchored walks
 * the widget up the screen a little further on every open/close of the coach — measured 180px per
 * cycle before this flag existed.
 */
export function floatResize(height: number): FloatStatus {
  const win = getFloatWindow()
  if (win) {
    const h = Math.max(FLOAT_H, Math.min(FLOAT_MAX_H, Math.round(height)))
    const [cw, ch] = win.getContentSize()
    if (ch !== h) {
      const before = win.getBounds()
      const bottom = before.y + before.height
      const wa = screen.getDisplayNearestPoint({
        x: before.x + Math.round(before.width / 2),
        y: before.y + Math.round(before.height / 2)
      }).workArea
      win.setResizable(true)
      setContentSizeExact(win, cw, h)
      win.setResizable(false)
      const after = win.getBounds()
      const growing = after.height > before.height
      const mustPush = growing && before.y + after.height > wa.y + wa.height
      // bottom-anchored when growing off the bottom, and when giving that room back again
      const anchorBottom = mustPush || (!growing && floatPushedUp)
      floatPushedUp = growing ? mustPush : false
      win.setPosition(after.x, anchorBottom ? bottom - after.height : before.y)
      log('windows', 'float resized', {
        to: h,
        contentSize: win.getContentSize(),
        anchor: anchorBottom ? 'bottom' : 'top',
        y: win.getBounds().y
      })
    }
  }
  return floatStatus('resize')
}

export function floatControl(cmd: FloatCommand): FloatStatus {
  if (cmd === 'open') {
    const win = createFloatWindow()
    win.showInactive()
    win.setAlwaysOnTop(true, 'screen-saver')
  } else if (cmd === 'close') {
    getFloatWindow()?.hide()
  } else if (cmd === 'toggle') {
    const existing = getFloatWindow()
    if (existing && existing.isVisible()) existing.hide()
    else {
      const win = createFloatWindow()
      win.showInactive()
      win.setAlwaysOnTop(true, 'screen-saver')
    }
  }
  return floatStatus(cmd)
}

function floatStatus(cmd: string): FloatStatus {
  const win = getFloatWindow()
  const status: FloatStatus = {
    open: !!win,
    visible: !!win?.isVisible(),
    alwaysOnTop: !!win?.isAlwaysOnTop(),
    bounds: win ? win.getBounds() : undefined
  }
  if (cmd !== 'status') log('windows', 'floatControl', cmd, status)
  return status
}

// ---------------------------------------------------------------- record pill

// The recording pill: a strip that sits over whatever the author is teaching, always on top,
// never in the way. It is deliberately NOT the float widget — the float belongs to a learner
// mid-lesson, this belongs to an author mid-recording, and conflating them would mean one window
// with two personalities.
//
// Height is driven from the renderer (`recordPillResize`): the note input is a second row that
// appears after a mark, and a window with a permanently taller transparent tail would eat
// desktop clicks in the empty space below the card.

// Wide enough that the middle column — the name of the recording, then what the last mark
// actually caught — has real room. At 528 it collapsed to nothing and the author had no way to
// tell whether the mark landed on the button they meant.
const PILL_W = 664
const PILL_H = 62

let recordWindow: BrowserWindow | null = null

export function createRecordWindow(): BrowserWindow {
  if (recordWindow && !recordWindow.isDestroyed()) return recordWindow
  const display = screen.getPrimaryDisplay()
  const { x, y, width, height } = display.workArea
  const win = new BrowserWindow({
    width: PILL_W,
    height: PILL_H,
    useContentSize: true,
    // Bottom centre: out of the way of the window the author is working in, and where a
    // recording indicator is expected to live.
    x: Math.round(x + (width - PILL_W) / 2),
    y: y + height - PILL_H - 28,
    frame: false,
    resizable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    title: 'Courseless recording',
    icon: appIcon(32),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  // Same convergence dance as the float: Windows hands back a smaller client rect than asked for.
  let reqW = PILL_W
  let reqH = PILL_H
  for (let i = 0; i < 4; i++) {
    const [aw, ah] = win.getContentSize()
    if (aw === PILL_W && ah === PILL_H) break
    reqW += PILL_W - aw
    reqH += PILL_H - ah
    win.setContentSize(reqW, reqH)
  }
  win.setPosition(Math.round(x + (width - PILL_W) / 2), y + height - PILL_H - 28)
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Distinct title, for the same reason the overlay has one: grounding resolves windows by title.
  win.on('page-title-updated', (e) => {
    e.preventDefault()
  })
  win.setTitle('Courseless recording')
  win.on('closed', () => {
    recordWindow = null
  })
  loadRoute(win, '/record')
  recordWindow = win
  log('windows', 'record pill created', win.getBounds())
  return win
}

export function getRecordWindow(): BrowserWindow | null {
  return recordWindow && !recordWindow.isDestroyed() ? recordWindow : null
}

export function showRecordPill(): void {
  const win = createRecordWindow()
  // showInactive: raising the pill must not pull focus out of the app being recorded.
  win.showInactive()
  win.setAlwaysOnTop(true, 'screen-saver')
}

export function closeRecordPill(): void {
  const win = getRecordWindow()
  if (!win) return
  win.destroy()
  recordWindow = null
  log('windows', 'record pill closed')
}

/** The card grew (note row) or shrank. Keep the window glued to the same bottom edge. */
export function recordPillResize(height: number): void {
  const win = getRecordWindow()
  if (!win) return
  const h = Math.max(48, Math.min(240, Math.round(height)))
  const [cw, ch] = win.getContentSize()
  if (ch === h) return
  const bounds = win.getBounds()
  const bottom = bounds.y + bounds.height
  win.setContentSize(cw, h)
  const after = win.getBounds()
  win.setPosition(after.x, bottom - after.height)
}

/** Native handles of the pill, so grounding never searches our own strip. */
export function recordNativeHandles(): number[] {
  const win = getRecordWindow()
  if (!win) return []
  try {
    const buf = win.getNativeWindowHandle()
    return [buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0)]
  } catch {
    return []
  }
}

// ---------------------------------------------------------------- overlay windows (guided pointing)

// The ghost cursor lives in transparent, click-through, never-focusable windows created on
// demand and destroyed after a minute of disuse.
//
// ONE WINDOW PER DISPLAY. A single window spanning the whole virtual desktop looked like the
// simpler design and is wrong: Windows composites a layered (transparent) window only on the
// display it was created on, so on a dual-monitor machine every point on the second screen was
// grounded correctly, sent correctly, drawn correctly by the renderer -- and never appeared. A
// point the learner cannot see is indistinguishable from pointing at the wrong place, which the
// accuracy contract forbids. Per-display windows are cheaper too: only the screen in use paints.

const OVERLAY_IDLE_MS = 60_000

interface OverlaySurface {
  win: BrowserWindow
  ready: boolean
  pending: OverlayPoint | null
  displayId: number
}

const overlays = new Map<number, OverlaySurface>()
let overlayIdleTimer: NodeJS.Timeout | null = null
let pointSeq = 0

function createOverlayFor(display: Electron.Display): OverlaySurface {
  const existing = overlays.get(display.id)
  if (existing && !existing.win.isDestroyed()) return existing
  const { x, y, width, height } = display.bounds
  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    // Born resizable and locked down only AFTER the bounds are right: Windows clamps a
    // non-resizable window to the WORK area of its display, which cut 40px off the bottom and
    // left every point over the taskbar outside the window.
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // never takes focus - the learner keeps typing in the app they are learning
    focusable: false,
    acceptFirstMouse: false,
    show: false,
    title: 'Courseless pointer',
    // 'toolbar' keeps it out of Alt-Tab on Windows
    type: process.platform === 'win32' ? 'toolbar' : undefined,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  for (let i = 0; i < 4; i++) {
    const b = win.getBounds()
    if (b.x === x && b.y === y && b.width === width && b.height === height) break
    win.setBounds({ x, y, width, height })
  }
  win.setResizable(false)
  win.setMovable(false)
  // ALWAYS click-through. There is no state in which the overlay accepts a click: it points,
  // the learner clicks the real thing themselves. Deliberately NO `forward:` the overlay never
  // reads mouse events, and on Windows the forwarded synthetic stream can corrupt a native
  // title-bar drag happening beneath the sheet (window "teleports" while dragging).
  win.setIgnoreMouseEvents(true)
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // The renderer bundle's <title> is "Courseless" on every route, so without this the overlay and
  // the main window are indistinguishable to anything that looks up a window by title - including
  // our own grounding pass, which would then search a transparent empty sheet.
  win.on('page-title-updated', (e) => {
    e.preventDefault()
  })
  win.setTitle('Courseless pointer')

  const surface: OverlaySurface = { win, ready: false, pending: null, displayId: display.id }
  win.on('closed', () => {
    overlays.delete(display.id)
  })
  win.webContents.on('did-finish-load', () => {
    surface.ready = true
    if (surface.pending) {
      win.webContents.send(IPC.overlayPoint, surface.pending)
      surface.pending = null
    }
  })
  loadRoute(win, '/overlay')
  overlays.set(display.id, surface)
  const got = win.getBounds()
  log('windows', 'overlay created', {
    display: display.id,
    want: { x, y, width, height },
    bounds: got,
    covers: got.width === width && got.height === height,
    scaleFactor: display.scaleFactor
  })
  return surface
}

function armOverlayIdle(): void {
  if (overlayIdleTimer) clearTimeout(overlayIdleTimer)
  overlayIdleTimer = setTimeout(() => {
    for (const [id, s] of [...overlays]) {
      if (!s.win.isDestroyed() && !s.win.isVisible()) {
        log('windows', 'overlay destroyed (idle)', id)
        s.win.destroy()
        overlays.delete(id)
      }
    }
  }, OVERLAY_IDLE_MS)
  overlayIdleTimer.unref?.()
}

/**
 * Fly the ghost cursor to a PHYSICAL screen pixel on whichever display owns it.
 * Electron window bounds are DIPs, so the physical point is converted with screenToDipPoint --
 * the only correct conversion when displays have different scale factors -- and then made local
 * to that display's overlay.
 */
export function overlayShow(physicalX: number, physicalY: number, label: string): OverlayPoint {
  let dip = { x: physicalX, y: physicalY }
  try {
    dip = screen.screenToDipPoint({ x: physicalX, y: physicalY })
  } catch {
    const sf = screen.getPrimaryDisplay().scaleFactor || 1
    dip = { x: physicalX / sf, y: physicalY / sf }
  }
  const display = screen.getDisplayNearestPoint({ x: Math.round(dip.x), y: Math.round(dip.y) })
  const point: OverlayPoint = {
    id: ++pointSeq,
    x: Math.round(dip.x - display.bounds.x),
    y: Math.round(dip.y - display.bounds.y),
    label,
    screen: { x: 0, y: 0, width: display.bounds.width, height: display.bounds.height }
  }

  // Only one screen may be pointing at a time - an arrow left behind on the other monitor is a
  // second, stale answer to the same question.
  for (const [id, s] of overlays) {
    if (id !== display.id && !s.win.isDestroyed() && s.win.isVisible()) {
      if (s.ready) s.win.webContents.send(IPC.overlayDismiss, null)
      s.win.hide()
    }
  }

  const surface = createOverlayFor(display)
  // showInactive, never show(): raising this window must not steal focus from the app the
  // learner is working in.
  if (!surface.win.isVisible()) surface.win.showInactive()
  surface.win.setAlwaysOnTop(true, 'screen-saver')
  if (surface.ready) surface.win.webContents.send(IPC.overlayPoint, point)
  else surface.pending = point
  if (overlayIdleTimer) clearTimeout(overlayIdleTimer)
  log('windows', 'overlay point', { ...point, display: display.id, physicalX, physicalY })
  return point
}

export function overlayDismiss(reason = 'unspecified'): void {
  let any = false
  let visible = false
  for (const s of overlays.values()) {
    if (s.win.isDestroyed()) continue
    any = true
    if (s.win.isVisible()) visible = true
    if (s.ready) s.win.webContents.send(IPC.overlayDismiss, null)
    s.pending = null
  }
  if (!any) return
  if (visible) log('windows', 'overlay dismissed', reason)
  // Main takes the overlay down on its own for several reasons (a window moved, the foreground
  // changed, the step advanced). The window that OWNS the pointing state has to hear about it,
  // or its mirror says "shown" with nothing on screen — and then the next Esc is spent dismissing
  // an arrow that is not there instead of doing what the learner asked.
  if (visible) sendToMain(IPC.overlayDismiss, null)
  // let the fade-out play before the windows disappear
  setTimeout(() => {
    for (const s of overlays.values()) if (!s.win.isDestroyed()) s.win.hide()
    armOverlayIdle()
  }, 320)
}

export function getOverlayWindows(): BrowserWindow[] {
  return [...overlays.values()].filter((s) => !s.win.isDestroyed()).map((s) => s.win)
}

/**
 * Native HWNDs of every overlay. Grounding must never search them: they are transparent sheets
 * living in the app's own process, so anything that resolves "a window of the Courseless process"
 * can land on one and find an empty tree instead of the real window.
 */
export function overlayNativeHandles(): number[] {
  const out: number[] = []
  for (const win of getOverlayWindows()) {
    try {
      const buf = win.getNativeWindowHandle()
      out.push(buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0))
    } catch {
      /* ignore */
    }
  }
  return out
}

// ---------------------------------------------------------------- broadcast

export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

export function sendToMain(channel: string, payload: unknown): void {
  getMainWindow()?.webContents.send(channel, payload)
}

// ---------------------------------------------------------------- tray

let trayMenu: Menu | null = null

export function createTray(handlers: {
  onToggleFloat(): void
  onRecord(): void
  onQuit(): void
}): Tray | null {
  if (tray) return tray
  try {
    const icon = nativeImage.createFromBuffer(courselessIconPng(16))
    tray = new Tray(icon)
    trayMenu = Menu.buildFromTemplate([
      {
        label: 'Open Courseless',
        click: () => {
          log('windows', 'tray menu: Open Courseless')
          showMainWindow()
        }
      },
      {
        label: 'Record a walkthrough',
        click: () => {
          log('windows', 'tray menu: Record a walkthrough')
          handlers.onRecord()
        }
      },
      {
        label: 'Toggle float',
        click: () => {
          log('windows', 'tray menu: Toggle float')
          handlers.onToggleFloat()
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          log('windows', 'tray menu: Quit')
          handlers.onQuit()
        }
      }
    ])
    tray.setToolTip('Courseless — stop taking courses, start doing things')
    tray.setContextMenu(trayMenu)
    tray.on('click', () => {
      log('windows', 'tray icon clicked')
      showMainWindow()
    })
    log('windows', 'tray created')
  } catch (e) {
    log('windows', 'tray creation failed', String(e))
    tray = null
  }
  return tray
}

/**
 * Fires a tray menu item's click handler — the same callback the OS would run.
 * Only reachable from the renderer when the app was started with COURSELESS_REMOTE_DEBUG
 * (the automated verification harness); there is no production path to it.
 */
export function invokeTrayMenuItem(label: string): boolean {
  const item = trayMenu?.items.find((i) => i.label === label)
  if (!item) return false
  item.click()
  return true
}

export function destroyTray(): void {
  try {
    tray?.destroy()
  } catch {
    /* ignore */
  }
  tray = null
}
