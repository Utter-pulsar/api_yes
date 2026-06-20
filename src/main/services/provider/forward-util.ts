/** Pure forwarding helpers (no Electron deps) — URL joining + Claude Code system injection. */

/** OAuth tokens for Anthropic are rejected unless the first system block is exactly this string. */
export const CLAUDE_CODE_SYSTEM = "You are Claude Code, Anthropic's official CLI for Claude."

/**
 * Join the credential's base URL with the path the client requested, de-duplicating a repeated
 * version segment so a base of `…/v1` + a client path of `/v1/chat/completions` doesn't become
 * `/v1/v1/…`. `stripV1` additionally removes a leading `/v1` from the client path (used for the
 * Codex backend, whose endpoint is `/responses`, not `/v1/responses`).
 */
export function joinUpstream(
  baseUrl: string,
  reqPath: string,
  search: string,
  opts?: { stripV1?: boolean }
): string {
  const base = new URL(baseUrl)
  const basePath = base.pathname.replace(/\/+$/, '') // '' | '/v1' | '/backend-api/codex'
  let path = reqPath.startsWith('/') ? reqPath : `/${reqPath}`
  if (opts?.stripV1) path = path.replace(/^\/v1(?=\/|$)/i, '') || '/'
  if (basePath) {
    const lower = path.toLowerCase()
    const bl = basePath.toLowerCase()
    if (lower === bl || lower.startsWith(`${bl}/`)) path = path.slice(basePath.length) || '/'
  }
  return base.origin + basePath + path + (search || '')
}

type AnyObj = Record<string, unknown>

/** Ensure the request's first system block is the Claude Code prefix (required for OAuth tokens). */
export function injectClaudeCode(bodyObj: AnyObj): AnyObj {
  const sys = bodyObj.system
  const prefixBlock = { type: 'text', text: CLAUDE_CODE_SYSTEM }
  if (sys == null) {
    bodyObj.system = CLAUDE_CODE_SYSTEM
  } else if (typeof sys === 'string') {
    if (!sys.startsWith(CLAUDE_CODE_SYSTEM)) {
      bodyObj.system = sys.trim() ? [prefixBlock, { type: 'text', text: sys }] : CLAUDE_CODE_SYSTEM
    }
  } else if (Array.isArray(sys)) {
    const first = sys[0] as AnyObj | undefined
    const ok =
      first &&
      first.type === 'text' &&
      typeof first.text === 'string' &&
      (first.text as string).startsWith(CLAUDE_CODE_SYSTEM)
    if (!ok) bodyObj.system = [prefixBlock, ...sys]
  }
  return bodyObj
}

/** A body transform that injects the Claude Code prefix, but only on /messages requests. */
export function claudeCodeTransform(reqPath: string): ((raw: Buffer) => Buffer) | undefined {
  if (!/\/messages\b/.test(reqPath)) return undefined
  return (raw: Buffer): Buffer => {
    try {
      const obj = JSON.parse(raw.toString('utf8')) as AnyObj
      return Buffer.from(JSON.stringify(injectClaudeCode(obj)), 'utf8')
    } catch {
      return raw
    }
  }
}

/**
 * Force `stream_options.include_usage` on OpenAI-compatible chat-completions STREAMING requests.
 * The OpenAI Chat Completions protocol only emits a terminal usage chunk when the client opts in
 * via this flag (official OpenAI, Qwen/DashScope, vLLM, DeepSeek, … all follow the same rule), and
 * most clients omit it — so without this the proxy never sees token counts and can't meter the
 * request. We touch ONLY chat completions (the Responses API reports usage unconditionally) and
 * leave any client-set stream_options intact. We deliberately do NOT add the non-standard
 * `continuous_usage_stats` (vLLM-only; official OpenAI 400s on unknown stream_options) — if a client
 * wants per-chunk usage it can pass that itself, and the meter will honor it.
 */
export function openaiUsageTransform(reqPath: string): ((raw: Buffer) => Buffer) | undefined {
  if (!/\/chat\/completions\b/.test(reqPath)) return undefined
  return (raw: Buffer): Buffer => {
    try {
      const obj = JSON.parse(raw.toString('utf8')) as AnyObj
      if (obj.stream !== true) return raw
      const so = (obj.stream_options ?? {}) as AnyObj
      if (so.include_usage === true) return raw
      obj.stream_options = { ...so, include_usage: true }
      return Buffer.from(JSON.stringify(obj), 'utf8')
    } catch {
      return raw
    }
  }
}
