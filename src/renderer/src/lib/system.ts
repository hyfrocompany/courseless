/** Clipboard that also works when the renderer is loaded from file:// (not a secure context). */
export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    /* fall through */
  }
  try {
    const el = document.createElement('textarea')
    el.value = value
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(el)
    return ok
  } catch {
    return false
  }
}

/**
 * Reveal the app's data folder. file:// URLs never reach the window-open handler — Chromium
 * refuses the local-resource load first — so this must go through main (shell.openPath).
 */
export function openInExplorer(_path: string): void {
  void window.courseless.openDataDir()
}

/**
 * Are we on a Mac? Windows that never fetch AppInfo (the pill, the float) still have to label a
 * key correctly, so this reads the user agent rather than plumbing the platform to every corner.
 * `navigator.platform` is deprecated and lies under emulation; userAgentData is asked first.
 */
export function isMacPlatform(): boolean {
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  const hay = `${uaData?.platform ?? ''} ${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`.toLowerCase()
  return hay.includes('mac')
}

/**
 * "CommandOrControl+Shift+Space" -> ["Ctrl", "Shift", "Space"], or ["⌘", "⇧", "Space"] on a Mac.
 *
 * The accelerator itself is platform-neutral — CommandOrControl is ⌘ on macOS and Ctrl elsewhere,
 * which is exactly the binding a person on either OS expects — so only the LABEL changes here.
 * Shift gets the same treatment: Mac keyboards print ⇧ on the key, Windows keyboards print Shift.
 */
export function prettyHotkey(accelerator: string, isMac = isMacPlatform()): string[] {
  if (!accelerator) return []
  return accelerator
    .split('+')
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => {
      if (k === 'CommandOrControl' || k === 'CmdOrCtrl') return isMac ? '⌘' : 'Ctrl'
      // Everything below is a Mac-only relabel: the glyphs are printed on Mac keycaps, and
      // Windows keeps the words it has always shown.
      if (!isMac) return k
      if (k === 'Command' || k === 'Cmd' || k === 'Super' || k === 'Meta') return '⌘'
      if (k === 'Shift') return '⇧'
      if (k === 'Alt' || k === 'Option') return '⌥'
      if (k === 'Control' || k === 'Ctrl') return '⌃'
      return k
    })
}

/**
 * The mark shortcut, which is fixed and lives in the main process (`MARK_HOTKEY`). It is spelled
 * out here rather than fetched because the two windows that show it — the recording pill and
 * Settings — would otherwise both need an IPC round trip to render three keycaps.
 */
export const MARK_HOTKEY = 'CommandOrControl+Shift+M'

/** ["Ctrl", "⇧", "M"] on Windows, ["⌘", "⇧", "M"] on a Mac. */
export function markHotkeyKeys(isMac = isMacPlatform()): string[] {
  return [isMac ? '⌘' : 'Ctrl', '⇧', 'M']
}
