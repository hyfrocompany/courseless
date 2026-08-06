import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { EMPTY_RUNNER_STATE, type RunnerState, type Settings } from '../../shared/types'
import { PointNote, ShowMeIconButton, pointNote } from './components/Point'
import { Icon, Kbd, Mono } from './components/ui'

// -webkit-app-region lives outside React's CSSProperties typing.
const DRAG: CSSProperties = { WebkitAppRegion: 'drag' } as CSSProperties
const NO_DRAG: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties

/** Window content heights. Main clamps to the same numbers; these drive the request. */
const H_RESTING = 300
const H_COACH = 480

/**
 * The float widget: a compact, always-on-top step card pinned over whatever app you are learning.
 * It has to read like a sticky note left on the screen, not a debug panel.
 *
 * Since B6 this is the DEFAULT surface for a lesson, so it carries the whole loop: the step, the
 * hints, the pointer, and — one key away — the coach, on the same thread the window shows.
 */
export default function Float() {
  const api = window.courseless
  const [state, setState] = useState<RunnerState>({ ...EMPTY_RUNNER_STATE })
  const [settings, setSettings] = useState<Settings | null>(null)
  const [coachOpen, setCoachOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [explainerDone, setExplainerDone] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void api.runner.getState().then(setState)
    return api.runner.onState(setState)
  }, [api])

  // theme (and the pin explainer flag) follow the same persisted settings as the main window
  useEffect(() => {
    void api.settings.get().then(setSettings)
    return api.settings.onChange(setSettings)
  }, [api])

  useEffect(() => {
    const dark = settings?.theme === 'dark'
    document.documentElement.classList.toggle('dark', dark)
    document.body.style.colorScheme = dark ? 'dark' : 'light'
  }, [settings?.theme])

  const step = state.step
  const coach = state.coach ?? null
  const act = (type: 'done' | 'hint' | 'skip' | 'close' | 'point' | 'coach-open'): void => {
    void api.runner.sendAction({ type, source: 'float' })
  }

  // ---------------------------------------------------------------- the one-time explainer
  // Shown the first time a lesson runs pinned, and never again. It is the only moment the widget
  // is allowed to explain itself: after this, the keys are the explanation.
  const showExplainer = !!settings && !settings.pinExplainerSeen && !explainerDone && state.active
  const dismissExplainer = useCallback(() => {
    setExplainerDone(true)
    void api.settings.set({ pinExplainerSeen: true })
  }, [api])

  // ---------------------------------------------------------------- coach panel
  // The window has to do the resizing (a frameless Windows window clamps its own content size),
  // so the panel and the widget's height are one thing driven from here.
  useEffect(() => {
    void api.floatResize(coachOpen ? H_COACH : H_RESTING)
  }, [api, coachOpen])

  // A new lesson starts on the step, not mid-conversation.
  useEffect(() => {
    setCoachOpen(false)
  }, [state.lessonId])

  useEffect(() => {
    if (coachOpen) inputRef.current?.focus()
  }, [coachOpen])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [coach?.lines.length, coach?.stream, coachOpen])

  const send = useCallback(() => {
    const text = draft.trim()
    if (!text || coach?.busy) return
    setDraft('')
    void api.runner.sendAction({ type: 'coach-ask', source: 'float', text })
  }, [api, coach?.busy, draft])

  // keyboard-first here too — the float gets keys whenever it has focus
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // The explainer eats exactly one keypress, whichever it is, and is gone for good.
      if (showExplainer) {
        e.preventDefault()
        dismissExplainer()
        return
      }
      const t = e.target as HTMLElement | null
      const typing = !!t && ['INPUT', 'TEXTAREA'].includes(t.tagName)
      if (e.key === 'Escape') {
        e.preventDefault()
        // Esc ladder, innermost first: a live pointer, then the coach panel, then the widget
        // itself — which now means "give me the window back", because the window stepped aside.
        if (state.pointing && state.pointing !== 'idle') void api.point.dismiss()
        else if (coachOpen) setCoachOpen(false)
        else act('close')
        return
      }
      if (typing || !state.active) return
      const k = e.key.toLowerCase()
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        act('done')
      } else if (k === 'h') {
        e.preventDefault()
        act('hint')
      } else if (k === 's') {
        e.preventDefault()
        act('skip')
      } else if (k === 'p') {
        e.preventDefault()
        act('point')
      } else if (k === 'c') {
        e.preventDefault()
        setCoachOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.active, state.pointing, coachOpen, showExplainer, dismissExplainer])

  const hint = state.hintLevel > 0 ? step?.hint_levels[Math.min(state.hintLevel, 3) - 1] : null
  const note = pointNote(state.pointResult ?? null)
  const hiddenLines = Math.max(0, (coach?.total ?? 0) - (coach?.lines.length ?? 0))

  return (
    <div className="h-screen w-screen bg-transparent p-[10px]">
      <div
        data-testid="float-card"
        data-stalled={state.stalled ? '1' : '0'}
        data-coach={coachOpen ? '1' : '0'}
        className={`relative flex h-full w-full flex-col overflow-hidden rounded-lg bg-surface shadow-float ${
          state.stalled ? 'cl-nudge' : 'ring-hairline'
        }`}
      >
        {/* drag strip */}
        <div
          className="flex shrink-0 items-center gap-2.5 border-b border-line-2 px-3 py-2"
          style={DRAG}
          data-testid="float-drag"
        >
          <span className="flex gap-[3px]" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-[3px] w-[3px] rounded-full bg-ink-300" />
            ))}
            {[0, 1, 2].map((i) => (
              <span key={`b${i}`} className="h-[3px] w-[3px] rounded-full bg-ink-300" />
            ))}
          </span>
          {state.active ? (
            <Mono className="text-[11px] font-medium text-ocean-700 dark:text-ocean-300" data-testid="float-progress">
              {state.stepIndex + 1}/{state.total}
            </Mono>
          ) : (
            <Mono className="text-[11px] text-ink-400" data-testid="float-progress">
              idle
            </Mono>
          )}
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-500" data-testid="float-title">
            {state.title || 'courseless'}
          </span>
          <span className="flex shrink-0 items-center gap-0.5" style={NO_DRAG}>
            <button
              type="button"
              aria-label={coachOpen ? 'Close the coach' : 'Ask the coach'}
              title={coachOpen ? 'Close the coach (C)' : 'Ask the coach (C)'}
              data-testid="float-coach-toggle"
              aria-expanded={coachOpen}
              disabled={!state.active}
              onClick={() => setCoachOpen((v) => !v)}
              className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors duration-150 disabled:opacity-35 ${
                coachOpen ? 'bg-chip text-chip-ink' : 'text-ink-400 hover:bg-sunken hover:text-ink-900'
              }`}
            >
              {Icon.chat({ size: 13 })}
            </button>
            <button
              type="button"
              aria-label="Back to the window"
              title="Back to the window (Esc)"
              data-testid="float-expand"
              onClick={() => act('close')}
              className="flex h-6 w-6 items-center justify-center rounded-full text-ink-400 transition-colors duration-150 hover:bg-sunken hover:text-ink-900"
            >
              {Icon.expand({ size: 13 })}
            </button>
            <button
              type="button"
              aria-label="Hide"
              title="Hide"
              data-testid="float-close"
              onClick={() => void api.floatControl('close')}
              className="flex h-6 w-6 items-center justify-center rounded-full text-ink-400 transition-colors duration-150 hover:bg-sunken hover:text-ink-900"
            >
              {Icon.close({ size: 13 })}
            </button>
          </span>
        </div>

        {/* body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
          {state.active && step ? (
            <>
              <p
                data-testid="float-action"
                className="text-[15px] font-semibold leading-[1.35] tracking-[-0.01em] text-ink-900 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden"
              >
                {step.action}
              </p>
              <p
                data-testid="float-where"
                className="mt-1.5 text-[12.5px] leading-[1.45] text-ink-500 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden"
              >
                {step.where}
              </p>
              {hint ? (
                <div
                  data-testid="float-hint"
                  className="fade mt-2.5 rounded-sm bg-mist px-2.5 py-2 text-[12px] leading-[1.45] text-ink-700 ring-1 ring-[var(--c-mist-line)]"
                >
                  <Mono className="mr-1.5 text-[9.5px] uppercase tracking-[0.12em] text-mist-ink">
                    hint {state.hintLevel}
                  </Mono>
                  {hint}
                </div>
              ) : (
                <div className="mt-2.5 rounded-sm bg-sunken px-2.5 py-2 text-[11.5px] leading-[1.4] text-ink-500">
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-400">
                    you should see{' '}
                  </span>
                  {step.checkpoint}
                </div>
              )}
              {note && (
                <div className="mt-2">
                  <PointNote text={note} compact />
                </div>
              )}
              {state.stalled && !note && (
                <p data-testid="float-stall" className="fade mt-2 text-[11.5px] leading-[1.4] text-ocean-700 dark:text-ocean-300">
                  Stuck? <Kbd className="h-[16px] min-w-[16px] px-1 text-[9px]">H</Kbd> hint ·{' '}
                  <Kbd className="h-[16px] min-w-[16px] px-1 text-[9px]">C</Kbd> coach
                </p>
              )}
            </>
          ) : (
            <div data-testid="float-idle" className="pt-2 text-[12.5px] leading-relaxed text-ink-500">
              No lesson running. Start one in the Courseless window and it will show up here.
            </div>
          )}
        </div>

        {/* coach — the same thread the window shows, at widget scale */}
        {coachOpen && (
          <div
            data-testid="float-coach"
            style={NO_DRAG}
            className="flex h-[214px] shrink-0 flex-col border-t border-line-2 bg-paper"
          >
            <div className="flex shrink-0 items-center gap-2 px-3 pb-1 pt-2">
              <Mono className="text-[9.5px] font-medium uppercase tracking-[0.12em] text-ocean-700 dark:text-ocean-300">
                coach
              </Mono>
              <Mono className="text-[10px] text-ink-400">step {state.stepIndex + 1}</Mono>
              <button
                type="button"
                data-testid="float-coach-continue"
                onClick={() => act('coach-open')}
                title="Open this conversation in the window"
                className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-ink-400 underline decoration-line underline-offset-[3px] transition-colors duration-150 hover:text-ink-900"
              >
                continue in window {Icon.arrowRight({ size: 11 })}
              </button>
            </div>

            <div
              ref={logRef}
              data-testid="float-coach-log"
              className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-1.5"
            >
              {hiddenLines > 0 && (
                <p className="text-center text-[10px] text-ink-400">
                  {hiddenLines} earlier {hiddenLines === 1 ? 'message' : 'messages'} — in the window
                </p>
              )}
              {(coach?.lines.length ?? 0) === 0 && !coach?.stream && (
                <p className="pt-1 text-[11.5px] leading-[1.45] text-ink-500">
                  It has this lesson in context. Say what you are looking at.
                </p>
              )}
              {(coach?.lines ?? []).map((m, i) =>
                m.role === 'you' ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[84%] rounded-sm rounded-br-xs bg-chip px-2.5 py-1.5 text-[11.5px] leading-[1.45] text-chip-ink">
                      {m.text}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex" data-testid="float-coach-msg">
                    <div className="max-w-[92%] whitespace-pre-wrap rounded-sm rounded-bl-xs bg-sunken px-2.5 py-1.5 text-[11.5px] leading-[1.45] text-ink-700">
                      {m.text}
                    </div>
                  </div>
                )
              )}
              {coach?.stream && (
                <div className="flex" data-testid="float-coach-stream">
                  <div className="max-w-[92%] whitespace-pre-wrap rounded-sm rounded-bl-xs bg-sunken px-2.5 py-1.5 text-[11.5px] leading-[1.45] text-ink-700">
                    {coach.stream}
                    <span className="ml-0.5 inline-block h-[11px] w-[2px] translate-y-[2px] bg-ocean-500 pulse-dot" />
                  </div>
                </div>
              )}
              {coach?.busy && !coach.stream && (
                <div className="flex items-center gap-1.5 text-[11px] text-ink-400">
                  <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-ocean-500" />
                  thinking
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1.5 px-3 pb-2.5 pt-1.5">
              <input
                ref={inputRef}
                data-testid="float-coach-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') send()
                }}
                placeholder="What are you seeing?"
                aria-label="Message the coach"
                className="h-8 min-w-0 flex-1 rounded-full bg-sunken px-3 text-[12px] text-ink-900 ring-hairline focus:outline-none focus:shadow-[inset_0_0_0_1px_var(--c-focus)]"
              />
              <button
                type="button"
                data-testid="float-coach-send"
                disabled={!draft.trim() || !!coach?.busy}
                onClick={send}
                className="h-8 shrink-0 rounded-full bg-fill px-3 text-[12px] font-medium text-white transition-colors duration-150 hover:bg-[var(--c-fill-hover)] disabled:opacity-35 dark:text-[#04121d]"
              >
                Ask
              </button>
            </div>
          </div>
        )}

        {/* actions */}
        <div className="shrink-0 border-t border-line-2 px-3 py-2.5" style={NO_DRAG}>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="float-done"
              disabled={!state.active}
              onClick={() => act('done')}
              className="h-9 flex-1 rounded-full bg-fill text-[13.5px] font-medium text-white transition-colors duration-150 hover:bg-[var(--c-fill-hover)] disabled:opacity-35 dark:text-[#04121d]"
            >
              Did it
            </button>
            {state.active && <ShowMeIconButton phase={state.pointing ?? 'idle'} onClick={() => act('point')} />}
            <button
              type="button"
              data-testid="float-hint-btn"
              disabled={!state.active}
              onClick={() => act('hint')}
              className="h-9 rounded-full px-3 text-[13px] text-ink-700 ring-hairline transition-colors duration-150 hover:bg-sunken disabled:opacity-35"
            >
              Hint
            </button>
            <button
              type="button"
              data-testid="float-skip"
              disabled={!state.active}
              onClick={() => act('skip')}
              className="h-9 rounded-full px-2.5 text-[13px] text-ink-500 transition-colors duration-150 hover:bg-sunken hover:text-ink-900 disabled:opacity-35"
            >
              Skip
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[10.5px] text-ink-400">
            <span className="inline-flex items-center gap-1">
              <Kbd className="h-[18px] min-w-[18px] px-1 text-[9.5px]">Space</Kbd> did it
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd className="h-[18px] min-w-[18px] px-1 text-[9.5px]">H</Kbd> hint
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd className="h-[18px] min-w-[18px] px-1 text-[9.5px]">P</Kbd> show me
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd className="h-[18px] min-w-[18px] px-1 text-[9.5px]">C</Kbd> coach
            </span>
            {state.hintsUsed > 0 && (
              <Mono className="ml-auto text-[10px] text-ink-400">{state.hintsUsed} used</Mono>
            )}
          </div>
        </div>

        {/* first pinned session, once, ever */}
        {showExplainer && (
          <div
            data-testid="float-explainer"
            style={NO_DRAG}
            onPointerDown={dismissExplainer}
            className="fade absolute inset-0 z-10 flex cursor-pointer flex-col justify-center gap-3 bg-surface px-4"
          >
            <div>
              <p className="font-display text-[19px] leading-[1.2] tracking-[-0.02em] text-ink-900">
                Courseless gets out of the way.
              </p>
              <p className="mt-1.5 text-[12px] leading-[1.45] text-ink-500">
                The lesson lives here now, over your work. The window is one key away.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11.5px] text-ink-700">
              <span className="inline-flex items-center gap-1.5">
                <Kbd className="h-[18px] min-w-[18px] px-1 text-[9.5px]">Space</Kbd> did it
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Kbd className="h-[18px] min-w-[18px] px-1 text-[9.5px]">H</Kbd> hint
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Kbd className="h-[18px] min-w-[18px] px-1 text-[9.5px]">P</Kbd> show me
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Kbd className="h-[18px] min-w-[18px] px-1 text-[9.5px]">C</Kbd> coach
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Kbd className="h-[18px] min-w-[18px] px-1 text-[9.5px]">Esc</Kbd> expand
              </span>
            </div>
            <p className="text-[10.5px] text-ink-400">Any key, or click, to begin.</p>
          </div>
        )}
      </div>
    </div>
  )
}
