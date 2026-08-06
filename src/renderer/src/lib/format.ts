import type { Lesson, LessonRun, RunStepStat } from '../../../shared/types'

/** 754 -> "12m 34s", 42 -> "42s" */
export function duration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rest = s % 60
  return `${m}m ${String(rest).padStart(2, '0')}s`
}

/** Clock face for the runner: always mm:ss. */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

export function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export interface RunSummary {
  hints: number
  skips: number
  seconds: number
  steps: number
  done: number
}

export function summarise(perStep: RunStepStat[]): RunSummary {
  return perStep.reduce<RunSummary>(
    (acc, s) => ({
      hints: acc.hints + s.hintsUsed,
      skips: acc.skips + (s.skipped ? 1 : 0),
      seconds: acc.seconds + s.seconds,
      steps: acc.steps + 1,
      done: acc.done + (s.done ? 1 : 0)
    }),
    { hints: 0, skips: 0, seconds: 0, steps: 0, done: 0 }
  )
}

export function lastRun(lesson: Lesson | null): LessonRun | null {
  if (!lesson || lesson.runs.length === 0) return null
  return lesson.runs[lesson.runs.length - 1]
}

/** "4 hints → 1" style delta between the two most recent runs. */
export function hintDelta(lesson: Lesson): { from: number; to: number } | null {
  if (lesson.runs.length < 2) return null
  const a = summarise(lesson.runs[lesson.runs.length - 2].perStep).hints
  const b = summarise(lesson.runs[lesson.runs.length - 1].perStep).hints
  return { from: a, to: b }
}

export function fadeProfile(lesson: Lesson): { guided: number; prompted: number; solo: number } {
  return lesson.steps.reduce(
    (acc, s) => {
      if (s.fade_tier === 1) acc.guided += 1
      else if (s.fade_tier === 2) acc.prompted += 1
      else acc.solo += 1
      return acc
    },
    { guided: 0, prompted: 0, solo: 0 }
  )
}
