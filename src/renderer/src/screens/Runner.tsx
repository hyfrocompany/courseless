import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { CoachLine, FadeTier, Lesson, PointPhase, PointResult } from '../../../shared/types'
import { Breadcrumb } from '../components/Breadcrumb'
import { FadeDot, TIER_LABEL } from '../components/FadeDots'
import { AutoPointToggle, PointNote, ShowMeButton, pointNote } from '../components/Point'
import { Button, Eyebrow, Icon, IconButton, Kbd, Mono, Tag } from '../components/ui'
import { clock } from '../lib/format'

const HINT_LABEL = ['nudge', 'detail', 'exact path']

/** The coach is a panel, not a modal: it takes width from the step column instead of covering it,
 *  which is the difference between usable and not at the 960px minimum window size. */
export const COACH_DRAWER = 380

/** The conversation is shared with the float, so its shape lives in shared/types. */
export type { CoachLine }

export function Runner({
  lesson,
  index,
  hintLevel,
  hintsUsed,
  elapsed,
  practice,
  tries,
  floatOpen,
  coachOpen,
  pointPhase,
  pointResult,
  autoPoint,
  stalled,
  chat,
  coachStream,
  coachBusy,
  coachStatus,
  coachLimit,
  renderLimit,
  coachInput,
  setCoachInput,
  onSendCoach,
  onDone,
  onHint,
  onSkip,
  onPrev,
  onTried,
  onPoint,
  onToggleAutoPoint,
  onToggleFloat,
  onToggleCoach,
  onExit,
  onLibrary
}: {
  lesson: Lesson
  index: number
  hintLevel: number
  hintsUsed: number
  elapsed: number
  practice: boolean
  tries: number
  floatOpen: boolean
  coachOpen: boolean
  pointPhase: PointPhase
  pointResult: PointResult | null
  autoPoint: boolean
  stalled: boolean
  chat: CoachLine[]
  coachStream: string
  coachBusy: boolean
  coachStatus: string
  /** Set when the coach hit this month's ceiling: the panel says so calmly instead of erroring. */
  coachLimit: string
  /** Supplied by the window that knows about plans; the runner only decides where it goes. */
  renderLimit?(message: string, compact?: boolean): ReactNode
  coachInput: string
  setCoachInput(v: string): void
  onSendCoach(): void
  onDone(): void
  onHint(): void
  onSkip(): void
  onPrev(): void
  onTried(): void
  onPoint(): void
  onToggleAutoPoint(): void
  onToggleFloat(): void
  onToggleCoach(): void
  onExit(): void
  onLibrary(): void
}) {
  const step = lesson.steps[index]
  const total = lesson.steps.length
  const effectiveTier = (practice ? Math.min(3, step.fade_tier + 1) : step.fade_tier) as FadeTier
  const hintsLocked = practice && tries < 2
  const [whereOpen, setWhereOpen] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const coachRef = useRef<HTMLInputElement>(null)

  useEffect(() => setWhereOpen(false), [index])
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [chat.length, coachStream])
  useEffect(() => {
    if (coachOpen) coachRef.current?.focus()
  }, [coachOpen])

  const soloHidden = effectiveTier === 3 && !whereOpen
  const shift = coachOpen ? COACH_DRAWER : 0
  const note = pointNote(pointResult)

  return (
    <div data-testid="view-runner" className="relative flex min-h-full flex-col">
      {/* breadcrumb + progress, in the one strip every detail screen puts it in */}
      <div className="sticky top-0 z-30 border-b border-line bg-[var(--c-glass)] backdrop-blur-md">
        <div className="h-[3px] w-full bg-line-2">
          <div
            className="h-full bg-ocean-500 transition-[width] duration-300 ease-out"
            style={{ width: `${Math.max(2, (index / total) * 100)}%` }}
          />
        </div>
        <div className="mx-auto flex h-[38px] w-full max-w-[760px] items-center gap-3 px-8">
          <Breadcrumb current={lesson.title} onRoot={onLibrary} />
          {practice && <Tag className="shrink-0 bg-chip text-chip-ink">Practice</Tag>}
          <div className="ml-auto flex shrink-0 items-center gap-2.5">
            <AutoPointToggle on={autoPoint} onToggle={onToggleAutoPoint} />
            <Mono className="text-[11.5px] text-ink-500" data-testid="runner-progress">
              step {index + 1}/{total}
            </Mono>
            <Mono className="text-[11.5px] text-ink-400" data-testid="runner-timer">
              {clock(elapsed)}
            </Mono>
            {/* Pinning is the main event now, not a 28px glyph in the corner: it says what it
                does, and it says it in the same words the lesson page uses. */}
            <Button
              data-testid="float-btn"
              variant={floatOpen ? 'ghost' : 'outline'}
              size="sm"
              onClick={onToggleFloat}
              title={
                floatOpen
                  ? 'Bring the lesson back into this window'
                  : 'Float the lesson over your work and step this window aside'
              }
              className={floatOpen ? 'bg-chip text-chip-ink hover:bg-chip' : ''}
            >
              {Icon.pin({ size: 14 })} {floatOpen ? 'Pinned' : 'Pin to screen'}
            </Button>
            <button
              type="button"
              data-testid="runner-exit"
              onClick={onExit}
              title="Leave the run (Esc)"
              className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[12px] text-ink-500 transition-colors duration-150 hover:bg-sunken hover:text-ink-900"
            >
              {Icon.arrowLeft({ size: 13 })} Exit
            </button>
          </div>
        </div>
      </div>

      {/* step */}
      <div className="mx-auto w-full max-w-[760px] flex-1 px-8 pb-[70px] pt-8">
        <div key={index} className="rise">
          <div className="flex items-center gap-2.5">
            <FadeDot tier={effectiveTier} size={12} className="text-ocean-600 dark:text-ocean-400" />
            <Eyebrow>{TIER_LABEL[effectiveTier]}</Eyebrow>
            {practice && effectiveTier !== step.fade_tier && (
              <Mono className="text-[10px] uppercase tracking-[0.12em] text-ink-400">
                tier {step.fade_tier} → {effectiveTier}
              </Mono>
            )}
          </div>

          <h1
            data-testid="runner-action"
            className="mt-2.5 text-[22px] font-semibold leading-[1.3] tracking-[-0.015em] text-ink-900"
          >
            {step.action}
          </h1>

          {soloHidden ? (
            <button
              type="button"
              onClick={() => setWhereOpen(true)}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-sunken px-3 py-1.5 text-[12.5px] text-ink-500 transition-colors duration-150 hover:text-ink-900"
            >
              {Icon.search({ size: 13 })} Show where it lives
            </button>
          ) : (
            <p data-testid="runner-where" className="mt-2.5 text-[14.5px] leading-[1.55] text-ink-500">
              {step.where}
            </p>
          )}

          {/* the honest half of the accuracy contract: when the arrow cannot be given, say so
              here — right under the words that describe the same place */}
          {/* A used-up allowance is not a failed point: it gets the calm card, not the miss note. */}
          {pointResult?.outcome === 'limit' && renderLimit ? (
            <div className="mt-3 max-w-[520px]">{renderLimit(pointResult.message)}</div>
          ) : (
            note && <div className="mt-2">{<PointNote text={note} />}</div>
          )}

          {step.why && (
            <p className="mt-1.5 text-[13px] italic leading-relaxed text-ink-400">{step.why}</p>
          )}

          <div
            data-testid="runner-checkpoint"
            className="mt-5 rounded-md bg-mist p-4 ring-1 ring-[var(--c-mist-line)]"
          >
            <Eyebrow className="!text-mist-ink">You should see</Eyebrow>
            <p className="mt-1.5 text-[14.5px] leading-[1.5] text-ink-900">{step.checkpoint}</p>
          </div>

          {/* hint ladder */}
          <div className="mt-5">
            <div className="flex items-center gap-3">
              <Eyebrow tone="muted">Stuck?</Eyebrow>
              <Mono className="text-[11px] text-ink-400">
                hints {hintsUsed}/3
                {practice && ` · tries ${Math.min(tries, 2)}/2`}
              </Mono>
              {stalled && (
                <span data-testid="runner-stall" className="fade text-[12px] text-ocean-700 dark:text-ocean-300">
                  Still on this one? A hint or the coach is right here.
                </span>
              )}
            </div>

            {hintLevel === 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {hintsLocked ? (
                  <>
                    <span className="inline-flex items-center gap-2 rounded-full bg-sunken px-3 py-1.5 text-[13px] text-ink-400">
                      Hints locked — prove it first
                    </span>
                    <Button data-testid="tried-btn" variant="outline" size="sm" onClick={onTried}>
                      Tried it, no luck
                    </Button>
                  </>
                ) : (
                  <button
                    type="button"
                    data-testid="hint-ghost"
                    onClick={onHint}
                    className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] text-ink-500 ring-hairline transition-colors duration-150 hover:bg-sunken hover:text-ink-900"
                  >
                    <Kbd>H</Kbd> for a hint
                  </button>
                )}
              </div>
            )}

            {hintLevel > 0 && (
              <div className="mt-2 space-y-2" data-testid="runner-hints">
                {step.hint_levels.slice(0, hintLevel).map((h, i) => (
                  <div key={i} className="rise rounded-md bg-surface px-3.5 py-3 ring-hairline">
                    <Mono className="text-[10px] uppercase tracking-[0.12em] text-ocean-700 dark:text-ocean-300">
                      {HINT_LABEL[i] ?? `hint ${i + 1}`}
                    </Mono>
                    <p className="mt-1 text-[14px] leading-[1.5] text-ink-700">{h}</p>
                  </div>
                ))}
                {hintLevel < 3 && (
                  <button
                    type="button"
                    onClick={onHint}
                    disabled={hintsLocked}
                    className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] text-ink-500 transition-colors duration-150 hover:text-ink-900 disabled:opacity-40"
                  >
                    <Kbd>H</Kbd> go one level deeper
                  </button>
                )}
              </div>
            )}
          </div>

          {/* actions stay reachable however long the hint ladder gets */}
          <div className="sticky bottom-[46px] z-10 -mx-8 mt-6 flex flex-wrap items-center gap-2.5 bg-paper px-8 py-3 before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-5 before:bg-gradient-to-t before:from-paper before:to-transparent">
            <Button data-testid="done-btn" onClick={onDone}>
              Did it
            </Button>
            <ShowMeButton phase={pointPhase} onClick={onPoint} />
            <Button data-testid="hint-btn" variant="outline" onClick={onHint} disabled={hintsLocked || hintLevel >= 3}>
              Hint
            </Button>
            <Button data-testid="skip-btn" variant="ghost" onClick={onSkip}>
              Skip
            </Button>
            {index > 0 && (
              <Button data-testid="back-btn" variant="ghost" onClick={onPrev}>
                Back
              </Button>
            )}
            <Button
              data-testid="coach-btn"
              variant="ghost"
              onClick={onToggleCoach}
              className={coachOpen ? 'bg-sunken text-ink-900' : ''}
            >
              {Icon.chat({ size: 15 })} Coach
            </Button>
          </div>
        </div>
      </div>

      {/* keyboard footer */}
      <div
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-[var(--c-glass)] backdrop-blur-md transition-[padding] duration-200 ease-out"
        style={{ paddingRight: shift }}
      >
        <div className="mx-auto flex h-[46px] w-full max-w-[760px] items-center gap-4 px-8 text-[11.5px] text-ink-500">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>Space</Kbd> Did it
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>H</Kbd> Hint
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>S</Kbd> Skip
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>P</Kbd> Show me
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>C</Kbd> Coach
          </span>
          <Mono className="ml-auto text-[11px] text-ink-400">
            {lesson.tool}
          </Mono>
        </div>
      </div>

      {/* coach drawer */}
      {coachOpen && (
        <>
          {/* starts below the title bar so the window controls are never covered */}
          <aside
            data-testid="coach-drawer"
            style={{ width: COACH_DRAWER }}
            className="slide-in fixed right-0 top-[48px] z-40 flex h-[calc(100%-48px)] flex-col border-l border-line bg-paper"
          >
            <div className="flex h-[38px] shrink-0 items-center gap-2 border-b border-line px-5">
              <Eyebrow>Coach</Eyebrow>
              <Mono className="text-[11px] text-ink-400">step {index + 1}</Mono>
              <IconButton label="Close coach" size="sm" onClick={onToggleCoach} className="ml-auto">
                {Icon.close({ size: 16 })}
              </IconButton>
            </div>

            <div ref={logRef} data-testid="coach-log" className="flex-1 space-y-2.5 overflow-y-auto px-4 py-4">
              {chat.length === 0 && !coachStream && (
                <p className="text-[13px] leading-relaxed text-ink-500">
                  It has the whole lesson in context. Describe what you are looking at and it will meet you there.
                </p>
              )}
              {chat.map((m, i) =>
                m.role === 'you' ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[86%] rounded-md rounded-br-xs bg-chip px-3.5 py-2.5 text-[13px] leading-relaxed text-chip-ink">
                      <span className="sr-only">you: </span>
                      {m.text}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex" data-testid="coach-msg">
                    <div className="max-w-[92%] whitespace-pre-wrap rounded-md rounded-bl-xs bg-surface px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-700 ring-hairline">
                      <span className="sr-only">coach: </span>
                      {m.text}
                    </div>
                  </div>
                )
              )}
              {coachStream && (
                <div className="flex" data-testid="coach-stream">
                  <div className="max-w-[92%] whitespace-pre-wrap rounded-md rounded-bl-xs bg-surface px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-700 ring-hairline">
                    <span className="sr-only">coach: </span>
                    {coachStream}
                    <span className="ml-0.5 inline-block h-[13px] w-[2px] translate-y-[2px] bg-ocean-500 pulse-dot" />
                  </div>
                </div>
              )}
              {coachBusy && !coachStream && (
                <div className="flex items-center gap-2 text-[12px] text-ink-400">
                  <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-ocean-500" />
                  thinking
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-line px-4 py-3">
              {coachLimit && renderLimit && <div className="mb-3">{renderLimit(coachLimit, true)}</div>}
              {coachStatus && <div className="mb-2 font-mono text-[10px] text-ink-400">{coachStatus}</div>}
              <div className="relative">
                <input
                  ref={coachRef}
                  data-testid="coach-input"
                  value={coachInput}
                  onChange={(e) => setCoachInput(e.target.value)}
                  onKeyDown={(e) => {
                    // Esc deliberately falls through to the one app-level handler that owns it
                    if (e.key === 'Enter') onSendCoach()
                  }}
                  placeholder="What are you seeing?"
                  aria-label="Message the coach"
                  className="h-10 w-full rounded-sm bg-surface pl-3 pr-[68px] text-[13.5px] ring-hairline focus:outline-none focus:shadow-[inset_0_0_0_1px_var(--c-focus)]"
                />
                <Button
                  data-testid="coach-send"
                  size="sm"
                  variant="ocean"
                  disabled={coachBusy || !coachInput.trim()}
                  onClick={onSendCoach}
                  className="absolute right-1.5 top-1.5"
                >
                  Send
                </Button>
              </div>
              <div className="mt-2 font-mono text-[10px] text-ink-400">Esc closes · the thread remembers</div>
            </div>
          </aside>
        </>
      )}
    </div>
  )
}
