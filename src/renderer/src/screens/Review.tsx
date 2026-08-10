import type { ReactNode } from 'react'
import type { Lesson, LessonRun } from '../../../shared/types'
import { Breadcrumb, BreadcrumbBar } from '../components/Breadcrumb'
import { Cover } from '../components/Cover'
import { Button, Card, Eyebrow, Icon, Mono } from '../components/ui'
import { duration, summarise } from '../lib/format'

const HATCH =
  'repeating-linear-gradient(45deg, var(--c-hatch) 0 2px, transparent 2px 6px)'

/** Assistance across every recorded run — the honest metric, plotted over time. */
function RunTrend({ runs }: { runs: LessonRun[] }) {
  const pts = runs.map((r) => summarise(r.perStep).hints + summarise(r.perStep).skips * 2)
  const w = 168
  const h = 44
  const max = Math.max(...pts, 1)
  const x = (i: number): number => (pts.length === 1 ? w / 2 : (i / (pts.length - 1)) * (w - 10) + 5)
  const y = (v: number): number => h - 6 - (v / max) * (h - 14)
  const d = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const lastX = x(pts.length - 1)
  const lastY = y(pts[pts.length - 1])

  return (
    <div>
      <Eyebrow tone="muted">Assistance, run over run</Eyebrow>
      <svg width={w} height={h} className="mt-2 overflow-visible" role="img" aria-label="Assistance per run">
        <line x1="0" y1={h - 4} x2={w} y2={h - 4} stroke="var(--c-line-1)" strokeWidth="1" />
        <path d={d} fill="none" stroke="var(--c-bar)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r="3" fill="var(--c-bar)" stroke="var(--c-surface)" strokeWidth="2" />
        ))}
        <circle cx={lastX} cy={lastY} r="4.5" fill="var(--c-mark)" stroke="var(--c-surface)" strokeWidth="2" />
      </svg>
      <Mono className="mt-1 block text-[11px] text-ink-500">
        {pts.map((p) => p).join(' → ')} · lower is better
      </Mono>
    </div>
  )
}

export function Review({
  lesson,
  run,
  suggestion,
  suggestBusy,
  onSuggest,
  onUseSuggestion,
  onRunAgain,
  onLibrary,
  onLesson,
  note
}: {
  lesson: Lesson
  run: LessonRun | null
  suggestion: { title: string; ask: string } | null
  suggestBusy: boolean
  onSuggest(): void
  onUseSuggestion(ask: string): void
  onRunAgain(practice: boolean): void
  onLibrary(): void
  onLesson(): void
  /** A quiet line about the month, when there is one worth saying. Usually null. */
  note?: ReactNode
}) {
  const perStep = run?.perStep ?? []
  const sum = summarise(perStep)
  const prev = lesson.runs.length > 1 ? summarise(lesson.runs[lesson.runs.length - 2].perStep) : null
  const delta = prev ? sum.hints - prev.hints : null
  const maxSeconds = Math.max(1, ...perStep.map((s) => s.seconds))

  // Per-step stats are stored by index. After a structural edit, index 3 is a different step —
  // so a run recorded against an older version is not comparable, and saying nothing would be a
  // lie told with a chart.
  const version = lesson.version ?? 1
  const runVersion = run ? (run.version ?? 1) : version
  const stale = runVersion !== version
  const olderRuns = lesson.runs.filter((r) => (r.version ?? 1) !== version).length

  return (
    <>
      <BreadcrumbBar>
        <Breadcrumb current={lesson.title} onRoot={onLibrary} />
      </BreadcrumbBar>

      <div data-testid="view-review" className="mx-auto w-full max-w-[860px] px-8 pb-16 pt-7">
      {note && <div className="mb-5" data-testid="review-note">{note}</div>}

      <Eyebrow>Run complete</Eyebrow>
      <h1 className="mt-1.5 max-w-[26ch] font-display text-[22px] leading-tight tracking-[-0.02em] text-ink-700">
        {lesson.title}
      </h1>

      {(stale || olderRuns > 0) && (
        <p
          data-testid="version-note"
          className="mt-3 max-w-[72ch] rounded-sm bg-warn-bg px-3.5 py-2.5 text-[12.5px] leading-[1.5] text-warn ring-1 ring-[var(--c-warn-line)]"
        >
          {stale ? (
            <>
              This run was recorded against an earlier version of the lesson (v{runVersion}, now v{version}). The
              steps have moved since, so the step-by-step breakdown below lines up with the lesson as it was, not as
              it is.
            </>
          ) : (
            <>
              {olderRuns} earlier {olderRuns === 1 ? 'run was' : 'runs were'} recorded against an earlier version of
              this lesson. The trend still shows them; the steps they measured are not quite these ones.
            </>
          )}
        </p>
      )}

      {/* headline stat */}
      <div className="mt-6 flex flex-wrap items-end justify-between gap-8 border-b border-line pb-6">
        <div data-testid="assistance-rate">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-[clamp(34px,5vw,48px)] leading-[0.95] tracking-[-0.03em] text-ink-900">
              {sum.hints}
            </span>
            <span className="font-display text-[21px] leading-none tracking-[-0.02em] text-ink-500">
              {sum.hints === 1 ? 'hint' : 'hints'}
            </span>
            {delta !== null && (
              <span
                className={`mb-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[11px] font-medium ${
                  delta < 0
                    ? 'bg-chip text-chip-ink'
                    : delta > 0
                      ? 'bg-warn-bg text-warn'
                      : 'bg-sunken text-ink-500'
                }`}
              >
                {delta === 0 ? 'same as last run' : `${delta > 0 ? '+' : ''}${delta} vs last run`}
              </span>
            )}
          </div>
          <Mono className="mt-2.5 block text-[11.5px] uppercase tracking-[0.1em] text-ink-500">
            {duration(sum.seconds)} · {sum.steps} steps
            {sum.skips > 0 ? ` · ${sum.skips} skipped` : ''}
          </Mono>
          <p className="mt-2.5 max-w-[52ch] text-[13px] text-ink-500">
            Assistance rate {run ? run.assistanceRate.toFixed(2) : '—'} — hints plus twice any skip, per step. It is
            the only number here worth beating.
          </p>
        </div>

        {lesson.runs.length > 1 ? (
          <RunTrend runs={lesson.runs} />
        ) : (
          <div className="max-w-[220px]">
            <Eyebrow tone="muted">Assistance, run over run</Eyebrow>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-500">
              First run. This is the number to beat — run it again in Practice mode and watch it fall.
            </p>
          </div>
        )}
      </div>

      {/* per-step bars */}
      <div className="mt-8" data-testid="run-table">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <Eyebrow>Step by step</Eyebrow>
          <div className="flex items-center gap-4 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-[8px] w-[14px] rounded-[3px] bg-bar" /> time
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-[7px] w-[7px] rounded-full bg-mark" /> hint
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-[8px] w-[14px] rounded-[3px]" style={{ backgroundImage: HATCH }} /> skipped
            </span>
          </div>
        </div>

        <ol className="divide-y divide-line-2">
          {perStep.map((s) => {
            const step = lesson.steps[s.stepIndex]
            const pct = Math.max(2, (s.seconds / maxSeconds) * 100)
            return (
              <li
                key={s.stepIndex}
                className="group relative -mx-3 grid grid-cols-[26px_1fr] gap-x-3 rounded-sm px-3 py-2 transition-colors duration-150 hover:bg-sunken"
              >
                <Mono className="pt-[2px] text-[10.5px] text-ink-400">{String(s.stepIndex + 1).padStart(2, '0')}</Mono>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-3">
                    <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink-700">
                      {step?.action ?? `Step ${s.stepIndex + 1}`}
                    </span>
                    <Mono className="shrink-0 text-[11px] text-ink-500">{duration(s.seconds)}</Mono>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="relative h-[10px] flex-1">
                      <div className="absolute inset-0 overflow-hidden rounded-full bg-bar-track">
                        <div
                          className="grow-bar h-full rounded-full"
                          style={{
                            width: `${pct}%`,
                            background: s.skipped ? HATCH : 'var(--c-bar)'
                          }}
                        />
                      </div>
                      {/* hint markers ride the end of their own bar, with a surface ring so they
                          stay legible where they overlap it */}
                      {Array.from({ length: Math.min(s.hintsUsed, 3) }).map((_, i) => (
                        <span
                          key={i}
                          className="absolute top-1/2 h-[7px] w-[7px] -translate-y-1/2 rounded-full bg-mark ring-2 ring-[var(--c-surface)]"
                          style={{
                            left: `calc(min(${pct}%, 100% - ${Math.min(s.hintsUsed, 3) * 11}px) + ${4 + i * 11}px)`
                          }}
                        />
                      ))}
                    </div>
                    <div className="flex w-[42px] shrink-0 justify-end">
                      {s.skipped && (
                        <Mono className="text-[10px] uppercase tracking-[0.08em] text-ink-400">skip</Mono>
                      )}
                    </div>
                  </div>
                </div>
                {/* hover detail */}
                <div className="pointer-events-none absolute right-3 top-2 z-10 rounded-sm bg-ink-900 px-2.5 py-1.5 font-mono text-[10.5px] text-paper opacity-0 shadow-lift transition-opacity duration-150 group-hover:opacity-100">
                  {duration(s.seconds)} · {s.hintsUsed} {s.hintsUsed === 1 ? 'hint' : 'hints'}
                  {s.skipped ? ' · skipped' : s.done ? ' · done' : ''}
                </div>
              </li>
            )
          })}
        </ol>
      </div>

      {/* practice next */}
      <Card className="mt-9 overflow-hidden">
        <div className="flex">
          <Cover
            seed={lesson.coverSeed + 977}
            className="w-[8px] shrink-0"
            radius="rounded-none"
            vignette={false}
          />
          <div className="min-w-0 flex-1 p-5">
            <Eyebrow>Practice next</Eyebrow>
            {suggestion ? (
              <div data-testid="suggestion">
                <h3 className="mt-1.5 font-display text-[20px] leading-tight tracking-[-0.02em] text-ink-900">
                  {suggestion.title}
                </h3>
                <p className="mt-1.5 max-w-[62ch] text-[13.5px] leading-relaxed text-ink-500">{suggestion.ask}</p>
                <Button className="mt-4" onClick={() => onUseSuggestion(suggestion.ask)}>
                  Teach me {Icon.arrowRight({ size: 15 })}
                </Button>
              </div>
            ) : (
              <>
                <h3 className="mt-1.5 font-display text-[20px] leading-tight tracking-[-0.02em] text-ink-900">
                  What should you learn next?
                </h3>
                <p className="mt-1.5 max-w-[62ch] text-[13.5px] leading-relaxed text-ink-500">
                  Your coach still has this lesson and this run in context. It can pick the next thing worth doing.
                </p>
                <Button
                  data-testid="suggest-btn"
                  variant="outline"
                  className="mt-4"
                  disabled={suggestBusy}
                  onClick={onSuggest}
                >
                  {suggestBusy ? 'Asking your coach' : 'Ask your coach'}
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>

      <div className="mt-6 flex flex-wrap items-center gap-2.5">
        <Button data-testid="again-practice-btn" onClick={() => onRunAgain(true)}>
          Run again in Practice mode
        </Button>
        <Button data-testid="again-btn" variant="outline" onClick={() => onRunAgain(false)}>
          Run again
        </Button>
        <Button variant="quiet" data-testid="review-lesson-btn" onClick={onLesson}>
          Lesson overview
        </Button>
        <Button variant="quiet" data-testid="review-library-btn" onClick={onLibrary}>
          Back to library
        </Button>
      </div>
      </div>
    </>
  )
}
