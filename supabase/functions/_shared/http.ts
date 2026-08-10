// Response helpers shared by the three functions.

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...headers }
  })
}

export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response('ok', { headers: CORS_HEADERS }) : null
}

/** Server-Sent Events writer. Every event is one `data: <json>` frame, per the API contract. */
export class SseWriter {
  private encoder = new TextEncoder()
  private controller!: ReadableStreamDefaultController<Uint8Array>
  readonly stream: ReadableStream<Uint8Array>
  private closed = false

  constructor() {
    this.stream = new ReadableStream({
      start: (c) => {
        this.controller = c
      }
    })
  }

  send(event: unknown): void {
    if (this.closed) return
    try {
      this.controller.enqueue(this.encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
    } catch {
      this.closed = true
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.controller.close()
    } catch {
      /* already torn down by the client disconnecting */
    }
  }

  response(): Response {
    return new Response(this.stream, {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      }
    })
  }
}
