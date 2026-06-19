import type { Provider } from '@shared/types/common'

/**
 * Normalized token usage extracted from an upstream response. Semantics are unified across
 * providers so the meters add up consistently:
 *   inputTokens  — TOTAL prompt tokens (OpenAI prompt_tokens already includes cached; for
 *                  Anthropic we add cache_creation + cache_read since input_tokens excludes them)
 *   cachedTokens — the cached subset of the input
 *   outputTokens — completion / output tokens (includes reasoning where the provider folds it in)
 *   reasoningTokens — reasoning / thinking tokens when separately reported
 */
export interface ParsedUsage {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  reasoningTokens: number
  model?: string
}

const num = (x: unknown): number => (typeof x === 'number' && isFinite(x) ? x : 0)

function isSSE(bodyText: string, contentType: string): boolean {
  if (contentType.includes('text/event-stream')) return true
  return /^\s*(event:|data:)/.test(bodyText)
}

/** Collect every `data:` JSON object out of an SSE body (skips the [DONE] sentinel). */
function sseObjects(bodyText: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const line of bodyText.split(/\r?\n/)) {
    const t = line.trim()
    if (!t.startsWith('data:')) continue
    const payload = t.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      out.push(JSON.parse(payload) as Record<string, unknown>)
    } catch {
      /* partial / non-JSON line — ignore */
    }
  }
  return out
}

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

/**
 * Parse usage from a (possibly streamed) upstream response body. Returns null if no usage could be
 * found (e.g. the client cancelled before the terminal usage chunk, or include_usage was off).
 */
export function parseUsage(
  provider: Provider,
  bodyText: string,
  contentType: string
): ParsedUsage | null {
  const sse = isSSE(bodyText, contentType)

  if (provider === 'anthropic') {
    if (sse) {
      const objs = sseObjects(bodyText)
      const start = objs.find((o) => o.type === 'message_start')
      const startUsage = (start?.message as AnyObj | undefined)?.usage as AnyObj | undefined
      const model = (start?.message as AnyObj | undefined)?.model as string | undefined
      // output_tokens is cumulative in message_delta → take the last one
      const deltas = objs.filter((o) => o.type === 'message_delta')
      const lastDelta = deltas[deltas.length - 1]
      const base = anthropicFromUsage(startUsage)
      if (lastDelta?.usage) {
        const d = anthropicFromUsage(lastDelta.usage as AnyObj)
        base.outputTokens = d.outputTokens || base.outputTokens
        base.reasoningTokens = d.reasoningTokens || base.reasoningTokens
        // message_delta may echo final input/cache counts
        if (num((lastDelta.usage as AnyObj).input_tokens)) base.inputTokens = d.inputTokens
      }
      if (!startUsage && !lastDelta) return null
      return { ...base, model }
    }
    try {
      const obj = JSON.parse(bodyText) as AnyObj
      const u = obj.usage as AnyObj | undefined
      if (!u) return null
      return { ...anthropicFromUsage(u), model: obj.model as string | undefined }
    } catch {
      return null
    }
  }

  // openai (chat completions OR responses)
  if (sse) {
    const objs = sseObjects(bodyText)
    let best: ParsedUsage | null = null
    for (const o of objs) {
      const u = openaiFromObject(o)
      if (u) best = u // last wins — the terminal chunk carries the complete numbers
    }
    return best
  }
  try {
    return openaiFromObject(JSON.parse(bodyText) as AnyObj)
  } catch {
    return null
  }
}
