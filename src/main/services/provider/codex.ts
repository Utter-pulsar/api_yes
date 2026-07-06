import { randomUUID } from 'node:crypto'

/**
 * Codex (ChatGPT subscription) adapter. The ChatGPT-OAuth token can only reach
 * https://chatgpt.com/backend-api/codex/responses (the Responses API), behind Cloudflare which
 * expects the official Codex CLI fingerprint. So to let an ORDINARY OpenAI client (which speaks
 * Chat Completions) use a ChatGPT subscription we:
 *   1. send Codex CLI headers (User-Agent `codex_cli_rs/…`, originator, beta, account id, session)
 *      so Cloudflare lets us through;
 *   2. translate a /chat/completions request into a /responses request;
 *   3. translate the /responses SSE back into chat.completion.chunk SSE (or a single
 *      chat.completion for non-streaming clients).
 */

export const CODEX_BASE = 'https://chatgpt.com/backend-api/codex'
const CODEX_VERSION = '0.50.0' // UA version; format matters to Cloudflare more than the exact number

function codexUserAgent(): string {
  const os =
    process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux'
  const arch = process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'arm64' : process.arch
  return `codex_cli_rs/${CODEX_VERSION} (${os}; ${arch}) API-YES`
}

/** Headers that make the request look like the official Codex CLI (→ past Cloudflare). */
export function codexHeaders(token: string, accountId?: string): Record<string, string> {
  const h: Record<string, string> = {
    authorization: `Bearer ${token}`,
    'openai-beta': 'responses=experimental',
    originator: 'codex_cli_rs',
    'user-agent': codexUserAgent(),
    session_id: randomUUID(),
    accept: 'text/event-stream',
    'content-type': 'application/json'
  }
  if (accountId) h['chatgpt-account-id'] = accountId
  return h
}

type AnyObj = Record<string, unknown>
const num = (x: unknown): number => (typeof x === 'number' && isFinite(x) ? x : 0)

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === 'object' && 'text' in p ? String((p as AnyObj).text ?? '') : ''))
      .join('')
  }
  return ''
}

/** Chat Completions tools `{type:function, function:{name,…}}` → Responses tools `{type:function,
 *  name,…}` (the function fields are flattened to the top level). */
function convertTools(tools: unknown): unknown[] | undefined {
  if (!Array.isArray(tools)) return undefined
  return tools.map((t) => {
    const tool = t as AnyObj
    const f = tool.function as AnyObj | undefined
    if (tool.type === 'function' && f && typeof f === 'object') {
      return {
        type: 'function',
        name: f.name,
        description: f.description,
        parameters: f.parameters,
        strict: f.strict ?? false
      }
    }
    return tool // already Responses-shaped or a built-in tool
  })
}

/** Map an OpenAI chat `reasoning_effort` to the Responses `reasoning.effort` (default medium). */
function mapEffort(effort: unknown): string {
  if (effort === 'low' || effort === 'minimal') return 'low'
  if (effort === 'high') return 'high'
  if (effort === 'medium') return 'medium'
  return 'medium'
}

function convertToolChoice(tc: unknown): unknown {
  if (tc == null) return undefined
  if (typeof tc === 'string') return tc // 'auto' | 'none' | 'required'
  const o = tc as AnyObj
  const f = o.function as AnyObj | undefined
  if (o.type === 'function' && f) return { type: 'function', name: f.name }
  return tc
}

/** Convert an OpenAI Chat Completions body into a Codex /responses body (incl. tools + tool calls). */
export function chatToResponses(chat: AnyObj): AnyObj {
  const messages = Array.isArray(chat.messages) ? (chat.messages as AnyObj[]) : []
  const sys = messages
    .filter((m) => m.role === 'system' || m.role === 'developer')
    .map((m) => textOf(m.content))
    .filter(Boolean)

  const input: AnyObj[] = []
  for (const m of messages) {
    if (m.role === 'system' || m.role === 'developer') continue
    if (m.role === 'tool') {
      // a tool result → function_call_output keyed by the call id
      input.push({
        type: 'function_call_output',
        call_id: m.tool_call_id ?? '',
        output: textOf(m.content)
      })
      continue
    }
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      const text = textOf(m.content)
      if (text) input.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] })
      for (const tc of m.tool_calls as AnyObj[]) {
        const f = (tc.function ?? {}) as AnyObj
        input.push({
          type: 'function_call',
          call_id: tc.id ?? '',
          name: f.name ?? '',
          arguments: typeof f.arguments === 'string' ? f.arguments : JSON.stringify(f.arguments ?? {})
        })
      }
      continue
    }
    const role = m.role === 'assistant' ? 'assistant' : 'user'
    const partType = role === 'assistant' ? 'output_text' : 'input_text'
    input.push({ type: 'message', role, content: [{ type: partType, text: textOf(m.content) }] })
  }

  const body: AnyObj = {
    model: chat.model,
    instructions: sys.join('\n\n') || 'You are a helpful assistant.',
    input,
    store: false,
    stream: true,
    // ask the reasoning model for a thinking summary so we can surface it as reasoning_content
    reasoning: { effort: mapEffort(chat.reasoning_effort), summary: 'auto' }
  }
  if (chat.temperature !== undefined) body.temperature = chat.temperature
  const tools = convertTools(chat.tools)
  if (tools && tools.length) {
    body.tools = tools
    const tc = convertToolChoice(chat.tool_choice)
    if (tc !== undefined) body.tool_choice = tc
    if (chat.parallel_tool_calls !== undefined) body.parallel_tool_calls = chat.parallel_tool_calls
  }
  return body
}

export interface CodexUsage {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  reasoningTokens: number
}
export function mapResponsesUsage(u: AnyObj | undefined): CodexUsage {
  return {
    inputTokens: num(u?.input_tokens),
    outputTokens: num(u?.output_tokens),
    cachedTokens: num((u?.input_tokens_details as AnyObj | undefined)?.cached_tokens),
    reasoningTokens: num((u?.output_tokens_details as AnyObj | undefined)?.reasoning_tokens)
  }
}

/** Sink for translated Codex events: text deltas, reasoning (thinking) deltas, tool start/args. */
interface ChatSink {
  onText: (text: string) => void
  onReasoning: (text: string) => void
  onToolStart: (index: number, id: string, name: string) => void
  onToolArgs: (index: number, delta: string) => void
}

/** Parse a Codex /responses SSE stream, driving a ChatSink. Returns usage + the chat finish_reason
 *  ('tool_calls' if the model emitted any function call, else 'stop'/'length'). */
async function readResponsesStream(
  body: ReadableStream<Uint8Array>,
  sink: ChatSink
): Promise<{ usage: AnyObj | null; finishReason: string }> {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let usage: AnyObj | null = null
  let finishReason = 'stop'
  let sawTool = false
  const idxMap = new Map<number, number>() // responses output_index → chat tool_call index
  let nextIdx = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      let ev: AnyObj
      try {
        ev = JSON.parse(payload) as AnyObj
      } catch {
        continue
      }
      switch (ev.type) {
        case 'response.output_text.delta':
          if (typeof ev.delta === 'string') sink.onText(ev.delta)
          break
        case 'response.reasoning_summary_text.delta':
        case 'response.reasoning_text.delta':
          if (typeof ev.delta === 'string') sink.onReasoning(ev.delta)
          break
        case 'response.output_item.added': {
          const item = ev.item as AnyObj | undefined
          if (item?.type === 'function_call') {
            const oi = typeof ev.output_index === 'number' ? ev.output_index : nextIdx
            const ci = nextIdx++
            idxMap.set(oi, ci)
            sawTool = true
            sink.onToolStart(ci, String(item.call_id ?? item.id ?? ''), String(item.name ?? ''))
          }
          break
        }
        case 'response.function_call_arguments.delta': {
          const oi = typeof ev.output_index === 'number' ? ev.output_index : 0
          if (typeof ev.delta === 'string') sink.onToolArgs(idxMap.get(oi) ?? 0, ev.delta)
          break
        }
        case 'response.completed':
        case 'response.incomplete':
          usage = ((ev.response as AnyObj | undefined)?.usage as AnyObj | null) ?? usage
          if (ev.type === 'response.incomplete') finishReason = 'length'
          break
      }
    }
  }
  if (sawTool && finishReason === 'stop') finishReason = 'tool_calls'
  return { usage, finishReason }
}

const chatChunk = (id: string, created: number, model: string, delta: AnyObj, finish: string | null): string =>
  `data: ${JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }]
  })}\n\n`

/** Stream-translate Codex /responses → chat.completion.chunk SSE written to `write`. Returns usage. */
export async function streamCodexAsChat(
  upstreamBody: ReadableStream<Uint8Array>,
  model: string,
  write: (s: string) => void
): Promise<CodexUsage | null> {
  const id = `chatcmpl-${randomUUID()}`
  const created = Math.floor(Date.now() / 1000)
  write(chatChunk(id, created, model, { role: 'assistant', content: '' }, null))
  const { usage, finishReason } = await readResponsesStream(upstreamBody, {
    onText: (t) => write(chatChunk(id, created, model, { content: t }, null)),
    onReasoning: (t) => write(chatChunk(id, created, model, { reasoning_content: t }, null)),
    onToolStart: (index, tid, name) =>
      write(
        chatChunk(id, created, model, { tool_calls: [{ index, id: tid, type: 'function', function: { name, arguments: '' } }] }, null)
      ),
    onToolArgs: (index, delta) =>
      write(chatChunk(id, created, model, { tool_calls: [{ index, function: { arguments: delta } }] }, null))
  })
  const mapped = usage ? mapResponsesUsage(usage) : null
  write(chatChunk(id, created, model, {}, finishReason))
  // OpenAI-style trailing usage chunk (choices:[]). Lets clients read usage AND lets a chained
  // API-YES proxy in front of this one meter the request too.
  if (mapped) {
    write(
      `data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [],
        usage: {
          prompt_tokens: mapped.inputTokens,
          completion_tokens: mapped.outputTokens,
          total_tokens: mapped.inputTokens + mapped.outputTokens
        }
      })}\n\n`
    )
  }
  write('data: [DONE]\n\n')
  return mapped
}

/** Collect a Codex /responses stream into a single non-streaming chat.completion JSON. */
export async function collectCodexAsChat(
  upstreamBody: ReadableStream<Uint8Array>,
  model: string
): Promise<{ body: string; usage: CodexUsage | null }> {
  let full = ''
  let reasoning = ''
  const tools: Array<{ id: string; name: string; args: string }> = []
  const { usage, finishReason } = await readResponsesStream(upstreamBody, {
    onText: (t) => (full += t),
    onReasoning: (t) => (reasoning += t),
    onToolStart: (index, id, name) => (tools[index] = { id, name, args: '' }),
    onToolArgs: (index, delta) => {
      if (tools[index]) tools[index].args += delta
    }
  })
  const mapped = usage ? mapResponsesUsage(usage) : null
  const message: AnyObj = { role: 'assistant', content: full || null }
  if (reasoning) message.reasoning_content = reasoning
  const calls = tools.filter(Boolean)
  if (calls.length) {
    message.tool_calls = calls.map((t) => ({
      id: t.id,
      type: 'function',
      function: { name: t.name, arguments: t.args }
    }))
  }
  const json = {
    id: `chatcmpl-${randomUUID()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: mapped
      ? {
          prompt_tokens: mapped.inputTokens,
          completion_tokens: mapped.outputTokens,
          total_tokens: mapped.inputTokens + mapped.outputTokens
        }
      : undefined
  }
  return { body: JSON.stringify(json), usage: mapped }
}
