import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { EMPTY_RECORDING, type RecordingState } from '../../shared/types'
import { Icon, Kbd, Mono } from './components/ui'
import { clock } from './lib/format'

const DRAG: CSSProperties = { WebkitAppRegion: 'drag' } as CSSProperties
const NO_DRAG: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties

/**
 * The recording pill.
 *
 * It sits over the app the author is teaching, so it has exactly two jobs: prove the recording is
 * live, and take a mark without being in the way. Everything else — the name, the audience, the
 * marks themselves — lives in the main window and in the compiled lesson.
 *
 * The pill never grows on its own. The note row appears only after a mark, and the window height
 * follows the card so the transparent tail never sits over the desktop eating clicks.
 */
export default function Record() {
  const api = window.courseless
  const [state, setState] = useState<RecordingState>({ ...EMPTY_RECORDING })
  const [now, setNow] = useState(Date.now())
  const [note, setNote] = useState('')
  const noteRef = useRef<HTMLInputElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void api.record.getState().then(setState)
    return api.record.onState(setState)
  }, [api])

  useEffect(() => {
    const apply = (theme: 'light' | 'dark'): void => {
      document.documentElement.classList.toggle('dark', theme === 'dark')
      document.body.style.colorScheme = theme
    }
    void api.settings.get().then((s) => apply(s.theme))
    return api.settings.onChange((s) => apply(s.theme))
  }, [api])

  // the clock is the proof of life
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])

  const noteOpen = !!state.noteFor
  useEffect(() => {
    if (noteOpen) setNote('')
  }, [state.noteFor, noteOpen])

  // The window is only ever as tall as the card. Measured, not assumed, so the note row and any
  // future row cannot leave a transparent strip over someone's desktop.
  useLayoutEffect(() => {
    const h = cardRef.current?.getBoundingClientRect().height
    if (h) void api.record.pillHeight(Math.ceil(h) + 16)
  }, [api, noteOpen])

  const elapsed = state.startedAtMs ? Math.max(0, Math.round((now - state.startedAtMs) / 1000)) : 0
  const marks = state.marks.length
  const last = state.marks[marks - 1]
  const recording = state.phase === 'recording'

  const submitNote = (): void => {
    void api.record.note(note)
    setNote('')
  }

  return (
    <div className="h-screen w-screen bg-transparent p-[8px]">
      <div
        ref={cardRef}
        data-testid="pill"
        data-marks={marks}
        className="w-full overflow-hidden rounded-[14px] bg-surface shadow-float ring-hairline"
      >
        {/* ------------------------------------------------------------ the strip */}
        <div className="flex items-center gap-3 px-3 py-[9px]" style={DRAG}>
          {/* the one red thing in the whole app — it means "this is being recorded" */}
          <span className="flex shrink-0 items-center gap-2" data-testid="pill-live">
            <span
              className={`h-[9px] w-[9px] rounded-full bg-danger ${recording ? 'pulse-dot' : ''}`}
              aria-hidden="true"
            />
            <Mono className="text-[11px] font-medium uppercase tracking-[0.14em] text-danger">rec</Mono>
          </span>

          <Mono data-testid="pill-clock" className="shrink-0 text-[13px] font-medium tabular text-ink-900">
            {clock(elapsed)}
          </Mono>

          <span className="h-[14px] w-px shrink-0 bg-line" aria-hidden="true" />

          <span className="flex min-w-[190px] flex-1 items-baseline gap-2">
            <Mono
              data-testid="pill-marks"
              className={`shrink-0 text-[12.5px] tabular transition-opacity duration-150 ${
                state.capturing ? 'text-ocean-600 opacity-60 dark:text-ocean-400' : 'text-ink-700'
              }`}
            >
              {marks} {marks === 1 ? 'mark' : 'marks'}
            </Mono>
            {/* what the last mark actually caught — the author's only feedback that the capture
                landed on the thing they meant */}
            <span
              data-testid="pill-last"
              className="min-w-0 flex-1 truncate text-[12px] text-ink-400"
              title={last?.element?.name ?? ''}
            >
              {state.capturing
                ? 'reading the screen…'
                : last?.element?.name
                  ? `last: ${last.element.name}`
                  : last
                    ? 'last: no element there'
                    : state.name}
            </span>
          </span>

          <span className="flex shrink-0 items-center gap-1.5" style={NO_DRAG}>
            <button
              type="button"
              data-testid="pill-mark"
              onClick={() => void api.record.mark()}
              disabled={!recording}
              className="inline-flex h-8 items-center gap-2 rounded-full bg-fill px-3.5 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-[var(--c-fill-hover)] disabled:opacity-40 dark:text-[#04121d]"
            >
              Mark
              <span className="flex items-center gap-1 opacity-80">
                <Kbd className="h-[17px] min-w-0 bg-white/18 px-1 text-[9.5px] text-white ring-0 dark:bg-black/15 dark:text-[#04121d]">
                  Ctrl
                </Kbd>
                <Kbd className="h-[17px] min-w-0 bg-white/18 px-1 text-[9.5px] text-white ring-0 dark:bg-black/15 dark:text-[#04121d]">
                  ⇧
                </Kbd>
                <Kbd className="h-[17px] min-w-[17px] bg-white/18 px-1 text-[9.5px] text-white ring-0 dark:bg-black/15 dark:text-[#04121d]">
                  M
                </Kbd>
              </span>
            </button>
            <button
              type="button"
              data-testid="pill-undo"
              aria-label="Undo the last mark"
              title="Undo the last mark"
              disabled={marks === 0}
              onClick={() => void api.record.undo()}
              className="inline-flex h-8 items-center rounded-full px-2.5 text-[12.5px] text-ink-500 transition-colors duration-150 hover:bg-sunken hover:text-ink-900 disabled:pointer-events-none disabled:opacity-35"
            >
              Undo
            </button>
            <button
              type="button"
              data-testid="pill-stop"
              onClick={() => void api.record.stop()}
              className="inline-flex h-8 items-center rounded-full px-3 text-[13px] font-medium text-ink-900 ring-hairline transition-colors duration-150 hover:bg-sunken"
            >
              Stop
            </button>
            <button
              type="button"
              data-testid="pill-cancel"
              aria-label="Discard this recording"
              title="Discard this recording"
              onClick={() => void api.record.cancel()}
              className="flex h-7 w-7 items-center justify-center rounded-full text-ink-400 transition-colors duration-150 hover:bg-[var(--c-danger-bg)] hover:text-danger"
            >
              {Icon.close({ size: 14 })}
            </button>
          </span>
        </div>

        {/* ------------------------------------------------------------ the note row */}
        {noteOpen && (
          <div
            className="fade flex items-center gap-2.5 border-t border-line-2 bg-sunken px-3 py-2"
            style={NO_DRAG}
            data-testid="pill-note-row"
          >
            <Mono className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-ink-400">
              mark {marks}
            </Mono>
            <input
              ref={noteRef}
              data-testid="pill-note"
              value={note}
              autoComplete="off"
              spellCheck={false}
              aria-label="What just happened"
              placeholder="what just happened? optional"
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitNote()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  void api.record.note('')
                  setNote('')
                }
              }}
              className="h-7 min-w-0 flex-1 rounded-full bg-surface px-3 text-[12.5px] ring-hairline focus:outline-none focus:shadow-[inset_0_0_0_1px_var(--c-focus)]"
            />
            <span className="hidden shrink-0 items-center gap-1.5 text-[10.5px] text-ink-400 sm:flex">
              <Kbd className="h-[16px] min-w-[16px] px-1 text-[9px]">↵</Kbd> save
              <Kbd className="h-[16px] min-w-[16px] px-1 text-[9px]">esc</Kbd> skip
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
