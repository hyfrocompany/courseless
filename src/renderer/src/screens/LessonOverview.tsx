import { useState } from 'react'
import type { Lesson } from '../../../shared/types'
import { Breadcrumb, BreadcrumbBar } from '../components/Breadcrumb'
import { Cover } from '../components/Cover'
import { FadeDot, FadeLegend, TIER_LABEL } from '../components/FadeDots'
import { provenance } from '../components/LessonRow'
import { Button, Eyebrow, Icon, Mono } from '../components/ui'
import { fadeProfile, summarise } from '../lib/format'

export function LessonOverview({
  lesson,
  shareNote,
  startPinned,
  onStart,
  onDelete,
  onBack,
  onEdit,
  onDuplicate,
  onShare
}: {
  lesson: Lesson
  /** Where the file went, after a share. Shown once, in place, then forgotten. */
  shareNote: string
  /** The default way lessons run on this machine. Off swaps which CTA is the primary one. */
  startPinned: boolean
  onStart(practice: boolean, pinned: boolean): void
  onDelete(): void
  onBack(): void
  onEdit(): void
  onDuplicate(): void
  onShare(): void
}) {
  const [confirming, setConfirming] = useState(false)
  const fade = fadeProfile(lesson)
  const runs = lesson.runs.length
  const last = runs > 0 ? summarise(lesson.runs[runs - 1].perStep) : null
  const from = provenance(lesson)

  return (
    <>
      <BreadcrumbBar>
        <Breadcrumb current={lesson.title} onRoot={onBack} />
      </BreadcrumbBar>

      <div data-testid="view-lesson" className="mx-auto w-full max-w-[860px] px-8 pb-16 pt-6">
        <Cover seed={lesson.coverSeed} className="h-[140px] w-full" radius="rounded-xl">
        <div className="absolute inset-0 flex flex-col justify-end p-6">
          <span className="mb-2 w-fit rounded-full bg-white/16 px-2.5 py-[3px] font-mono text-[9.5px] font-medium uppercase tracking-[0.12em] text-white ring-1 ring-white/26 backdrop-blur-[2px]">
            {lesson.tool}
          </span>
          <h1
            data-testid="lesson-title"
            className="max-w-[26ch] font-display text-[clamp(22px,2.6vw,30px)] font-normal leading-[1.1] tracking-[-0.025em] text-white"
          >
            {lesson.title}
          </h1>
        </div>
      </Cover>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-500">
        <Mono>{lesson.est_minutes} min</Mono>
        <span className="text-ink-300">·</span>
        <Mono>{lesson.steps.length} steps</Mono>
        <span className="text-ink-300">·</span>
        <Mono>
          {fade.guided} guided / {fade.prompted} prompted / {fade.solo} solo
        </Mono>
        {runs > 0 && (
          <>
            <span className="text-ink-300">·</span>
            <Mono className="text-ocean-700 dark:text-ocean-300">
              run {runs}× · last {last?.hints ?? 0} {last?.hints === 1 ? 'hint' : 'hints'}
            </Mono>
          </>
        )}
      </div>

      {/* Provenance, in one line: who made it and who they made it for. */}
      {(from || lesson.audience) && (
        <p data-testid="lesson-provenance" className="mt-3 text-[13px] text-ink-500">
          {from && <span className="text-ocean-700 dark:text-ocean-300">{from}</span>}
          {from && lesson.audience && <span className="mx-1.5 text-ink-300">·</span>}
          {lesson.audience && <span>for {lesson.audience}</span>}
        </p>
      )}

      <p className="mt-5 max-w-[68ch] text-[15px] leading-[1.55] text-ink-700">{lesson.goal}</p>

      {lesson.prerequisites.length > 0 && (
        <div className="mt-5">
          <Eyebrow tone="muted">Before you start</Eyebrow>
          <ul className="mt-2 space-y-1">
            {lesson.prerequisites.map((p, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[13.5px] text-ink-700">
                <span className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-ocean-400" />
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* CTA row. Pinned is the default way a lesson runs, so it is the primary button and it
          carries the pin; the window is one quiet click away, never more. */}
      <div className="mt-7 flex flex-wrap items-center gap-3">
        {startPinned ? (
          <>
            <Button data-testid="start-pinned-btn" onClick={() => onStart(false, true)}>
              {Icon.pin({ size: 15 })} Start pinned
            </Button>
            <Button data-testid="start-btn" variant="quiet" onClick={() => onStart(false, false)}>
              Start in window
            </Button>
          </>
        ) : (
          <>
            <Button data-testid="start-btn" onClick={() => onStart(false, false)}>
              Start in window {Icon.arrowRight({ size: 15 })}
            </Button>
            <Button data-testid="start-pinned-btn" variant="quiet" onClick={() => onStart(false, true)}>
              {Icon.pin({ size: 14 })} Start pinned
            </Button>
          </>
        )}
        <Button
          data-testid="practice-btn"
          variant="outline"
          title="hints locked — prove it"
          onClick={() => onStart(true, startPinned)}
        >
          Practice mode
        </Button>

        {/* A starter lesson is a fixed thing everyone gets the same copy of. Editing it in place
            would quietly fork the library; taking a copy first says what is happening. */}
        {lesson.builtin ? (
          <Button variant="ghost" size="md" data-testid="duplicate-btn" onClick={onDuplicate}>
            {Icon.copy({ size: 14 })} Duplicate to edit
          </Button>
        ) : (
          <Button variant="ghost" size="md" data-testid="edit-btn" onClick={onEdit}>
            {Icon.pencil({ size: 14 })} Edit steps
          </Button>
        )}
        <Button variant="ghost" size="md" data-testid="share-btn" onClick={onShare}>
          {Icon.share({ size: 14 })} Share…
        </Button>

        {confirming ? (
          <span className="ml-auto inline-flex items-center gap-3 text-[12.5px]">
            <span className="text-ink-500">Delete this lesson and its run history?</span>
            <button
              type="button"
              data-testid="delete-confirm"
              onClick={onDelete}
              className="font-medium text-danger underline underline-offset-4"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-ink-400 transition-colors duration-150 hover:text-ink-900"
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            data-testid="delete-btn"
            onClick={() => setConfirming(true)}
            className="ml-auto inline-flex items-center gap-1.5 text-[12.5px] text-ink-400 transition-colors duration-150 hover:text-danger"
          >
            {Icon.trash({ size: 14 })} Delete
          </button>
        )}
      </div>

      {/* One line, under the buttons, saying what the default actually does to the screen. */}
      <p data-testid="start-note" className="mt-3 text-[12.5px] leading-[1.5] text-ink-500">
        {startPinned
          ? 'Pinned, the coach floats over your work and this window steps aside. Esc brings it back.'
          : 'In the window, the lesson runs here. Pin it to the screen any time from the runner.'}
      </p>

      {shareNote && (
        <p data-testid="share-note" className="fade mt-3 break-all text-[12.5px] text-ink-500">
          {shareNote}
        </p>
      )}

      {/* steps preview */}
      <div className="mt-9">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-2.5">
          <Eyebrow>The path</Eyebrow>
          <FadeLegend />
        </div>
        <ol className="divide-y divide-line-2" data-testid="steps-preview">
          {lesson.steps.map((s, i) => (
            <li key={i} className="flex gap-3.5 py-3">
              <Mono className="mt-[2px] w-6 shrink-0 text-[10.5px] text-ink-400">{String(i + 1).padStart(2, '0')}</Mono>
              <FadeDot
                tier={s.fade_tier}
                size={11}
                className="mt-[5px] shrink-0 text-ocean-600 dark:text-ocean-400"
              />
              <div className="min-w-0">
                <div className="text-[14px] font-medium leading-snug text-ink-900">{s.action}</div>
                <div className="mt-0.5 text-[13px] leading-[1.5] text-ink-500">{s.where}</div>
              </div>
              <Mono className="ml-auto hidden shrink-0 self-start pt-0.5 text-[9.5px] uppercase tracking-[0.1em] text-ink-400 sm:block">
                {TIER_LABEL[s.fade_tier]}
              </Mono>
            </li>
          ))}
        </ol>
      </div>
      </div>
    </>
  )
}
