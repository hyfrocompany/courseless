import { useEffect, useState } from 'react'

/**
 * The window's own minimize / maximize / close buttons.
 *
 * These replace the native Windows title bar, so they carry its whole job: they must be exactly
 * where the muscle memory expects them (flush into the top-right corner, no rounding, no gap)
 * and the hover state must be unmistakable — a full-height block fill, red for close.
 */

const BOX = 'h-full w-[46px] shrink-0 app-no-drag inline-flex items-center justify-center'
const BASE =
  'text-ink-500 transition-colors duration-[120ms] ease-out focus-visible:shadow-[inset_0_0_0_2px_var(--c-focus)] focus-visible:outline-none'
// sunken (#F1F5F8) is only ~6 units off the header's own paper — invisible as a hover cue.
// line-1 reads instantly in both themes, and ink-300 gives the press a second, deeper step.
const QUIET = 'hover:bg-line hover:text-ink-900 active:bg-ink-300 dark:active:bg-ink-300'
const CLOSE = 'hover:bg-[#E81123] hover:text-white active:bg-[#C50F1F]'

function glyph(children: React.ReactNode) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="square"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

const MINIMIZE = glyph(<path d="M0.5 5.2h9" />)
const MAXIMIZE = glyph(<rect x="0.9" y="0.9" width="8.2" height="8.2" />)
const RESTORE = glyph(
  <>
    <path d="M2.6 2.6V0.9h6.5v6.5H7.4" />
    <rect x="0.9" y="2.6" width="6.5" height="6.5" />
  </>
)
const CLOSE_GLYPH = glyph(
  <>
    <path d="M0.9 0.9l8.2 8.2" />
    <path d="M9.1 0.9l-8.2 8.2" />
  </>
)

export function WindowControls({ position = 'absolute' }: { position?: 'absolute' | 'fixed' }) {
  const api = window.courseless
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void api.winControl('query').then(setMaximized)
    return api.onWinState(setMaximized)
  }, [api])

  const run = (cmd: 'minimize' | 'maximize' | 'close'): void => {
    void api.winControl(cmd).then(setMaximized)
  }

  return (
    <div
      data-testid="window-controls"
      className={`${position} right-0 top-0 z-50 flex h-[48px] items-stretch`}
    >
      <button
        type="button"
        data-testid="win-minimize"
        aria-label="Minimize"
        title="Minimize"
        onClick={() => run('minimize')}
        className={`${BOX} ${BASE} ${QUIET}`}
      >
        {MINIMIZE}
      </button>
      <button
        type="button"
        data-testid="win-maximize"
        aria-label={maximized ? 'Restore down' : 'Maximize'}
        title={maximized ? 'Restore down' : 'Maximize'}
        onClick={() => run('maximize')}
        className={`${BOX} ${BASE} ${QUIET}`}
      >
        {maximized ? RESTORE : MAXIMIZE}
      </button>
      <button
        type="button"
        data-testid="win-close"
        aria-label="Close"
        title="Close"
        onClick={() => run('close')}
        className={`${BOX} ${BASE} ${CLOSE}`}
      >
        {CLOSE_GLYPH}
      </button>
    </div>
  )
}

/** First-run renders without the Nav, so it needs its own drag strip behind the controls. */
export function TitleBarStrip() {
  return (
    <>
      <div className="app-drag fixed inset-x-0 top-0 z-40 h-[48px]" />
      <WindowControls position="fixed" />
    </>
  )
}
