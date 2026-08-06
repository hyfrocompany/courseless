import type { Lesson } from '../../../shared/types'
import { hintDelta, summarise } from '../lib/format'
import { Cover } from './Cover'
import { Icon, Mono } from './ui'

/**
 * Where a lesson came from, in as few words as possible. A shared lesson carries its author's
 * name because that is the thing you actually want to know about a file someone sent you; a
 * starter lesson says nothing, because it is the default and the section heading already said it.
 */
export function provenance(lesson: Lesson): string | null {
  if (lesson.importedFrom) return `from ${lesson.importedFrom}`
  if (lesson.recordedByYou) return 'you recorded this'
  return null
}

/** Dense library row: thumb · title · tool · state · minutes, with quiet actions on hover. */
export function LessonRow({
  lesson,
  onOpen,
  onEdit,
  onShare
}: {
  lesson: Lesson
  onOpen(id: string): void
  onEdit?(id: string): void
  onShare?(id: string): void
}) {
  const runs = lesson.runs.length
  const delta = hintDelta(lesson)
  const last = runs > 0 ? summarise(lesson.runs[runs - 1].perStep) : null
  const from = provenance(lesson)
  const actions = (onEdit && !lesson.builtin) || onShare

  return (
    <div
      data-lesson-id={lesson.id}
      data-testid={`row-${lesson.id}`}
      className="group flex w-full items-center gap-3.5 rounded-sm px-2 py-[8px] text-left transition-colors duration-150 hover:bg-sunken"
    >
      <button
        type="button"
        data-testid={`open-${lesson.id}`}
        onClick={() => onOpen(lesson.id)}
        className="flex min-w-0 flex-1 items-center gap-3.5 text-left"
      >
        <Cover seed={lesson.coverSeed} className="h-[26px] w-[26px] shrink-0" radius="rounded-[6px]" />
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium tracking-[-0.005em] text-ink-900">
          {lesson.title}
        </span>
        <span className="hidden min-w-0 max-w-[190px] shrink truncate text-[12.5px] text-ink-500 md:block">
          {lesson.tool}
        </span>
      </button>

      {from && (
        <Mono
          data-testid={`from-${lesson.id}`}
          className="hidden max-w-[150px] shrink-0 truncate text-[10.5px] text-ocean-700 sm:block dark:text-ocean-300"
          title={lesson.audience ? `${from} · for ${lesson.audience}` : from}
        >
          {from}
        </Mono>
      )}

      {delta ? (
        <Mono className="shrink-0 text-[11px] text-ocean-700 dark:text-ocean-300">
          {delta.from}→{delta.to} hints
        </Mono>
      ) : last ? (
        <Mono className="shrink-0 text-[11px] text-ink-500">
          done · {last.hints} {last.hints === 1 ? 'hint' : 'hints'}
        </Mono>
      ) : null}

      <Mono className="w-[52px] shrink-0 text-right text-[11px] tabular text-ink-400">
        {lesson.est_minutes} min
      </Mono>

      {actions ? (
        <span className="flex shrink-0 items-center gap-0.5">
          {onEdit && !lesson.builtin && (
            <button
              type="button"
              data-testid={`edit-${lesson.id}`}
              aria-label={`Edit the steps of ${lesson.title}`}
              title="Edit steps"
              onClick={() => onEdit(lesson.id)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-ink-400 opacity-0 transition-[opacity,color,background-color] duration-150 hover:bg-surface hover:text-ink-900 focus-visible:opacity-100 group-hover:opacity-100"
            >
              {Icon.pencil({ size: 14 })}
            </button>
          )}
          {onShare && (
            <button
              type="button"
              data-testid={`share-${lesson.id}`}
              aria-label={`Share ${lesson.title}`}
              title="Share…"
              onClick={() => onShare(lesson.id)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-ink-400 opacity-0 transition-[opacity,color,background-color] duration-150 hover:bg-surface hover:text-ink-900 focus-visible:opacity-100 group-hover:opacity-100"
            >
              {Icon.share({ size: 14 })}
            </button>
          )}
        </span>
      ) : null}

      <span
        className={
          runs > 0
            ? 'shrink-0 text-ocean-600 dark:text-ocean-400'
            : 'shrink-0 text-ink-300 opacity-0 transition-opacity duration-150 group-hover:opacity-100'
        }
      >
        {runs > 0 ? Icon.check({ size: 14 }) : Icon.arrowRight({ size: 14 })}
      </span>
    </div>
  )
}
