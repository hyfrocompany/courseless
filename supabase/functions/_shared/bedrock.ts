// Bedrock Converse / ConverseStream over plain fetch + SigV4.

import { signRequest } from './sigv4.ts'

export const MODELS = {
  /** Lesson JSON: grammar-constrained structured output, deterministic. */
  lesson: 'qwen.qwen3-235b-a22b-2507-v1:0',
  /** Coach chat + next-step suggestion: fast, cheap, streams ~200 tok/s. */
  chat: 'qwen.qwen3-next-80b-a3b',
  /** Screenshot grounding. Answers in 0-1000 normalised coords; the CLIENT scales to pixels. */
  vision: 'qwen.qwen3-vl-235b-a22b'
} as const

const REGION = Deno.env.get('BEDROCK_REGION') ?? 'us-west-2'
const ACCESS_KEY_ID = Deno.env.get('BEDROCK_AWS_ACCESS_KEY_ID') ?? ''
const SECRET_ACCESS_KEY = Deno.env.get('BEDROCK_AWS_SECRET_ACCESS_KEY') ?? ''

export interface ContentBlock {
  text?: string
  image?: { format: 'png' | 'jpeg'; source: { bytes: string } }
}

export interface ConverseRequest {
  modelId: string
  messages: { role: 'user' | 'assistant'; content: ContentBlock[] }[]
  system?: string
  maxTokens?: number
  temperature?: number
  /** Grammar-constrained output. The schema is passed to Bedrock as a JSON-encoded STRING. */
  jsonSchema?: { name: string; schema: unknown }
}

function buildBody(req: ConverseRequest): string {
  const body: Record<string, unknown> = {
    messages: req.messages,
    inferenceConfig: {
      maxTokens: req.maxTokens ?? 6000,
      temperature: req.temperature ?? 0
    }
  }
  if (req.system) body.system = [{ text: req.system }]
  if (req.jsonSchema) {
    body.outputConfig = {
      textFormat: {
        type: 'json_schema',
        structure: {
          jsonSchema: {
            name: req.jsonSchema.name,
            // Bedrock rejects an inline object here: the schema must arrive as a string.
            schema: JSON.stringify(req.jsonSchema.schema)
          }
        }
      }
    }
  }
  return JSON.stringify(body)
}

async function send(
  req: ConverseRequest,
  action: 'converse' | 'converse-stream',
  signal?: AbortSignal
): Promise<Response> {
  if (!ACCESS_KEY_ID || !SECRET_ACCESS_KEY) {
    throw new Error('Bedrock credentials are not configured on the server.')
  }
  const host = `bedrock-runtime.${REGION}.amazonaws.com`
  const path = `/model/${encodeURIComponent(req.modelId)}/${action}`
  const body = buildBody(req)
  const headers = await signRequest({
    method: 'POST',
    host,
    path,
    region: REGION,
    service: 'bedrock',
    body,
    headers: {
      'content-type': 'application/json',
      accept: action === 'converse' ? 'application/json' : 'application/vnd.amazon.eventstream'
    },
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY
  })
  return fetch(`https://${host}${path}`, { method: 'POST', headers, body, signal })
}

export class BedrockError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

/** Non-streaming Converse. Returns the concatenated assistant text. */
export async function converse(req: ConverseRequest, signal?: AbortSignal): Promise<string> {
  const res = await send(req, 'converse', signal)
  if (!res.ok) {
    throw new BedrockError(`Bedrock ${res.status}: ${(await res.text()).slice(0, 400)}`, res.status)
  }
  const json = await res.json()
  const blocks: ContentBlock[] = json?.output?.message?.content ?? []
  return blocks
    .map((b) => b.text ?? '')
    .join('')
    .trim()
}

// ---------------------------------------------------------------- event stream framing

/**
 * AWS event-stream frame: [total_len u32][headers_len u32][prelude_crc u32][headers][payload][crc u32].
 * Headers are (u8 name_len, name, u8 value_type, value); we only read type 7 (string), which covers
 * every header Bedrock sends (`:event-type`, `:message-type`, `:exception-type`, `:content-type`).
 * CRCs are not checked — TLS already guarantees integrity and a mismatch would be unactionable.
 */
function parseFrames(buf: Uint8Array): { frames: { headers: Record<string, string>; payload: Uint8Array }[]; rest: Uint8Array } {
  const frames: { headers: Record<string, string>; payload: Uint8Array }[] = []
  let off = 0
  while (buf.length - off >= 16) {
    const view = new DataView(buf.buffer, buf.byteOffset + off, buf.length - off)
    const total = view.getUint32(0)
    if (buf.length - off < total) break
    const headersLen = view.getUint32(4)
    const headers: Record<string, string> = {}
    let h = 12
    const headersEnd = 12 + headersLen
    while (h < headersEnd) {
      const nameLen = view.getUint8(h)
      h += 1
      const name = new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset + h, nameLen))
      h += nameLen
      const type = view.getUint8(h)
      h += 1
      if (type === 7) {
        const valLen = view.getUint16(h)
        h += 2
        headers[name] = new TextDecoder().decode(
          new Uint8Array(view.buffer, view.byteOffset + h, valLen)
        )
        h += valLen
      } else {
        // Not emitted by Bedrock; skipping the rest of the header block is the only safe move.
        h = headersEnd
      }
    }
    const payload = new Uint8Array(
      view.buffer,
      view.byteOffset + headersEnd,
      total - headersEnd - 4
    )
    frames.push({ headers, payload: new Uint8Array(payload) })
    off += total
  }
  return { frames, rest: buf.slice(off) }
}

export interface StreamHooks {
  onDelta?(text: string): void
}

/**
 * ConverseStream. Feeds text deltas to `onDelta` and resolves with the full assistant text.
 * Bedrock exception frames become a thrown BedrockError so callers map them like any HTTP failure.
 */
export async function converseStream(
  req: ConverseRequest,
  hooks: StreamHooks,
  signal?: AbortSignal
): Promise<string> {
  const res = await send(req, 'converse-stream', signal)
  if (!res.ok || !res.body) {
    throw new BedrockError(
      `Bedrock ${res.status}: ${(await res.text()).slice(0, 400)}`,
      res.status || 502
    )
  }

  const reader = res.body.getReader()
  let pending = new Uint8Array(0)
  let full = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const merged = new Uint8Array(pending.length + value.length)
    merged.set(pending)
    merged.set(value, pending.length)
    const { frames, rest } = parseFrames(merged)
    pending = rest

    for (const frame of frames) {
      const messageType = frame.headers[':message-type']
      const eventType = frame.headers[':event-type']
      let json: Record<string, unknown> = {}
      try {
        json = JSON.parse(new TextDecoder().decode(frame.payload))
      } catch {
        continue
      }
      if (messageType === 'exception' || messageType === 'error') {
        const kind = frame.headers[':exception-type'] ?? frame.headers[':error-code'] ?? 'error'
        throw new BedrockError(`Bedrock ${kind}: ${String(json.message ?? '').slice(0, 300)}`, 502)
      }
      if (eventType === 'contentBlockDelta') {
        const text = (json as { delta?: { text?: string } }).delta?.text
        if (text) {
          full += text
          hooks.onDelta?.(text)
        }
      }
    }
  }
  return full.trim()
}
