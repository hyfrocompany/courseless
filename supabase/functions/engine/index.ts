// POST /functions/v1/engine — the whole model surface behind one entitled, metered endpoint.
//
// Streaming ops (generate, compile, coach) answer text/event-stream; suggest and vision answer JSON.
// Failure kinds match the client's CodexErrorKind taxonomy so the renderer's existing branches work
// unchanged.

import {
  BedrockError,
  MODELS,
  converse,
  converseStream,
  type ContentBlock
} from '../_shared/bedrock.ts'
import {
  type Counter,
  getEntitlement,
  getUser,
  incrementUsage,
  limitMessage,
  takeRateLimitSlot
} from '../_shared/entitlement.ts'
import { SseWriter, json, preflight } from '../_shared/http.ts'
import {
  LESSON_SCHEMA,
  SUGGEST_SCHEMA,
  type LessonLike,
  type RecordMark,
  type SkillLevel,
  type StepContext,
  buildCoachFallbackPrompt,
  buildCoachPrompt,
  buildGeneratePrompt,
  buildRecordPrompt,
  buildRepairPrompt,
  buildSuggestPrompt,
  lessonProblems
} from '../_shared/prompts.ts'

type Op = 'generate' | 'compile' | 'coach' | 'suggest' | 'vision'
const STREAMING: Op[] = ['generate', 'compile', 'coach']

/** The client's per-op ceiling is 120s; we stop at 110s so our error beats their timeout. */
const BUDGET_MS = 110_000

const COUNTER: Partial<Record<Op, Counter>> = {
  generate: 'lessons',
  compile: 'lessons',
  coach: 'coachTurns',
  vision: 'visionCalls'
}

interface Turn {
  role: 'user' | 'assistant'
  text: string
}

/** Converse rejects empty turns, a leading assistant turn, and two turns of the same role. */
function normaliseTurns(turns: Turn[]): { role: 'user' | 'assistant'; content: ContentBlock[] }[] {
  const clean = turns.filter((t) => t && typeof t.text === 'string' && t.text.trim().length > 0)
  while (clean.length && clean[0].role !== 'user') clean.shift()
  const merged: Turn[] = []
  for (const t of clean) {
    const last = merged[merged.length - 1]
    if (last && last.role === t.role) last.text = `${last.text}\n\n${t.text}`
    else merged.push({ role: t.role, text: t.text })
  }
  return merged.map((t) => ({ role: t.role, content: [{ text: t.text }] }))
}

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ ok: false, kind: 'TURN_FAILED', message: 'POST only' }, 405)

  const body = await req.json().catch(() => null)
  const op = body?.op as Op | undefined
  const payload = (body?.payload ?? {}) as Record<string, unknown>
  if (!op || !isOp(op)) {
    return json({ ok: false, kind: 'TURN_FAILED', message: `Unknown op "${String(op)}".` }, 400)
  }
  const streaming = STREAMING.includes(op)

  const user = await getUser(req)
  if (!user) {
    return json({ ok: false, kind: 'NOT_LOGGED_IN', message: 'Sign in to use Courseless.' }, 401)
  }

  if (!(await takeRateLimitSlot(user.id))) {
    return json(
      {
        ok: false,
        kind: 'TURN_FAILED',
        message: 'Courseless is catching its breath — try that again in a few seconds.'
      },
      429,
      { 'Retry-After': '10' }
    )
  }

  const counter = COUNTER[op]
  const ent = await getEntitlement(user.id)
  if (counter) {
    const used = ent.usage[counter]
    const limit = ent.limits[counter]
    if (limit !== null && used >= limit) {
      return json(
        {
          kind: 'LIMIT',
          message: limitMessage(ent.plan, counter, limit),
          // `plan` rides along so the client can offer the right upgrade without a second call.
          plan: ent.plan,
          usage: ent.usage,
          limits: ent.limits
        },
        402
      )
    }
  }

  const abort = new AbortController()
  const budget = setTimeout(() => abort.abort(), BUDGET_MS)
  // The client hanging up must stop the Bedrock call too, not just the SSE writer.
  req.signal.addEventListener('abort', () => abort.abort())

  try {
    if (!streaming) {
      const text = await runOnce(op, payload, abort.signal)
      if (counter) await incrementUsage(user.id, counter)
      return json({ ok: true, text })
    }
    return runStreaming(op, payload, user.id, counter, abort, budget)
  } catch (e) {
    clearTimeout(budget)
    const { kind, status, message } = classify(e, abort.signal.aborted)
    return json({ ok: false, kind, message }, status)
  } finally {
    if (!streaming) clearTimeout(budget)
  }
})

function isOp(op: string): op is Op {
  return ['generate', 'compile', 'coach', 'suggest', 'vision'].includes(op)
}

function classify(
  e: unknown,
  aborted: boolean
): { kind: string; status: number; message: string } {
  const message = e instanceof Error ? e.message : String(e)
  if (aborted || /abort/i.test(message)) {
    return { kind: 'TIMEOUT', status: 504, message: 'The model took too long to answer.' }
  }
  if (e instanceof BedrockError && (e.status === 429 || /throttl/i.test(message))) {
    return {
      kind: 'TURN_FAILED',
      status: 429,
      message: 'Courseless is busy right now — try that again in a moment.'
    }
  }
  return { kind: 'TURN_FAILED', status: 502, message: message.slice(0, 400) }
}

// ---------------------------------------------------------------- non-streaming ops

async function runOnce(
  op: Op,
  payload: Record<string, unknown>,
  signal: AbortSignal
): Promise<string> {
  if (op === 'suggest') {
    const lesson = (payload.lesson ?? {}) as LessonLike
    return converse(
      {
        modelId: MODELS.chat,
        messages: [{ role: 'user', content: [{ text: buildSuggestPrompt(lesson, payload.runStats) }] }],
        maxTokens: 400,
        temperature: 0,
        jsonSchema: { name: 'next_suggestion', schema: SUGGEST_SCHEMA }
      },
      signal
    )
  }

  // vision
  const imageBase64 = String(payload.imagePngBase64 ?? '')
  const prompt = String(payload.prompt ?? '')
  if (!imageBase64) throw new Error('vision requires imagePngBase64.')
  return converse(
    {
      modelId: MODELS.vision,
      messages: [
        {
          role: 'user',
          content: [
            { image: { format: 'png', source: { bytes: imageBase64 } } },
            { text: prompt }
          ]
        }
      ],
      maxTokens: 512,
      temperature: 0
    },
    signal
  )
}

// ---------------------------------------------------------------- streaming ops

function runStreaming(
  op: Op,
  payload: Record<string, unknown>,
  userId: string,
  counter: Counter | undefined,
  abort: AbortController,
  budget: number
): Response {
  const sse = new SseWriter()

  ;(async () => {
    try {
      const text =
        op === 'coach'
          ? await streamCoach(payload, sse, abort.signal)
          : await streamLesson(op, payload, sse, abort.signal)
      sse.send({ type: 'done', text })
      if (counter) await incrementUsage(userId, counter)
    } catch (e) {
      const { kind, message } = classify(e, abort.signal.aborted)
      sse.send({ type: 'error', kind, message })
    } finally {
      clearTimeout(budget)
      sse.close()
    }
  })()

  return sse.response()
}

async function streamLesson(
  op: Op,
  payload: Record<string, unknown>,
  sse: SseWriter,
  signal: AbortSignal
): Promise<string> {
  const prompt =
    op === 'generate'
      ? buildGeneratePrompt(
          String(payload.ask ?? ''),
          (payload.level as SkillLevel) ?? 'never'
        )
      : buildRecordPrompt({
          name: String(payload.name ?? 'Recording'),
          audience: String(payload.audience ?? ''),
          marks: (payload.marks ?? []) as RecordMark[]
        })

  sse.send({
    type: 'status',
    message: op === 'generate' ? 'Planning your doing-path…' : 'Turning your recording into a lesson…'
  })

  const raw = await converseStream(
    {
      modelId: MODELS.lesson,
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      maxTokens: 6000,
      temperature: 0,
      jsonSchema: { name: 'lesson', schema: LESSON_SCHEMA }
    },
    { onDelta: (text) => sse.send({ type: 'delta', text }) },
    signal
  )

  // Grammar-constrained output should make this unreachable; it is the same single repair round the
  // local engine had, kept as a net for the day a schema constraint is relaxed or times out midway.
  const problems = lessonProblems(raw)
  if (problems.length === 0) return raw

  sse.send({ type: 'status', message: 'Tidying up the lesson…' })
  const repaired = await converse(
    {
      modelId: MODELS.lesson,
      messages: [
        { role: 'user', content: [{ text: prompt }] },
        { role: 'assistant', content: [{ text: raw.slice(0, 4000) || '(empty)' }] },
        { role: 'user', content: [{ text: buildRepairPrompt(problems, raw) }] }
      ],
      maxTokens: 6000,
      temperature: 0,
      jsonSchema: { name: 'lesson', schema: LESSON_SCHEMA }
    },
    signal
  )
  const stillBroken = lessonProblems(repaired)
  if (stillBroken.length > 0) {
    throw Object.assign(new Error(`PARSE_FAILED: ${stillBroken.join(' ')}`.slice(0, 400)), {
      kind: 'PARSE_FAILED'
    })
  }
  return repaired
}

async function streamCoach(
  payload: Record<string, unknown>,
  sse: SseWriter,
  signal: AbortSignal
): Promise<string> {
  const lesson = (payload.lesson ?? { title: 'this lesson' }) as LessonLike
  const message = String(payload.message ?? '')
  const ctx = (payload.stepContext ?? null) as StepContext | null
  const history = Array.isArray(payload.history) ? (payload.history as Turn[]) : []

  // Stateless server: the first turn embeds the lesson JSON, later turns lean on the transcript the
  // client replays. Same two prompt builders the local engine chose between.
  const finalTurn =
    history.length === 0
      ? buildCoachFallbackPrompt(lesson, message, ctx)
      : buildCoachPrompt(message, ctx, lesson.title)

  const turns: Turn[] = [...history.slice(-12), { role: 'user', text: finalTurn }]
  if (history.length > 0) {
    // The transcript starts mid-conversation, so the lesson has to ride along on the first turn.
    turns.unshift({
      role: 'user',
      text: `Lesson you are coaching (JSON): ${JSON.stringify({
        title: lesson.title,
        tool: lesson.tool,
        goal: lesson.goal,
        steps: lesson.steps
      })}`
    })
  }

  sse.send({ type: 'status', message: 'Thinking…' })
  return converseStream(
    {
      modelId: MODELS.chat,
      messages: normaliseTurns(turns),
      maxTokens: 800,
      temperature: 0.3
    },
    { onDelta: (text) => sse.send({ type: 'delta', text }) },
    signal
  )
}
