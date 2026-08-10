// PermissionsService — the two macOS gates that guided pointing needs, and nothing else.
//
// Accessibility (kTCCServiceAccessibility) lets Courseless READ the name of the button a step is
// about. Screen Recording (kTCCServiceScreenCapture) lets it LOOK at the screen when reading
// fails — and, less obviously, is what makes window titles visible at all: without it macOS
// returns nil for every kCGWindowName, so "is the right app in front?" stops having an answer.
//
// Both gate pointing only. The library, the coach and recording work with neither.
//
// On win32 there is nothing to grant, so every method answers `supported: false` and the UI that
// renders this state never appears.

import { shell, systemPreferences } from 'electron'
import type { PermissionKey, PermissionsState } from '../../shared/types'
import { log } from '../util/log'

const IS_DARWIN = process.platform === 'darwin'

/** The System Settings panes, one per gate. */
const DEEP_LINK: Record<PermissionKey, string> = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  screenRecording: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
}

export interface PermissionsServiceOptions {
  /**
   * The helper's own view of the two gates — it is the process that will actually do the reading,
   * so its answer is the one that counts. Null when it could not be run (or on win32), and the
   * in-process Electron APIs are used instead.
   */
  probe(prompt: boolean): Promise<{ accessibility: boolean; screenRecording: boolean } | null>
}

export class PermissionsService {
  private opts: PermissionsServiceOptions
  /**
   * macOS shows the Accessibility dialog on the FIRST AXIsProcessTrustedWithOptions({prompt:true})
   * and silently ignores every later one (electron#28395, #20787). A second "Grant" press that
   * does nothing looks like a broken button, so after the first ask this falls through to opening
   * System Settings instead.
   */
  private prompted: Record<PermissionKey, boolean> = { accessibility: false, screenRecording: false }
  /**
   * Screen Recording as it stood at launch. macOS does not hand the grant to a process that is
   * already running — the frameworks cache the denial — so a grant made during this session only
   * takes effect after a relaunch, and the UI has to say so rather than claim everything is fine.
   */
  private screenRecordingAtLaunch: boolean | null = null

  constructor(opts: PermissionsServiceOptions) {
    this.opts = opts
  }

  /** Cheap enough to poll (~1s) while a surface showing these is on screen. */
  async get(): Promise<PermissionsState> {
    return this.read(false)
  }

  /**
   * Ask the OS. The first ask is a real system dialog; after that macOS ignores the request, so
   * the honest thing is to take the person to the pane where the switch lives.
   */
  async request(which: PermissionKey): Promise<PermissionsState> {
    if (!IS_DARWIN) return this.read(false)
    const first = !this.prompted[which]
    this.prompted[which] = true
    if (!first) {
      await this.openSettings(which)
      return this.read(false)
    }
    log('permissions', 'requesting', which)
    if (which === 'accessibility') {
      // The in-process call is the one that prompts as US; the helper would prompt as itself.
      try {
        systemPreferences.isTrustedAccessibilityClient(true)
      } catch (e) {
        log('permissions', 'accessibility prompt failed', String(e).slice(0, 160))
      }
      return this.read(false)
    }
    // Screen Recording has no Electron prompt API (askForMediaAccess covers mic and camera only).
    // CGRequestScreenCaptureAccess inside the helper is the prompt, and it is attributed to us
    // because TCC blames the responsible process — the .app, not the child.
    return this.read(true)
  }

  async openSettings(which: PermissionKey): Promise<boolean> {
    if (!IS_DARWIN) return false
    try {
      await shell.openExternal(DEEP_LINK[which])
      log('permissions', 'opened System Settings', which)
      return true
    } catch (e) {
      log('permissions', 'deep link failed', which, String(e).slice(0, 160))
      return false
    }
  }

  // ---------------------------------------------------------------- reading

  private async read(prompt: boolean): Promise<PermissionsState> {
    if (!IS_DARWIN) {
      return { accessibility: 'granted', screenRecording: 'granted', needsRelaunch: false, supported: false }
    }
    // Two sources, deliberately. The Electron APIs answer instantly and always; the helper is the
    // process that will do the work. They agree in practice — when they do not, the helper wins
    // for Screen Recording (CGPreflightScreenCaptureAccess is exactly what the capture path asks)
    // and the union wins for Accessibility, since either "yes" means the tree is readable.
    let accessibility = false
    let screenRecording = false
    try {
      accessibility = systemPreferences.isTrustedAccessibilityClient(false)
    } catch (e) {
      log('permissions', 'isTrustedAccessibilityClient failed', String(e).slice(0, 160))
    }
    try {
      screenRecording = systemPreferences.getMediaAccessStatus('screen') === 'granted'
    } catch (e) {
      log('permissions', 'getMediaAccessStatus failed', String(e).slice(0, 160))
    }
    const probed = await this.opts.probe(prompt).catch(() => null)
    if (probed) {
      accessibility = accessibility || probed.accessibility
      screenRecording = probed.screenRecording
    }

    if (this.screenRecordingAtLaunch === null) this.screenRecordingAtLaunch = screenRecording

    return {
      accessibility: accessibility ? 'granted' : 'denied',
      screenRecording: screenRecording ? 'granted' : 'denied',
      needsRelaunch: screenRecording && this.screenRecordingAtLaunch === false,
      supported: true
    }
  }
}
