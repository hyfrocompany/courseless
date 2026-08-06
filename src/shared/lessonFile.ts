// The shareable lesson file: `<slug>.courseless.json`.
//
// A lesson is already a plain JSON file on disk, but the file you SEND someone is not the same
// object as the file you keep: your run history, your engine thread and the starter-library flags
// are yours, not theirs. This module owns both halves of that boundary — what leaves, and what is
// allowed back in.
//
// Dependency-free (no electron, no node): main validates with it, and the renderer names the same
// fields in its error copy.

import type { Lesson, LessonStep } from './types'

export const LESSON_FILE_FORMAT = 'courseless-lesson'
export const LESSON_FILE_VERSION = 1
export const LESSON_FILE_EXT = '.courseless.json'

export interface LessonFile {
  format: typeof LESSON_FILE_FORMAT
  formatVersion: number
  exportedAt: string
  /** Free text: whoever made it. Never an account, never an id — there are no accounts. */
  authoredBy: string
  lesson: Lesson
}

export const ANON_AUTHOR = 'a Courseless user'

/** "Make a new folder and rename it" -> "make-a-new-folder-and-rename-it" */
export function slugify(title: string): string {
  const s = (title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return s || 'lesson'
}

/**
 * What leaves this machine. Everything personal is dropped by CONSTRUCTION (an allow-list of
 * fields), not by deleting keys off a copy — a future field added to Lesson must be opted in
 * deliberately rather than leak the first time someone shares.
 */
export function buildLessonFile(lesson: Lesson, authoredBy: string): LessonFile {
  const shared: Lesson = {
    id: lesson.id,
    title: lesson.title,
    tool: lesson.tool,
    goal: lesson.goal,
    est_minutes: lesson.est_minutes,
    prerequisites: [...(lesson.prerequisites ?? [])],
    steps: (lesson.steps ?? []).map((s) => ({
      action: s.action,
      where: s.where,
      why: s.why,
      checkpoint: s.checkpoint,
      hint_levels: [...s.hint_levels],
      fade_tier: s.fade_tier,
      ...(s.target ? { target: s.target } : {})
    })),
    coverSeed: lesson.coverSeed,
    // Deliberately blank: a thread id is a handle on the author's own engine session. It means
    // nothing on another machine, and the coach already falls back to re-sending the lesson.
    codexThreadId: null,
    createdAt: lesson.createdAt,
    // Deliberately empty: run history is the author's practice, not part of the lesson.
    runs: [],
    version: lesson.version ?? 1,
    ...(lesson.audience ? { audience: lesson.audience } : {}),
    ...(lesson.recordedByYou ? { recordedByYou: true } : {})
    // builtin / featured / track / importedFrom are NOT carried: they describe where a lesson
    // sits in THIS library, and the recipient's library is not this one.
  }
  return {
    format: LESSON_FILE_FORMAT,
    formatVersion: LESSON_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    authoredBy: authoredBy.trim() || ANON_AUTHOR,
    lesson: shared
  }
}

export function exportFileName(lesson: Lesson): string {
  return `${slugify(lesson.title)}${LESSON_FILE_EXT}`
}

// ---------------------------------------------------------------- validation

export type Validation = { ok: true; file: LessonFile } | { ok: false; error: string }

function typeName(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'an array'
  return `a ${typeof v}`
}

function fail(error: string): Validation {
  return { ok: false, error }
}

/**
 * Parse + check a candidate file. Every failure names the field that failed and what it should
 * have been, because "invalid file" tells the person holding a broken file nothing they can act
 * on. Never throws: this runs on whatever a stranger dropped on the window.
 */
export function validateLessonFile(text: string): Validation {
  if (typeof text !== 'string' || text.trim() === '') return fail('That file is empty.')

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e)
    // "Unexpected end of JSON input" / "Unexpected token } in JSON at position 812"
    const pos = msg.match(/position (\d+)/)
    return fail(
      pos
        ? `That file is not complete JSON — it breaks at character ${pos[1]}. It may have been cut short while copying.`
        : `That file is not JSON: ${msg.slice(0, 120)}`
    )
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return fail(`The file's top level is ${typeName(raw)}, not a lesson object.`)

  const o = raw as Record<string, unknown>

  if (o.format === undefined)
    return fail('"format" is missing. A Courseless lesson file starts with "format": "courseless-lesson".')
  if (o.format !== LESSON_FILE_FORMAT)
    return fail(`"format" is ${JSON.stringify(o.format)}, but this app can only read ${JSON.stringify(LESSON_FILE_FORMAT)} files.`)

  const fv = Number(o.formatVersion)
  if (!Number.isFinite(fv)) return fail('"formatVersion" is missing or is not a number.')
  if (fv > LESSON_FILE_VERSION)
    return fail(
      `"formatVersion" is ${fv}; this copy of Courseless reads version ${LESSON_FILE_VERSION}. Update Courseless to open it.`
    )

  if (o.lesson === undefined) return fail('"lesson" is missing — the file has a header but no lesson in it.')
  if (!o.lesson || typeof o.lesson !== 'object' || Array.isArray(o.lesson))
    return fail(`"lesson" is ${typeName(o.lesson)}, not an object.`)

  const l = o.lesson as Record<string, unknown>

  if (typeof l.title !== 'string' || !l.title.trim())
    return fail('"lesson.title" is missing — every lesson needs a title.')
  if (l.steps === undefined) return fail('"lesson.steps" is missing — a lesson is its steps.')
  if (!Array.isArray(l.steps)) return fail(`"lesson.steps" is ${typeName(l.steps)}, not an array.`)
  if (l.steps.length === 0) return fail('"lesson.steps" is empty — there is nothing to run.')

  const steps: LessonStep[] = []
  for (let i = 0; i < l.steps.length; i++) {
    const s = l.steps[i] as Record<string, unknown>
    const at = `"lesson.steps[${i}]`
    if (!s || typeof s !== 'object' || Array.isArray(s)) return fail(`${at}" is ${typeName(s)}, not an object.`)
    if (typeof s.action !== 'string' || !s.action.trim())
      return fail(`${at}.action" is missing — a step has to say what to do.`)
    if (s.hint_levels !== undefined && !Array.isArray(s.hint_levels))
      return fail(`${at}.hint_levels" is ${typeName(s.hint_levels)}, not an array of 3 strings.`)
    const hints = Array.isArray(s.hint_levels)
      ? s.hint_levels.map((h) => (typeof h === 'string' ? h : String(h ?? ''))).filter((h) => h.trim())
      : []
    while (hints.length < 3) hints.push(hints[hints.length - 1] ?? `Look at: ${String(s.where ?? 'the screen')}`)
    const tierRaw = Number(s.fade_tier)
    const tier = tierRaw === 1 || tierRaw === 2 || tierRaw === 3 ? tierRaw : 2
    const target = typeof s.target === 'string' ? s.target.trim() : ''
    steps.push({
      action: String(s.action).trim(),
      where: typeof s.where === 'string' ? s.where : '',
      why: typeof s.why === 'string' ? s.why : '',
      checkpoint: typeof s.checkpoint === 'string' ? s.checkpoint : '',
      hint_levels: hints.slice(0, 3),
      fade_tier: tier,
      ...(target ? { target } : {})
    })
  }

  const est = Number(l.est_minutes)
  const seed = Number(l.coverSeed)
  const version = Number(l.version)

  const lesson: Lesson = {
    id: typeof l.id === 'string' && l.id ? l.id : 'imported',
    title: l.title.trim(),
    tool: typeof l.tool === 'string' ? l.tool : '',
    goal: typeof l.goal === 'string' ? l.goal : '',
    est_minutes: Number.isFinite(est) && est > 0 ? Math.round(est) : Math.max(3, steps.length * 3),
    prerequisites: Array.isArray(l.prerequisites)
      ? l.prerequisites.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).slice(0, 6)
      : [],
    steps,
    coverSeed: Number.isFinite(seed) ? Math.abs(Math.round(seed)) : Math.floor(Math.random() * 1_000_000),
    codexThreadId: null,
    createdAt: typeof l.createdAt === 'string' ? l.createdAt : new Date().toISOString(),
    runs: [],
    version: Number.isFinite(version) && version > 0 ? Math.round(version) : 1,
    ...(typeof l.audience === 'string' && l.audience ? { audience: l.audience } : {}),
    ...(l.recordedByYou === true ? { recordedByYou: true } : {})
  }

  return {
    ok: true,
    file: {
      format: LESSON_FILE_FORMAT,
      formatVersion: fv,
      exportedAt: typeof o.exportedAt === 'string' ? o.exportedAt : '',
      authoredBy: typeof o.authoredBy === 'string' && o.authoredBy.trim() ? o.authoredBy.trim() : ANON_AUTHOR,
      lesson
    }
  }
}
