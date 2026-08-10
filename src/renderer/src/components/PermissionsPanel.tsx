import { useEffect, useRef, useState } from 'react'
import {
  UNKNOWN_PERMISSIONS,
  type PermissionKey,
  type PermissionState,
  type PermissionsState
} from '../../../shared/types'
import { Button, Icon } from './ui'

/**
 * macOS permissions, explained once.
 *
 * The component still knows nothing about the OS: it renders the two permissions pointing needs,
 * what each one is for, and whatever live state it is handed. What it gained in the port is the
 * ability to fetch that state itself (`live`), because both places it appears — the first-run
 * step and the Settings row — want the same thing: poll while visible, offer one button, and
 * stop as soon as the surface goes away.
 *
 * Nothing here BLOCKS. Neither permission gates the library, the coach or recording, and the copy
 * says so: this is an offer, not a gate.
 */

export type { PermissionState, PermissionsState }
export { UNKNOWN_PERMISSIONS }

const ITEMS: { key: PermissionKey; label: string; why: string }[] = [
  {
    key: 'accessibility',
    label: 'Accessibility',
    why: 'Lets Courseless read the name of the button a step is about, so it can point at the real thing rather than a guess.'
  },
  {
    key: 'screenRecording',
    label: 'Screen Recording',
    why: 'Reads window titles so it knows which app is in front, and — only when reading the button fails — looks at one still image, which is then deleted.'
  }
]

const WORD: Record<PermissionState, string> = {
  granted: 'Granted',
  denied: 'Not granted',
  unknown: 'Checking'
}

function Dot({ state }: { state: PermissionState }) {
  const tone = state === 'granted' ? 'bg-success' : state === 'denied' ? 'bg-warn' : 'bg-ink-300'
  return <span className={`mt-[6px] h-[7px] w-[7px] shrink-0 rounded-full ${tone}`} />
}

/**
 * Ask main for the state, and keep asking while this is on screen.
 *
 * One second, because the answer changes in ANOTHER application: the person flips a switch in
 * System Settings and comes back expecting the row to have noticed. There is no event to
 * subscribe to — macOS does not tell a running process its TCC record changed — so polling is
 * not laziness here, it is the only mechanism. It stops the moment the surface unmounts, and the
 * probe itself is a couple of syscalls.
 */
function useLivePermissions(enabled: boolean): {
  state: PermissionsState
  request(which: PermissionKey): void
  openSettings(which: PermissionKey): void
} {
  const [state, setState] = useState<PermissionsState>(UNKNOWN_PERMISSIONS)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    if (!enabled) return
    const api = window.courseless
    const tick = (): void => {
      void api.permissions.get().then((next) => {
        if (alive.current) setState(next)
      })
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => {
      alive.current = false
      clearInterval(timer)
    }
  }, [enabled])

  return {
    state,
    request: (which) => {
      void window.courseless.permissions.request(which).then((next) => {
        if (alive.current) setState(next)
      })
    },
    openSettings: (which) => {
      void window.courseless.permissions.openSettings(which)
    }
  }
}

export function PermissionsPanel({
  state: fixedState,
  live = false,
  className = ''
}: {
  /** A state to render as-is. Ignored when `live`. */
  state?: PermissionsState
  /** Fetch and poll the real state, and offer the buttons that change it. */
  live?: boolean
  className?: string
}) {
  const { state: liveState, request, openSettings } = useLivePermissions(live)
  const state = live ? liveState : (fixedState ?? UNKNOWN_PERMISSIONS)

  return (
    <div className={className} data-testid="permissions-panel">
      <div className="space-y-3">
        {ITEMS.map((item) => {
          const value = state[item.key]
          return (
            <div key={item.key} className="flex gap-3 rounded-sm bg-sunken p-3.5" data-testid={`permission-${item.key}`}>
              <Dot state={value} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[13px] font-medium text-ink-900">{item.label}</span>
                  {live && (
                    <span
                      className={`text-[11.5px] ${value === 'granted' ? 'text-success' : value === 'denied' ? 'text-warn' : 'text-ink-400'}`}
                      data-testid={`permission-state-${item.key}`}
                    >
                      {WORD[value]}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[12.5px] leading-[1.55] text-ink-500">{item.why}</p>
                {live && value !== 'granted' && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`permission-grant-${item.key}`}
                      onClick={() => request(item.key)}
                    >
                      Allow
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid={`permission-open-${item.key}`}
                      onClick={() => openSettings(item.key)}
                    >
                      Open System Settings
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* macOS hands a Screen Recording grant to the NEXT launch, not to the process that asked
          for it — so a row that has gone green while the app is still running is telling only
          half the truth, and this says the other half. */}
      {live && state.needsRelaunch && (
        <p className="mt-3 rounded-sm bg-warn-bg px-3 py-2.5 text-[12.5px] leading-[1.55] text-warn" data-testid="permissions-relaunch">
          Screen Recording is on, but macOS only gives it to Courseless at launch. Quit and reopen
          the app and pointing will have everything it needs.
        </p>
      )}

      <p className="mt-3 flex items-start gap-2 text-[12.5px] leading-[1.55] text-ink-500">
        <span className="mt-[2px] shrink-0 text-ink-400">{Icon.pointer({ size: 13 })}</span>
        macOS asks for these the first time pointing runs. You can grant them then, or later from
        Settings — everything else works without them.
      </p>
    </div>
  )
}
