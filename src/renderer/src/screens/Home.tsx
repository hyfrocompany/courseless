import { useMemo, useRef } from 'react'
import type { Lesson, SkillLevel } from '../../../shared/types'
import { LEVELS, QUICK_STARTS } from '../lib/catalogue'
import { LessonCard } from '../components/LessonCard'
import { LessonRow } from '../components/LessonRow'
import { Button, Eyebrow, Icon } from '../components/ui'

/** Most recently touched first: last run if there is one, otherwise when it was created. */
function touchedAt(l: Lesson): number {
  const last = l.runs[l.runs.length - 1]
  return new Date(last?.finishedAt ?? l.createdAt).getTime()
}

export function Home({
  lessons,
  ask,
  setAsk,
  level,
  setLevel,
  onGenerate,
  onOpenLesson,
  onSeeAll,
  onRecord
}: {
  lessons: Lesson[]
  ask: string
  setAsk(v: string): void
  level: SkillLevel
  setLevel(v: SkillLevel): void
  onGenerate(): void
  onOpenLesson(id: string): void
  onSeeAll(): void
  onRecord(): void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  const featured = useMemo(() => lessons.filter((l) => l.builtin && l.featured), [lessons])
  // "Continue" is the pile you already touched: anything you made, plus anything you have run.
  const continuing = useMemo(
    () =>
      lessons
        .filter((l) => !l.builtin || l.runs.length > 0)
        .sort((a, b) => touchedAt(b) - touchedAt(a))
        .slice(0, 5),
    [lessons]
  )
  const continueTotal = useMemo(() => lessons.filter((l) => !l.builtin || l.runs.length > 0).length, [lessons])

  return (
    <div data-testid="view-home" className="mx-auto w-full max-w-[1120px] px-8 pb-16">
      {/* ------------------------------------------------------------ hero */}
      <section className="pb-8 pt-10">
        <h1 className="rise max-w-[18ch] font-display text-[clamp(26px,3vw,36px)] font-normal leading-[1.08] tracking-[-0.03em] text-ink-900">
          What do you want to be able to do?
        </h1>

        <div className="rise mt-5 max-w-[680px]" style={{ animationDelay: '80ms' }}>
          <div className="relative">
            <input
              ref={inputRef}
              data-testid="ask-input"
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onGenerate()
              }}
              spellCheck={false}
              aria-label="What do you want to be able to do?"
              placeholder="close the month in NetSuite…"
              className="h-12 w-full rounded-md bg-surface pl-4 pr-[126px] text-[15px] text-ink-900 ring-hairline transition-shadow duration-200 placeholder:text-ink-400 focus:outline-none focus:shadow-[inset_0_0_0_1px_var(--c-focus),0_0_0_4px_color-mix(in_oklab,var(--c-focus)_16%,transparent)]"
            />
            <Button
              data-testid="generate-btn"
              onClick={() => (ask.trim() ? onGenerate() : inputRef.current?.focus())}
              className="absolute right-1.5 top-1.5 h-9"
            >
              Teach me {Icon.arrowRight({ size: 15 })}
            </Button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div
              data-testid="level-select"
              role="radiogroup"
              aria-label="How much have you done this before?"
              className="inline-flex rounded-full bg-sunken p-[3px]"
            >
              {LEVELS.map((l) => (
                <button
                  key={l.value}
                  type="button"
                  role="radio"
                  aria-checked={level === l.value}
                  data-testid={`level-${l.value}`}
                  onClick={() => setLevel(l.value)}
                  className={`rounded-full px-3 py-[5px] text-[12px] font-medium transition-colors duration-150 ${
                    level === l.value
                      ? 'bg-surface text-ink-900 ring-hairline'
                      : 'text-ink-500 hover:text-ink-900'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <span className="font-mono text-[10.5px] text-ink-400">your pace · your screen · your coach</span>
          </div>
        </div>

        {/* The other way in. Asking is the front door; recording is for the person who already
            knows how — so it sits quietly beside the quick starts, not in competition with them. */}
        <div className="rise mt-4 flex flex-wrap items-center gap-2" style={{ animationDelay: '120ms' }}>
          <button
            type="button"
            data-testid="home-record"
            onClick={onRecord}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-[5px] text-[12.5px] text-ink-700 ring-hairline transition-colors duration-150 hover:bg-chip hover:text-chip-ink"
          >
            {Icon.record({ size: 13 })} Record your own
          </button>
          <span className="h-4 w-px bg-line" aria-hidden="true" />
          {QUICK_STARTS.map((q) => (
            <button
              key={q.label}
              type="button"
              data-testid={`quick-${q.label.slice(0, 12).replace(/\W+/g, '-').toLowerCase()}`}
              onClick={() => {
                setAsk(q.ask)
                setLevel(q.level)
                inputRef.current?.focus()
              }}
              className="rounded-full bg-surface px-3 py-[5px] text-[12.5px] text-ink-700 ring-hairline transition-colors duration-150 hover:bg-chip hover:text-chip-ink"
            >
              {q.label}
            </button>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ continue */}
      <section className="border-t border-line pt-8" data-testid="continue-section">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <Eyebrow>Continue</Eyebrow>
          {continueTotal > 0 && (
            <button
              type="button"
              data-testid="see-all"
              onClick={onSeeAll}
              className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-500 transition-colors duration-150 hover:text-ink-900"
            >
              See all {Icon.arrowRight({ size: 13 })}
            </button>
          )}
        </div>

        {continuing.length === 0 ? (
          <div className="rounded-md bg-surface px-6 py-7 ring-hairline">
            <p className="max-w-[46ch] font-display text-[21px] italic leading-[1.35] tracking-[-0.02em] text-ink-900">
              When an agent does it for you, the skill stays the machine&apos;s. Keep it yours.
            </p>
            <p className="mt-2.5 max-w-[58ch] text-[13.5px] text-ink-500">
              Ask for anything above and your coach builds the path in about a minute — or record yourself doing
              something once and send the file on. Until then, the starter library is already yours to run —{' '}
              <button
                type="button"
                data-testid="empty-open-library"
                onClick={onSeeAll}
                className="text-link underline underline-offset-2"
              >
                open the Library
              </button>
              .
            </p>
          </div>
        ) : (
          <div className="divide-y divide-line-2" data-testid="continue-list">
            {continuing.map((l) => (
              <LessonRow key={l.id} lesson={l} onOpen={onOpenLesson} />
            ))}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ featured */}
      {featured.length > 0 && (
        <section className="mt-10" data-testid="featured-section">
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <Eyebrow>Featured</Eyebrow>
              <h2 className="mt-1 font-display text-[21px] leading-tight tracking-[-0.02em]">
                Start with one of these
              </h2>
            </div>
            <span className="hidden font-mono text-[10.5px] text-ink-400 sm:block">
              picked from the starter library
            </span>
          </div>
          {/* wraps instead of scrolling — every card is always fully on screen */}
          <div
            data-testid="featured-grid"
            className="grid gap-3.5"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(238px, 1fr))' }}
          >
            {featured.map((l, i) => (
              <LessonCard key={l.id} lesson={l} onOpen={onOpenLesson} size="lg" index={i} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
