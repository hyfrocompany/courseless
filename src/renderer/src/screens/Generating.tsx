import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { EngineErrorKind, Lesson } from '../../../shared/types'
import { Button, Eyebrow, Icon, Mono } from '../components/ui'

/** Pull whatever is already parseable out of the raw stream, so steps materialise as they arrive. */
function scan(raw: string): { title: string | null; tool: string | null; actions: string[] } {
  const unescape = (s: string): string => s.replace(/\\"/g, '"').replace(/\\n/g, ' ').replace(/\\\\/g, '\\')
  const grab = (key: string): string | null => {
    const m = raw.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`))
    return m ? unescape(m[1]) : null
  }
  const actions: string[] = []
  const re = /"action"\s*:\s*"((?:[^"\\]|\\.)*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) actions.push(unescape(m[1]))
  return { title: grab('title'), tool: grab('tool'), actions }
}

export function Generating({
  ask,
  raw,
  status,
  error,
  errorKind,
  lesson,
  onCancel,
  onOpen,
  onRetry,
  onHome,
  limitCard
}: {
  ask: string
  raw: string
  status: string
  error: string
  errorKind: EngineErrorKind | null
  lesson: Lesson | null
  onCancel(): void
  onOpen(): void
  onRetry(): void
  onHome(): void
  /** What a used-up allowance looks like. Supplied by the window that knows about plans. */
  limitCard: ReactNode
}) {
  const parsed = useMemo(() => scan(raw), [raw])
  const actions = lesson ? lesson.steps.map((s) => s.action) : parsed.actions
  const title = lesson?.title ?? parsed.title
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: 'nearest' })
  }, [actions.length])

  const ticker = raw.replace(/\s+/g, ' ').slice(-160)

  return (
    <div
      data-testid="view-generating"
      className="mx-auto flex min-h-full w-full max-w-[820px] flex-col px-8 pb-10 pt-10"
    >
      {/* A used-up allowance is not a failure of the lesson: it says so plainly, in the quiet
          frame, and offers the one thing that changes it. */}
      {error && errorKind === 'LIMIT' ? (
        <div className="rise" data-testid="gen-limit">
          {limitCard}
        </div>
      ) : error ? (
        <div className="rise rounded-lg bg-surface p-8 ring-1 ring-[var(--c-danger-line)]" data-testid="gen-error">
          <Eyebrow tone="muted">Generation stopped</Eyebrow>
          <h1 className="mt-2.5 font-display text-[26px] leading-tight tracking-[-0.025em]">
            The coach could not finish this one.
          </h1>
          <p className="mt-2.5 max-w-[62ch] text-[13.5px] text-ink-700">{error}</p>
          <div className="mt-6 flex items-center gap-3">
            <Button onClick={onRetry}>Try again</Button>
            <Button variant="quiet" onClick={onHome}>
              Back to library
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            {lesson ? (
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-ocean-600 text-white">
                {Icon.check({ size: 12 })}
              </span>
            ) : (
              <span className="pulse-dot h-[10px] w-[10px] rounded-full bg-ocean-500" />
            )}
            <Eyebrow>{lesson ? 'Ready' : 'Generating'}</Eyebrow>
          </div>

          <h1 className="mt-3 font-display text-[clamp(24px,2.8vw,32px)] leading-[1.12] tracking-[-0.03em]">
            {lesson ? 'Your path is ready.' : 'Your coach is building the path'}
          </h1>
          <p className="mt-2.5 max-w-[66ch] text-[14px] text-ink-500">
            {lesson ? (
              <>
                <span className="text-ink-900">{title}</span> — {lesson.steps.length} steps,{' '}
                {lesson.est_minutes} minutes, in {lesson.tool}.
              </>
            ) : (
              <>&ldquo;{ask}&rdquo;</>
            )}
          </p>

          <div
            className="mt-6 rounded-lg bg-surface p-5 ring-hairline"
            data-testid={lesson ? 'lesson-parsed' : 'gen-progress'}
          >
            <div className="flex items-baseline justify-between gap-4">
              <Eyebrow tone="muted">{title ? title : 'reading the plan'}</Eyebrow>
              <Mono className="text-[11px] text-ink-400">
                {actions.length > 0 ? `${String(actions.length).padStart(2, '0')} steps` : 'parsing'}
              </Mono>
            </div>

            {actions.length === 0 ? (
              <div className="mt-5 space-y-4" aria-hidden="true">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="relative h-[13px] overflow-hidden rounded-full bg-sunken sweep"
                    style={{ width: `${86 - (i % 3) * 18}%`, opacity: 1 - i * 0.13 }}
                  />
                ))}
              </div>
            ) : (
              <ol
                ref={listRef}
                className="mt-4 max-h-[38vh] space-y-2.5 overflow-y-auto pr-2"
                data-testid="parsed-steps"
              >
                {actions.map((a, i) => (
                  <li key={i} className="rise flex gap-3.5" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                    <Mono className="mt-[3px] w-6 shrink-0 text-[11px] text-ocean-600 dark:text-ocean-400">
                      {String(i + 1).padStart(2, '0')}
                    </Mono>
                    <span className="text-[13.5px] leading-[1.5] text-ink-700">{a}</span>
                  </li>
                ))}
                {!lesson &&
                  [0, 1].map((i) => (
                    <li key={`sk${i}`} className="flex gap-3.5" aria-hidden="true">
                      <span className="mt-[3px] w-6 shrink-0" />
                      <span
                        className="sweep relative h-[13px] overflow-hidden rounded-full bg-sunken"
                        style={{ width: `${72 - i * 22}%`, opacity: 0.8 - i * 0.3 }}
                      />
                    </li>
                  ))}
              </ol>
            )}
          </div>

          {/* raw token ticker — proof of life while generating; gone once the plan is parsed */}
          {!lesson && (
            <div className="mt-4 h-4 overflow-hidden">
              <div
                data-testid="gen-raw"
                dir="rtl"
                className="truncate text-left font-mono text-[11px] leading-4 text-ink-400"
              >
                <span dir="ltr">{ticker || '…'}</span>
              </div>
            </div>
          )}

          <div className="mt-6 flex items-center gap-4">
            {lesson ? (
              <Button data-testid="open-generated" onClick={onOpen}>
                Open lesson {Icon.arrowRight({ size: 15 })}
              </Button>
            ) : (
              <Button data-testid="cancel-btn" variant="quiet" onClick={onCancel}>
                Cancel
              </Button>
            )}
            <span className="font-mono text-[11px] text-ink-400" data-testid="gen-status">
              {status}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
