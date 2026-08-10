// Minimal AWS SigV4 request signer (Web Crypto only).
//
// The AWS SDK for JS would work here, but it drags several megabytes and a Node-stream event-stream
// parser into a cold start for what is, in the end, one signed POST. Signing is ~60 lines and the
// Bedrock event stream is parsed by hand in bedrock.ts.

const enc = new TextEncoder()

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? enc.encode(data) : data
  return hex(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return crypto.subtle.sign('HMAC', k, enc.encode(data))
}

/**
 * Canonical path for every service except S3: the request path, URI-encoded a SECOND time.
 * The wire path already carries `%3A` for the colon in a model id; the canonical form carries
 * `%253A`. Getting this wrong is the classic silent SignatureDoesNotMatch.
 */
function canonicalPath(path: string): string {
  return encodeURIComponent(path).replace(/%2F/g, '/')
}

export interface SigV4Input {
  method: string
  host: string
  path: string
  region: string
  service: string
  body: string
  headers: Record<string, string>
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

/** Returns the full header set to send, including Authorization. */
export async function signRequest(input: SigV4Input): Promise<Record<string, string>> {
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '') // 20260809T213000Z
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = await sha256Hex(input.body)

  const headers: Record<string, string> = {
    ...input.headers,
    host: input.host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash
  }
  if (input.sessionToken) headers['x-amz-security-token'] = input.sessionToken

  const signedKeys = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort()
  const canonicalHeaders = signedKeys
    .map((k) => {
      const key = Object.keys(headers).find((h) => h.toLowerCase() === k)!
      return `${k}:${String(headers[key]).trim().replace(/\s+/g, ' ')}\n`
    })
    .join('')
  const signedHeaders = signedKeys.join(';')

  const canonicalRequest = [
    input.method,
    canonicalPath(input.path),
    '', // no query strings anywhere in the Bedrock runtime calls we make
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n')

  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    await sha256Hex(canonicalRequest)
  ].join('\n')

  let key: ArrayBuffer | Uint8Array = enc.encode(`AWS4${input.secretAccessKey}`)
  for (const part of [dateStamp, input.region, input.service, 'aws4_request']) {
    key = await hmac(key, part)
  }
  const signature = hex(await hmac(key, stringToSign))

  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`
  return headers
}
