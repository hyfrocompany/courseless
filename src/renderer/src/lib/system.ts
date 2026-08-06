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

/** "CommandOrControl+Shift+Space" -> ["Ctrl", "Shift", "Space"] */
export function prettyHotkey(accelerator: string): string[] {
  if (!accelerator) return []
  return accelerator
    .split('+')
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) =>
      k === 'CommandOrControl' || k === 'CmdOrCtrl'
        ? navigator.platform.toLowerCase().includes('mac')
          ? '⌘'
          : 'Ctrl'
        : k
    )
}
