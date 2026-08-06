// Prompt engineering + strict-JSON extraction/validation for lesson generation.

import type { FadeTier, Lesson, LessonStep, RecordMark, SkillLevel, StepContext } from '../../../shared/types'

const LEVEL_TEXT: Record<SkillLevel, string> = {
  never: 'The learner has NEVER done this before. Assume zero familiarity with the tool: name every menu, panel and button explicitly, and keep early steps very small.',
  few: 'The learner has done this a few times. Skip absolute basics like "open the app", but keep locations precise.',
  rusty: 'The learner used to know this and is rusty. Be brisk, jog the memory, lean on higher fade tiers earlier.'
}

const SCHEMA = `{
  "title": string,               // <= 60 chars, names the real outcome, not "Tutorial"
  "tool": string,                // the app the learner will actually use, e.g. "Microsoft Excel"
  "goal": string,                // 1 sentence: what they will have DONE when finished
  "est_minutes": number,         // integer, realistic for a first attempt
  "prerequisites": string[],     // 0-4 short items they need before starting ([] if none)
  "steps": [                     // 6-12 items, in the order they are performed
    {
      "action": string,          // imperative, ONE sentence, one concrete thing to do
      "where": string,           // precise UI location in words (ribbon/tab/panel/menu names)
      "target": string,          // 2-5 words: the on-screen element, spelled EXACTLY as the app labels it
      "why": string,             // ONE line: why this step matters
      "checkpoint": string,      // observable proof it worked ("You should see ...")
      "hint_levels": [string, string, string], // nudge -> detail -> exact click path
      "fade_tier": 1 | 2 | 3     // 1 guided, 2 prompted, 3 solo
    }
  ]
}`

const EXAMPLE = `{"title":"Rename a branch in GitHub Desktop","tool":"GitHub Desktop","goal":"You will rename your current branch and push it so the remote matches.","est_minutes":6,"prerequisites":["A repository already cloned in GitHub Desktop"],"steps":[{"action":"Open the repository you want to work in.","where":"Top-left \\"Current Repository\\" dropdown in the toolbar.","target":"Current Repository","why":"Every branch action applies to the selected repository.","checkpoint":"The repository name shows in the toolbar and the Changes tab lists its files.","hint_levels":["Look at the very top-left of the window.","The dropdown labelled Current Repository lists every repo you have added.","Click Current Repository, then click your repo name in the list."],"fade_tier":1},{"action":"Rename the current branch.","where":"Branch menu in the menu bar.","target":"Branch","why":"Renaming from the menu keeps local and remote in sync afterwards.","checkpoint":"The Current Branch button in the toolbar shows the new name.","hint_levels":["The menu bar has a Branch menu.","Branch > Rename lets you edit the name of the checked-out branch.","Click Branch, click Rename, type the new name, click Rename Branch."],"fade_tier":2}]}`

export function buildGeneratePrompt(ask: string, level: SkillLevel): string {
  return [
    'You are the lesson planner for Courseless, a desktop coach that walks people through a REAL task in a REAL app, one step at a time. You never produce videos, theory, or courses — only a doing-path the learner performs themselves.',
    '',
    `LEARNER REQUEST: ${ask}`,
    `LEARNER LEVEL: ${LEVEL_TEXT[level]}`,
    '',
    'Produce a lesson as a SINGLE JSON object matching exactly this schema:',
    SCHEMA,
    '',
    'HARD RULES:',
    '1. Output ONLY the JSON object. No markdown, no ``` fences, no commentary before or after.',
    '2. Between 6 and 12 steps. Each step is one concrete action the learner performs in the real app.',
    '3. "where" must name real UI surfaces (tab, ribbon group, panel, menu, keyboard shortcut). Never say "the appropriate place".',
    '4. "checkpoint" must be observable on screen — something the learner can literally look at and confirm.',
    '4b. "target" is the single element the learner touches, written EXACTLY as the visible label reads in the app ("Insert", "Blank workbook", "Commit to main", "New folder"). No articles, no verbs, no location words, 2-5 words. Courseless uses this string to find the element in the accessibility tree and point at it, so a guessed or paraphrased label is worse than a short one. If the step has no single clickable element (a keyboard-only step, a "read the output" step), set "target" to "".',
    '5. "hint_levels" must have exactly 3 entries that escalate: (1) a nudge that only points the attention, (2) a fuller explanation with the concrete names involved, (3) the exact click path or keystrokes.',
    '6. fade_tier: the first third of the steps are 1, the middle are mostly 2, the last third are 2 or 3. Guidance must fade as the lesson progresses.',
    '7. Prefer the default/most common version of the tool. If the request is ambiguous, pick the most likely tool and say which one in "tool".',
    '8. No step may be "watch a video", "read the docs" or "ask an AI to do it for you".',
    '',
    'Compact example of the exact output shape (yours must have 6-12 steps):',
    EXAMPLE,
    '',
    'Now output the JSON object for the learner request. JSON only.'
  ].join('\n')
}

// ---------------------------------------------------------------- recorded walkthroughs

/** "00:42" — marks are shown on their own clock, which is what the author felt. */
function stamp(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** One mark, written the way a person would describe the moment they marked. */
function markLine(m: RecordMark, i: number): string {
  const bits = [`${i + 1}. [${stamp(m.at)}]`]
  if (m.element?.name) {
    bits.push(`touched "${m.element.name}" (${m.element.controlType || 'element'})`)
    const inside = (m.element.ancestors ?? []).filter((a) => a && a !== m.element?.name).slice(0, 3)
    if (inside.length) bits.push(`inside ${inside.map((a) => `"${a}"`).join(' > ')}`)
  } else {
    bits.push('no element under the cursor (a keyboard step, or the desktop)')
  }
  if (m.windowTitle) bits.push(`window "${m.windowTitle}"`)
  if (m.process) bits.push(`app ${m.process}`)
  if (m.note) bits.push(`AUTHOR'S NOTE: "${m.note}"`)
  return bits.join(' · ')
}

/**
 * Turn a recording into a lesson.
 *
 * The marks are evidence, not a transcript: they say what the author touched and when, and the
 * author's notes say what they meant. Two rules carry the weight here —
 *   * `target` must be COPIED from a recorded element name, never paraphrased. That string is
 *     what B4 looks up in the accessibility tree on the recipient's machine, so a nicer-sounding
 *     rewrite silently breaks pointing for everyone the file is sent to.
 *   * the audience line rewrites the whole register. "my mom, complete beginner" and "new sales
 *     hires" are not the same lesson with a different intro; they are different sentences.
 */
export function buildRecordPrompt(session: {
  name: string
  audience: string
  marks: RecordMark[]
}): string {
  const tools = [...new Set(session.marks.map((m) => m.process).filter(Boolean))]
  const windows = [...new Set(session.marks.map((m) => m.windowTitle).filter(Boolean))].slice(0, 6)
  const names = [...new Set(session.marks.map((m) => m.element?.name).filter((n): n is string => !!n))]
  const audience = session.audience.trim()

  return [
    'You are the lesson planner for Courseless, a desktop coach that walks people through a REAL task in a REAL app, one step at a time.',
    'This time the lesson is not imagined: someone DID the task on their own machine and marked the moments that mattered. Turn their recording into a path a different person can follow.',
    '',
    `WHAT THEY CALLED IT: ${session.name}`,
    audience
      ? `WHO IT IS FOR: ${audience}`
      : 'WHO IT IS FOR: not stated — write for someone careful who has not done this before.',
    tools.length ? `APPS SEEN WHILE RECORDING: ${tools.join(', ')}` : '',
    windows.length ? `WINDOW TITLES SEEN: ${windows.map((w) => `"${w}"`).join(', ')}` : '',
    '',
    `THE MARKS, in the order they happened (${session.marks.length}):`,
    ...session.marks.map(markLine),
    '',
    names.length
      ? `ELEMENT NAMES THAT WERE ACTUALLY RECORDED (copy these EXACTLY into "target" — spelling, capitalisation and all):\n${names.map((n) => `  - ${n}`).join('\n')}`
      : 'No element names were recorded — every "target" must be "".',
    '',
    'Produce a lesson as a SINGLE JSON object matching exactly this schema:',
    SCHEMA,
    '',
    'HARD RULES:',
    '1. Output ONLY the JSON object. No markdown, no ``` fences, no commentary before or after.',
    '2. The marks are the SKELETON, not the whole lesson. Between and around them, add the steps a first-timer needs (opening the app, getting to the right window, confirming the result) so the lesson runs 6 to 12 steps from a cold start to the finished outcome.',
    '3. "target" MUST be copied character-for-character from the recorded element names above, and only on steps that really touch that element. On any step you inferred — a step with no recorded element, a typing step, a "check the result" step — set "target" to "". Inventing or rewording a target is worse than leaving it empty: Courseless looks that exact string up in the accessibility tree on the other person\'s computer.',
    '4. "where" must name real UI surfaces (window, ribbon, tab, panel, menu). The window titles above tell you what the surfaces are called.',
    '5. "checkpoint" must be observable on screen — something they can literally look at and confirm.',
    '6. "hint_levels" must have exactly 3 entries that escalate: a nudge, then the concrete names, then the exact click path.',
    '7. fade_tier: the first third are 1, the middle mostly 2, the last third 2 or 3. Guidance fades as the lesson goes on.',
    '8. Write "title" and "goal" as the OUTCOME the learner will have, in their words, not as "recording of ...".',
    audience
      ? `9. AUDIENCE. Every action, hint, checkpoint and word choice is for: ${audience}. Match their vocabulary exactly. If they are a beginner, use everyday words, name every button in full, keep one small thing per step and never assume a shortcut, a menu name or a piece of jargon is familiar. If they are experienced, be brisk and skip the obvious. This is the single most important rule after the JSON shape.`
      : '9. Write for someone careful who has not done this before: name every button in full, one small thing per step.',
    '10. No step may be "watch a video", "read the docs" or "ask an AI to do it for you". The learner does the task.',
    '',
    'Compact example of the exact output shape (yours must have 6-12 steps):',
    EXAMPLE,
    '',
    'Now output the JSON object for this recording. JSON only.'
  ]
    .filter((l) => l !== '')
    .join('\n')
}

export function buildRepairPrompt(problems: string[], raw: string): string {
  return [
    'Your previous reply was not a valid Courseless lesson object.',
    'Problems found:',
    ...problems.map((p) => `- ${p}`),
    '',
    'Reply again with ONLY the corrected JSON object (no fences, no prose), same schema as before:',
    SCHEMA,
    '',
    'For reference, this is what you sent (first 1200 chars):',
    raw.slice(0, 1200)
  ].join('\n')
}

export function buildCoachPrompt(
  message: string,
  ctx: StepContext | null,
  lessonTitle: string
): string {
  const lines = [
    `You are coaching the learner through the lesson "${lessonTitle}" that you planned earlier in this same conversation.`
  ]
  if (ctx?.step) {
    lines.push(
      `They are on step ${ctx.stepIndex + 1} of ${ctx.total}: "${ctx.step.action}" (where: ${ctx.step.where}).`,
      `The checkpoint for that step is: ${ctx.step.checkpoint}`
    )
  } else if (ctx) {
    lines.push(`They are on step ${ctx.stepIndex + 1} of ${ctx.total}.`)
  }
  lines.push(
    '',
    `LEARNER SAYS: ${message}`,
    '',
    'Answer as their calm, concrete coach. Rules: plain text only (no markdown headers, no JSON, no code fences unless they asked for code), at most 120 words, name the exact UI elements, and never offer to do the task for them — they are doing it. If they are asking about the lesson you wrote, answer from that lesson.'
  )
  return lines.join('\n')
}

export function buildCoachFallbackPrompt(
  lesson: Lesson,
  message: string,
  ctx: StepContext | null
): string {
  return [
    'You are the Courseless coach. Here is the lesson the learner is working through (JSON):',
    JSON.stringify({ title: lesson.title, tool: lesson.tool, goal: lesson.goal, steps: lesson.steps }),
    '',
    buildCoachPrompt(message, ctx, lesson.title)
  ].join('\n')
}

export function buildSuggestPrompt(lesson: Lesson, runStats: unknown): string {
  return [
    `The learner just finished the lesson "${lesson.title}" (${lesson.tool}).`,
    `Run statistics (JSON): ${JSON.stringify(runStats ?? {})}`,
    'Assistance rate is (hints + 2*skips) / steps — higher means they needed more help.',
    '',
    'Suggest the single best next thing for them to DO to build on this skill. If they needed a lot of help, suggest a consolidating repeat with a twist; if they cruised, suggest the next level up.',
    'Reply with ONLY this JSON object, no fences and no prose:',
    '{"title": string, "ask": string}',
    '"title" is a short lesson title (<= 60 chars). "ask" is a first-person request phrased the way a learner would type it into Courseless, e.g. "I want to be able to ...".'
  ].join('\n')
}

// ---------------------------------------------------------------- JSON extraction

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
