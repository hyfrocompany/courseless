// Strict-JSON extraction + normalization for lesson replies.
//
// The prompts themselves live server-side now — one place, one wording, updatable without
// shipping a new build. What stays here is the part that must not: the client is the last thing
// between a model reply and a lesson file on disk, so it still parses, repairs and validates
// every draft before anything is saved.

import type { FadeTier, LessonStep } from '../../../shared/types'

/** Extract the first balanced {...} block, tolerating fences and surrounding prose. */
export function extractFirstJsonObject(raw: string): string | null {
  if (!raw) return null
  let text = raw.trim()
  // strip a leading ```json fence if the model ignored instructions
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence && fence[1].includes('{')) text = fence[1].trim()

  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

export interface ParsedLesson {
  ok: boolean
  problems: string[]
  draft: {
    title: string
    tool: string
    goal: string
    est_minutes: number
    prerequisites: string[]
    steps: LessonStep[]
  } | null
}

const MIN_STEPS = 6

function asString(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return fallback
}

function defaultTier(index: number, total: number): FadeTier {
  const p = total <= 1 ? 0 : index / (total - 1)
  if (p < 0.34) return 1
  if (p < 0.72) return 2
  return 3
}

/** Parse + normalize + validate. Soft problems are repaired locally; hard ones set ok:false. */
export function parseLessonJson(raw: string): ParsedLesson {
  const problems: string[] = []
  const block = extractFirstJsonObject(raw)
  if (!block) return { ok: false, problems: ['No JSON object found in the reply.'], draft: null }

  let obj: any
  try {
    obj = JSON.parse(block)
  } catch (e) {
    return { ok: false, problems: [`JSON.parse failed: ${String(e).slice(0, 200)}`], draft: null }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj))
    return { ok: false, problems: ['Top level value is not a JSON object.'], draft: null }

  const title = asString(obj.title)
  if (!title) problems.push('Missing "title".')

  const rawSteps = Array.isArray(obj.steps) ? obj.steps : []
  if (!Array.isArray(obj.steps)) problems.push('Missing "steps" array.')
  else if (rawSteps.length < MIN_STEPS)
    problems.push(`Only ${rawSteps.length} steps — the lesson needs between 6 and 12 steps.`)

  const steps: LessonStep[] = []
  rawSteps.forEach((s: any, i: number) => {
    if (!s || typeof s !== 'object') {
      problems.push(`Step ${i + 1} is not an object.`)
      return
    }
    const action = asString(s.action)
    if (!action) {
      problems.push(`Step ${i + 1} has no "action".`)
      return
    }
    const where = asString(s.where)
    const why = asString(s.why)
    const checkpoint = asString(s.checkpoint)
    let hints: string[] = Array.isArray(s.hint_levels)
      ? s.hint_levels.map((h: unknown) => asString(h)).filter((h: string) => h.length > 0)
      : []
    if (hints.length === 0) hints = [where ? `Look at: ${where}` : 'Look carefully at the screen.']
    while (hints.length < 3) hints.push(hints[hints.length - 1])
    hints = hints.slice(0, 3)

    let tier = Number(s.fade_tier)
    if (!Number.isFinite(tier) || tier < 1 || tier > 3) tier = defaultTier(i, rawSteps.length)
    // `target` is optional by design: pre-B4 lessons have none and pointing mines `where` instead.
    // A too-long "target" is a paraphrase, not a label — drop it rather than point at a guess.
    const target = asString(s.target)
    steps.push({
      action,
      where,
      why,
      checkpoint,
      hint_levels: hints,
      fade_tier: Math.round(tier) as FadeTier,
      ...(target && target.length <= 48 ? { target } : {})
    })
  })

  if (steps.length < MIN_STEPS && !problems.some((p) => p.includes('steps'))) {
    problems.push(`Only ${steps.length} usable steps — need at least ${MIN_STEPS}.`)
  }

  let est = Number(obj.est_minutes)
  if (!Number.isFinite(est) || est <= 0) est = Math.max(3, steps.length * 3)
  est = Math.min(600, Math.round(est))

  const prerequisites = Array.isArray(obj.prerequisites)
    ? obj.prerequisites.map((p: unknown) => asString(p)).filter((p: string) => p.length > 0).slice(0, 6)
    : []

  const draft = {
    title: title || 'Untitled lesson',
    tool: asString(obj.tool),
    goal: asString(obj.goal),
    est_minutes: est,
    prerequisites,
    steps
  }

  const hard = problems.filter(
    (p) => p.includes('steps') || p.includes('"action"') || p.includes('Missing "title"')
  )
  return { ok: hard.length === 0, problems, draft }
}
