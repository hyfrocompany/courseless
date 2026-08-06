import type { Lesson } from '../../../shared/types'
import { hintDelta, shortDate, summarise } from '../lib/format'
import { Cover } from './Cover'
import { Icon, Mono, Tag } from './ui'

/**
 * A library card. Cover art carries the identity, the mono microdata carries the facts,
 * and the hairline rail under the cover is the progress bar (filled once the lesson is done).
 */
export function LessonCard({
  lesson,
  onOpen,
  size = 'md',
  index = 0
}: {
  lesson: Lesson
  onOpen(id: string): void
  size?: 'md' | 'lg'
  index?: number
}) {
  const runs = lesson.runs.length
  const delta = hintDelta(lesson)
  const last = runs > 0 ? summarise(lesson.runs[runs - 1].perStep) : null
  const coverH = size === 'lg' ? 'h-[128px]' : 'h-[96px]'

  return (
    <button
      type="button"
      data-lesson-id={lesson.id}
      data-testid={`card-${lesson.id}`}
      onClick={() => onOpen(lesson.id)}
      className="rise group flex h-full w-full flex-col overflow-hidden rounded-md bg-surface text-left ring-hairline transition-[box-shadow,transform] duration-200 ease-out hover:-translate-y-px hover:shadow-lift"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <div className="p-2 pb-0">
        <Cover seed={lesson.coverSeed} className={`w-full ${coverH}`} radius="rounded-sm">
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2">
            <span className="max-w-[70%] truncate rounded-full bg-white/16 px-2 py-[3px] font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-white ring-1 ring-white/26 backdrop-blur-[2px]">
              {lesson.tool}
            </span>
            <span className="font-mono text-[10px] font-medium tabular text-white/85">{lesson.est_minutes} MIN</span>
          </div>
        </Cover>
      </div>

      {/* progress rail — hairline when untouched, ocean once the lesson has been run */}
      <div className="mx-2 mt-2 h-[3px] overflow-hidden rounded-full bg-line-2">
        <div
          className="h-full rounded-full bg-ocean-500 transition-[width] duration-500"
          style={{ width: runs > 0 ? '100%' : '0%' }}
        />
      </div>

      <div className="flex flex-1 flex-col px-2.5 pb-2.5 pt-2">
        <h3
          className={`${
            size === 'lg' ? 'text-[16px]' : 'text-[15px]'
          } font-semibold leading-snug tracking-[-0.01em] text-ink-900 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden`}
        >
          {lesson.title}
        </h3>

        <div className="mt-auto flex items-center gap-2 pt-2.5 text-ink-500">
          {lesson.builtin ? (
            <Tag className="bg-sunken text-ink-500">Starter</Tag>
          ) : (
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-500">
              you · {shortDate(lesson.createdAt)}
            </span>
          )}
          <Mono className="ml-auto text-[11px] text-ink-500">{lesson.steps.length} steps</Mono>
        </div>

        {delta ? (
          <div className="mt-2 flex items-center gap-1.5 border-t border-line-2 pt-2 font-mono text-[11px] text-ocean-700 dark:text-ocean-300">
            <Mono>
              {delta.from} {delta.from === 1 ? 'hint' : 'hints'}
            </Mono>
            {Icon.arrowRight({ size: 12 })}
            <Mono className="font-medium">{delta.to}</Mono>
          </div>
        ) : last ? (
          <div className="mt-2 border-t border-line-2 pt-2 font-mono text-[11px] text-ink-500">
            <Mono>
              done · {last.hints} {last.hints === 1 ? 'hint' : 'hints'}
            </Mono>
          </div>
        ) : null}
      </div>
    </button>
  )
}
