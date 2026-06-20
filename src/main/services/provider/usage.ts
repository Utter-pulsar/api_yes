import type { Provider } from '@shared/types/common'

/**
 * Normalized token usage extracted from an upstream response. Semantics are unified across
 * providers so the meters add up consistently:
 *   inputTokens  — TOTAL prompt tokens (OpenAI prompt_tokens already includes cached; for
 *                  Anthropic we add cache_creation + cache_read since input_tokens excludes them)
 *   cachedTokens — the cached subset of the input
 *   outputTokens — completion / output tokens (includes reasoning where the provider folds it in)
 *   reasoningTokens — reasoning / thinking tokens when separately reported
 *
 * All four numbers are CUMULATIVE/ABSOLUTE for the request, never per-chunk deltas: every snapshot
 * the streaming meter emits is the running total so far, so callers bill the difference between
 * successive snapshots (see ProxyServer).
 */
export interface ParsedUsage {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  reasoningTokens: number
  model?: string
}

const num = (x: unknown): number => (typeof x === 'number' && isFinite(x) ? x : 0)

type AnyObj = Record<string, unknown>

function anthropicFromUsage(usage: AnyObj | undefined): Pick<ParsedUsage, 'inputTokens' | 'outputTokens' | 'cachedTokens' | 'reasoningTokens'> {
  const cacheCreate = num(usage?.cache_creation_input_tokens)
  const cacheRead = num(usage?.cache_read_input_tokens)
  const cached = cacheCreate + cacheRead
  return {
    inputTokens: num(usage?.input_tokens) + cached,
    outputTokens: num(usage?.output_tokens),
    cachedTokens: cached,
    reasoningTokens: num((usage?.output_tokens_details as AnyObj | undefined)?.thinking_tokens)
  }
}

function openaiChatFromUsage(usage: AnyObj): ParsedUsage {
  return {
    inputTokens: num(usage.prompt_tokens),
    outputTokens: num(usage.completion_tokens),
    cachedTokens: num((usage.prompt_tokens_details as AnyObj | undefined)?.cached_tokens),
    reasoningTokens: num((usage.completion_tokens_details as AnyObj | undefined)?.reasoning_tokens)
  }
}

function openaiResponsesFromUsage(usage: AnyObj): ParsedUsage {
  return {
    inputTokens: num(usage.input_tokens),
    outputTokens: num(usage.output_tokens),
    cachedTokens: num((usage.input_tokens_details as AnyObj | undefined)?.cached_tokens),
    reasoningTokens: num((usage.output_tokens_details as AnyObj | undefined)?.reasoning_tokens)
  }
}

/** Best-effort: pull a unified usage record from any OpenAI-shaped object (chat OR responses). */
function openaiFromObject(obj: AnyObj): ParsedUsage | null {
  // responses streaming: the terminal event wraps the full response under `.response`
  const respUsage = (obj.response as AnyObj | undefined)?.usage as AnyObj | undefined
  if (respUsage && (respUsage.input_tokens != null || respUsage.output_tokens != null)) {
    return { ...openaiResponsesFromUsage(respUsage), model: (obj.response as AnyObj).model as string | undefined }
  }
  const usage = obj.usage as AnyObj | undefined
  if (!usage) return null
  if (usage.prompt_tokens != null || usage.completion_tokens != null) {
    return { ...openaiChatFromUsage(usage), model: obj.model as string | undefined }
  }
  if (usage.input_tokens != null || usage.output_tokens != null) {
    return { ...openaiResponsesFromUsage(usage), model: obj.model as string | undefined }
  }
  return null
}

// stop buffering a NON-streamed (single-JSON) body past 16MB — it can't be parsed until complete, so
// past this we give up rather than grow unbounded. SSE bodies are parsed line-by-line (bounded).
const PARSE_CAP = 16 * 1024 * 1024

/**
 * A stateful, streaming usage parser. Feed it decoded text chunks as they arrive; each `push`
 * returns the latest CUMULATIVE usage snapshot iff the upstream's reported usage advanced (else
 * null). `end()` flushes — it parses a buffered non-streamed JSON body, or any trailing SSE object.
 *
 * This unifies "stream-bill when possible, else bill at the end":
 *  - Anthropic SSE → input at message_start, cumulative output at each message_delta (live).
 *  - OpenAI/Qwen/vLLM chat SSE with stream_options.include_usage → one terminal usage chunk (end).
 *  - vLLM chat SSE with continuous_usage_stats → a cumulative usage object every chunk (live).
 *  - OpenAI Responses SSE → usage on response.completed (end).
 *  - Non-streamed JSON → the whole body parsed once on end().
 */
export interface UsageMeter {
  /** Feed the next decoded text chunk; returns the latest absolute snapshot if it advanced. */
  push(text: string): ParsedUsage | null
  /** Finalize the stream; returns the final absolute snapshot if any usage was seen. */
  end(): ParsedUsage | null
}

export function createUsageMeter(provider: Provider, contentType: string): UsageMeter {
  const sseByContentType = contentType.includes('text/event-stream')
  let mode: 'sse' | 'json' | null = null
  let buf = '' // SSE: partial trailing line; JSON: the whole accumulating body
  let pending = '' // text held before the SSE-vs-JSON mode could be decided
  let jsonBytes = 0
  let jsonCapped = false
  let seen = false
  const snap: ParsedUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 }

  const snapshot = (): ParsedUsage | null => (seen ? { ...snap } : null)

  /** Fold one parsed SSE event / JSON object into the running absolute snapshot. */
  const ingest = (obj: AnyObj): boolean => {
    if (provider === 'anthropic') {
      if (obj.type === 'message_start') {
        const msg = obj.message as AnyObj | undefined
        const u = msg?.usage as AnyObj | undefined
        if (u) {
          const a = anthropicFromUsage(u)
          snap.inputTokens = a.inputTokens
          snap.cachedTokens = a.cachedTokens
          if (a.outputTokens) snap.outputTokens = a.outputTokens
          if (a.reasoningTokens) snap.reasoningTokens = a.reasoningTokens
        }
        if (typeof msg?.model === 'string') snap.model = msg.model
        seen = true
        return true
      }
      // output_tokens is cumulative in message_delta; input/cache may be echoed at the end. Keep the
      // snapshot monotonic (max) so a late echo that omits cache fields can't shrink the running total.
      if (obj.type === 'message_delta' && obj.usage) {
        const u = obj.usage as AnyObj
        const a = anthropicFromUsage(u)
        if (a.outputTokens) snap.outputTokens = Math.max(snap.outputTokens, a.outputTokens)
        if (a.reasoningTokens) snap.reasoningTokens = Math.max(snap.reasoningTokens, a.reasoningTokens)
        if (num(u.input_tokens)) {
          snap.inputTokens = Math.max(snap.inputTokens, a.inputTokens)
          snap.cachedTokens = Math.max(snap.cachedTokens, a.cachedTokens)
        }
        seen = true
        return true
      }
      return false
    }
    // openai (chat OR responses) — every usage object is the cumulative total, so replace wholesale
    const u = openaiFromObject(obj)
    if (!u) return false
    snap.inputTokens = u.inputTokens
    snap.outputTokens = u.outputTokens
    snap.cachedTokens = u.cachedTokens
    snap.reasoningTokens = u.reasoningTokens
    if (u.model) snap.model = u.model
    seen = true
    return true
  }

  /** Parse a complete non-streamed JSON body (Anthropic message / OpenAI chat|responses object). */
  const parseWhole = (text: string): void => {
    let obj: AnyObj
    try {
      obj = JSON.parse(text) as AnyObj
    } catch {
      return
    }
    if (provider === 'anthropic') {
      const u = obj.usage as AnyObj | undefined
      if (!u) return
      const a = anthropicFromUsage(u)
      snap.inputTokens = a.inputTokens
      snap.outputTokens = a.outputTokens
      snap.cachedTokens = a.cachedTokens
      snap.reasoningTokens = a.reasoningTokens
      if (typeof obj.model === 'string') snap.model = obj.model
      seen = true
    } else {
      ingest(obj)
    }
  }

  const drainSseLines = (): boolean => {
    let changed = false
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        if (ingest(JSON.parse(payload) as AnyObj)) changed = true
      } catch {
        /* partial / non-JSON line — ignore */
      }
    }
    return changed
  }

  return {
    push(text: string): ParsedUsage | null {
      if (!text) return null
      if (mode === null) {
        if (sseByContentType) {
          mode = 'sse'
        } else {
          const head = (pending + text).trimStart()
          if (!head) {
            pending += text
            return null
          }
          // SSE line kinds: comment (`: …`), data:, event:, id:, retry:. JSON starts with {/[ — never these.
          mode = /^(:|data:|event:|id:|retry:)/.test(head) ? 'sse' : 'json'
          text = pending + text
          pending = ''
        }
      }
      if (mode === 'json') {
        if (jsonCapped) return null
        jsonBytes += text.length
        if (jsonBytes > PARSE_CAP) {
          jsonCapped = true
          buf = ''
          return null
        }
        buf += text
        return null
      }
      // sse
      buf += text
      if (buf.length > PARSE_CAP) buf = buf.slice(-PARSE_CAP) // guard a no-newline flood
      return drainSseLines() ? snapshot() : null
    },

    end(): ParsedUsage | null {
      if (mode === null && pending.trim()) {
        mode = 'json'
        buf = pending
        pending = ''
      }
      if (mode === 'json') {
        if (!jsonCapped && buf.trim()) parseWhole(buf)
      } else if (mode === 'sse') {
        const line = buf.trim()
        if (line.startsWith('data:')) {
          const payload = line.slice(5).trim()
          if (payload && payload !== '[DONE]') {
            try {
              ingest(JSON.parse(payload) as AnyObj)
            } catch {
              /* ignore */
            }
          }
        }
      }
      return snapshot()
    }
  }
}

/**
 * Parse usage from a fully-buffered (possibly streamed) upstream response body. Convenience wrapper
 * over the streaming meter for one-shot callers. Returns null if no usage could be found.
 */
export function parseUsage(
  provider: Provider,
  bodyText: string,
  contentType: string
): ParsedUsage | null {
  const meter = createUsageMeter(provider, contentType)
  meter.push(bodyText)
  return meter.end()
}
