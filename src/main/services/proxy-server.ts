import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import type { ProxyEndpoint, ProxyServerStatus, Provider } from '@shared/types'
import type { AppCore } from './context'
import { ensureAccessToken, mergeHeaderValue, resolveForward } from './provider/upstream'
import { createUsageMeter, type ParsedUsage } from './provider/usage'
import type { StoredCredential } from './store'
import { recordDailyUsage, usageBucket } from './usage-history'
import { mt } from './i18n'
import {
  CODEX_BASE,
  CODEX_CHATGPT_MODELS,
  chatToResponses,
  codexHeaders,
  collectCodexAsChat,
  streamCodexAsChat
} from './provider/codex'

const isWildcard = (host: string): boolean => host === '0.0.0.0' || host === '::'

/** The machine's primary non-internal IPv4, for showing a reachable LAN address. */
function primaryLanIPv4(): string | undefined {
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address
    }
  }
  return undefined
}

/** True for loopback remote addresses (127.x, ::1, IPv4-mapped loopback). */
function isLoopback(addr?: string): boolean {
  if (!addr) return false
  return addr === '::1' || addr === '::ffff:127.0.0.1' || addr.startsWith('127.')
}

// hop-by-hop headers never forwarded (RFC 7230) + ones fetch/undici manages itself
const STRIP_REQ = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'accept-encoding'
])
const STRIP_RES = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-encoding', // we requested identity upstream, so the body is already plain
  'content-length' // recomputed by Node as we stream
])

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': '*'
}

/**
 * The single local reverse-proxy server. A client points its OpenAI/Anthropic base URL at
 * http://host:port and authenticates with a proxy key; that key selects the endpoint → credential
 * → upstream. The request is forwarded with the real auth injected, the response is streamed back
 * verbatim, and token usage is parsed off a tee of the stream and billed to that endpoint.
 */
export class ProxyServer {
  private server: Server | null = null
  private status: ProxyServerStatus
  constructor(private readonly core: AppCore) {
    this.status = { running: false, host: this.desiredHost(), port: core.store.data.settings.proxyPort }
  }

  /** Bind host is DERIVED, not configured: 0.0.0.0 only when some enabled API key allows LAN (so it
   *  can actually be reached), otherwise loopback-only. Per-key 403-gating still protects
   *  loopback-only keys even when the socket is on 0.0.0.0. */
  private desiredHost(): string {
    const anyLan = this.core.store.data.proxies.some((p) => p.enabled && p.localOnly === false)
    return anyLan ? '0.0.0.0' : '127.0.0.1'
  }

  getStatus(): ProxyServerStatus {
    return { ...this.status }
  }

  private setStatus(patch: Partial<ProxyServerStatus>): void {
    this.status = { ...this.status, ...patch }
    this.core.broadcast('proxy.status', this.getStatus())
  }

  async start(): Promise<ProxyServerStatus> {
    if (this.server) return this.getStatus()
    const host = this.desiredHost()
    const port = this.core.store.data.settings.proxyPort
    const server = createServer((req, res) => void this.handle(req, res))
    return new Promise<ProxyServerStatus>((resolve) => {
      server.once('error', (e: NodeJS.ErrnoException) => {
        this.server = null
        const msg = e.code === 'EADDRINUSE' ? mt('proxy.portTaken', { port }) : (e.message ?? String(e))
        this.setStatus({ running: false, host, port, error: msg })
        resolve(this.getStatus())
      })
      server.listen(port, host, () => {
        this.server = server
        this.setStatus({
          running: true,
          host,
          port,
          lanHost: isWildcard(host) ? primaryLanIPv4() : undefined,
          error: undefined
        })
        resolve(this.getStatus())
      })
    })
  }

  async stop(): Promise<ProxyServerStatus> {
    const server = this.server
    this.server = null
    if (!server) {
      this.setStatus({ running: false })
      return this.getStatus()
    }
    await new Promise<void>((resolve) => server.close(() => resolve()))
    this.setStatus({ running: false, error: undefined })
    return this.getStatus()
  }

  async restart(): Promise<ProxyServerStatus> {
    await this.stop()
    return this.start()
  }

  /** Re-derive host (credential exposure changed) / re-read port (settings changed): rebind only if
   *  it actually changed; if stopped, just reflect the target so the UI's API address stays in sync. */
  async applySettings(): Promise<ProxyServerStatus> {
    const host = this.desiredHost()
    const port = this.core.store.data.settings.proxyPort
    if (this.server) {
      if (host === this.status.host && port === this.status.port) return this.getStatus()
      return this.restart()
    }
    this.setStatus({
      host,
      port,
      lanHost: isWildcard(host) ? primaryLanIPv4() : undefined,
      error: undefined
    })
    return this.getStatus()
  }

  // ── request handling ───────────────────────────────────────────────────────
  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS)
      res.end()
      return
    }
    // friendly root / health
    if (url.pathname === '/' || url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json', ...CORS })
      res.end(JSON.stringify({ name: 'API-YES', ok: true, status: this.getStatus() }))
      return
    }

    const key = extractKey(req)
    if (!key) return this.fail(res, 401, mt('proxy.missingKey'))

    const endpoint = this.core.store.data.proxies.find((p) => p.key === key)
    if (!endpoint) return this.fail(res, 401, mt('proxy.invalidKey'))
    if (!endpoint.enabled) return this.fail(res, 403, mt('proxy.keyDisabled'))
    const cred = this.core.store.data.credentials.find((c) => c.id === endpoint.credentialId)
    if (!cred) return this.fail(res, 502, mt('proxy.credGone'))
    const provider = cred.provider
    if (cred.enabled === false) return this.fail(res, 403, mt('proxy.credDisabled'), provider)
    // per-key exposure: a loopback-only key refuses non-loopback callers even when the server
    // itself is bound to 0.0.0.0 (for other keys)
    if (endpoint.localOnly !== false && !isLoopback(req.socket.remoteAddress)) {
      return this.fail(res, 403, mt('proxy.localOnly'), provider)
    }
    if (
      endpoint.limitTotalTokens &&
      endpoint.usage.inputTokens + endpoint.usage.outputTokens >= endpoint.limitTotalTokens
    ) {
      return this.fail(res, 429, mt('proxy.capHit'), provider)
    }

    let rawBody: Buffer
    try {
      rawBody = await readBody(req)
    } catch {
      return this.fail(res, 400, mt('proxy.readBodyFailed'), provider)
    }

    // ChatGPT/Codex OAuth speaks ONLY the Responses API behind Cloudflare. Adapt the common
    // OpenAI surfaces so ordinary clients work: translate /chat/completions → /responses, and serve
    // a curated /models. (/responses passes through the generic path with Codex headers.)
    if (cred.provider === 'openai' && cred.kind === 'oauth') {
      if (/(^|\/)models\/?$/.test(url.pathname)) return this.serveCodexModels(res)
      if (/\/chat\/completions\/?$/.test(url.pathname)) {
        return this.handleCodexChat(res, cred, endpoint, rawBody)
      }
    }

    let target: Awaited<ReturnType<typeof resolveForward>>
    try {
      target = await resolveForward(this.core, cred, url.pathname, url.search)
    } catch (e) {
      return this.fail(res, 502, errText(e), provider)
    }

    // build upstream headers from the client's, minus hop-by-hop / dropped, plus our overrides
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.headers)) {
      const lk = k.toLowerCase()
      if (STRIP_REQ.has(lk) || target.dropHeaders.includes(lk)) continue
      if (v === undefined) continue
      headers[lk] = Array.isArray(v) ? v.join(', ') : v
    }
    Object.assign(headers, target.setHeaders)
    for (const [k, v] of Object.entries(target.mergeHeaders ?? {})) {
      const lk = k.toLowerCase()
      headers[lk] = mergeHeaderValue(headers[lk], v) // combine with the client's value, de-duped
    }
    headers['accept-encoding'] = 'identity' // keep the body parseable for usage counting

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && rawBody.length > 0
    const sendBody = hasBody && target.transformBody ? target.transformBody(rawBody) : rawBody
    if (hasBody) headers['content-length'] = String(sendBody.length)

    let upstream: Response
    try {
      upstream = await fetch(target.url, {
        method: req.method,
        headers,
        body: hasBody ? sendBody : undefined
      })
    } catch (e) {
      return this.fail(res, 502, `${mt('proxy.upstreamFailed', { e: errText(e) })} → ${target.url}`, provider)
    }

    // forward status + headers
    const outHeaders: Record<string, string> = { ...CORS }
    upstream.headers.forEach((value, name) => {
      if (!STRIP_RES.has(name.toLowerCase())) outHeaders[name] = value
    })
    res.writeHead(upstream.status, outHeaders)

    const contentType = upstream.headers.get('content-type') ?? ''
    // We inject stream_options.include_usage into OpenAI chat requests the client didn't ask for, so
    // the upstream now emits a terminal "usage-only" chunk (choices:[] + usage). Strip that chunk back
    // out before forwarding (we still meter it) so the client sees exactly the stream it would have
    // gotten without our injection — some clients otherwise re-render the whole answer on that extra
    // chunk. "We injected" ⇔ the body was rewritten (openaiUsageTransform returns the SAME buffer when
    // it doesn't touch it); a client that set include_usage itself isn't rewritten → passes through.
    const stripInjectedUsage =
      upstream.ok &&
      cred.provider === 'openai' &&
      hasBody &&
      sendBody !== rawBody &&
      contentType.includes('text/event-stream')

    // Meter usage off a tee of the stream. The meter yields CUMULATIVE snapshots; we bill the DELTA
    // each time it advances. Providers that report usage continuously (Anthropic message_delta, vLLM
    // continuous_usage_stats) meter live — a mid-stream disconnect still bills what arrived — while
    // providers that emit usage only at the end just bill once. No upstream usage → nothing billed.
    const meter = upstream.ok ? createUsageMeter(cred.provider, contentType) : null
    const dec = new TextDecoder()
    const enc = stripInjectedUsage ? new TextEncoder() : null
    const committed = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 }
    let billModel: string | undefined
    let billedAny = false
    const commit = (snap: ParsedUsage | null): void => {
      if (!snap) return
      if (snap.model) billModel = snap.model
      const delta = {
        inputTokens: Math.max(0, snap.inputTokens - committed.inputTokens),
        outputTokens: Math.max(0, snap.outputTokens - committed.outputTokens),
        cachedTokens: Math.max(0, snap.cachedTokens - committed.cachedTokens),
        reasoningTokens: Math.max(0, snap.reasoningTokens - committed.reasoningTokens)
      }
      if (delta.inputTokens || delta.outputTokens || delta.cachedTokens || delta.reasoningTokens) {
        committed.inputTokens += delta.inputTokens
        committed.outputTokens += delta.outputTokens
        committed.cachedTokens += delta.cachedTokens
        committed.reasoningTokens += delta.reasoningTokens
        this.billTokens(endpoint.id, delta)
        billedAny = true
      }
    }
    const meterText = (text: string): void => {
      if (!meter || !text) return
      try {
        commit(meter.push(text))
      } catch {
        /* usage is best-effort */
      }
    }
    // strip mode: forward complete SSE lines, dropping our injected usage-only chunk; keep the partial
    // trailing line in `fwd` for the next read. Re-encoding decoded UTF-8 text round-trips byte-for-byte.
    let fwd = ''
    const forwardFiltered = (text: string, flush: boolean): void => {
      if (!enc) return
      fwd += text
      let out = ''
      let nl: number
      while ((nl = fwd.indexOf('\n')) >= 0) {
        const line = fwd.slice(0, nl + 1)
        fwd = fwd.slice(nl + 1)
        if (!isUsageOnlyDataLine(line)) out += line
      }
      if (flush && fwd && !isUsageOnlyDataLine(fwd)) {
        out += fwd
        fwd = ''
      }
      if (out) {
        try {
          res.write(enc.encode(out))
        } catch {
          /* client gone */
        }
      }
    }

    if (upstream.body) {
      const reader = upstream.body.getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (stripInjectedUsage) {
            const text = dec.decode(value, { stream: true })
            meterText(text)
            forwardFiltered(text, false)
          } else {
            res.write(Buffer.from(value))
            meterText(dec.decode(value, { stream: true }))
          }
        }
      } catch {
        /* client disconnected mid-stream — keep whatever we already billed */
      }
      // flush the decoder tail through the same meter + (in strip mode) drop filter
      const tail = dec.decode()
      meterText(tail)
      if (stripInjectedUsage) forwardFiltered(tail, true)
    }
    res.end()

    // finalize the parser, then count the request once (a request that produced no parseable usage
    // isn't counted, matching the per-token meters).
    if (meter) {
      try {
        commit(meter.end())
      } catch {
        /* usage is best-effort */
      }
      if (billedAny) {
        // attribute the per-model breakdown once, with the resolved model + this request's totals,
        // so byModel stays consistent with the top-level counters even if early chunks lacked a model
        this.billRequest(endpoint.id, billModel, {
          inputTokens: committed.inputTokens,
          outputTokens: committed.outputTokens
        })
      }
    }
  }

  /** Serve the curated Codex model set as an OpenAI /models list (Codex has no list endpoint). */
  private serveCodexModels(res: ServerResponse): void {
    const data = CODEX_CHATGPT_MODELS.map((id) => ({ id, object: 'model', owned_by: 'openai' }))
    res.writeHead(200, { 'content-type': 'application/json', ...CORS })
    res.end(JSON.stringify({ object: 'list', data }))
  }

  /** Translate an OpenAI Chat Completions request into a Codex /responses call and stream the
   *  result back as chat.completion (chunks if the client asked to stream, else one object). */
  private async handleCodexChat(
    res: ServerResponse,
    cred: StoredCredential,
    endpoint: ProxyEndpoint,
    rawBody: Buffer
  ): Promise<void> {
    let chat: Record<string, unknown>
    try {
      chat = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>
    } catch {
      return this.fail(res, 400, mt('proxy.badJson'), 'openai')
    }
    const wantStream = chat.stream === true
    const model = typeof chat.model === 'string' ? chat.model : 'gpt-5.5'

    let token: string
    try {
      token = await ensureAccessToken(this.core, cred)
    } catch (e) {
      return this.fail(res, 502, errText(e), 'openai')
    }
    const accountId = cred.oauth?.extra?.chatgptAccountId as string | undefined

    let upstream: Response
    try {
      upstream = await fetch(`${CODEX_BASE}/responses`, {
        method: 'POST',
        headers: codexHeaders(token, accountId),
        body: JSON.stringify(chatToResponses(chat))
      })
    } catch (e) {
      return this.fail(res, 502, mt('proxy.upstreamFailed', { e: errText(e) }), 'openai')
    }
    if (!upstream.ok || !upstream.body) {
      const text = (await upstream.text().catch(() => '')).slice(0, 400)
      return this.fail(res, upstream.status || 502, mt('proxy.upstreamError', { t: text || upstream.statusText }), 'openai')
    }

    if (wantStream) {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        ...CORS
      })
      let usage: Awaited<ReturnType<typeof streamCodexAsChat>> = null
      try {
        usage = await streamCodexAsChat(upstream.body, model, (s) => res.write(s))
      } catch {
        /* client likely disconnected */
      }
      res.end()
      if (usage) this.bill(endpoint.id, { ...usage, model })
    } else {
      const { body, usage } = await collectCodexAsChat(upstream.body, model)
      res.writeHead(200, { 'content-type': 'application/json', ...CORS })
      res.end(body)
      if (usage) this.bill(endpoint.id, { ...usage, model })
    }
  }

  /** Add token deltas to an endpoint's TOP-LEVEL meters (no request/byModel) and push the live total
   *  to the UI. Called repeatedly across a stream as the upstream's cumulative usage advances. */
  private billTokens(
    proxyId: string,
    delta: { inputTokens: number; outputTokens: number; cachedTokens: number; reasoningTokens: number }
  ): void {
    let updated: ProxyEndpoint | undefined
    this.core.store.mutate((db) => {
      const p = db.proxies.find((x) => x.id === proxyId)
      if (!p) return
      p.usage.inputTokens += delta.inputTokens
      p.usage.outputTokens += delta.outputTokens
      p.usage.cachedTokens += delta.cachedTokens
      p.usage.reasoningTokens += delta.reasoningTokens
      p.usage.lastUsedAt = Date.now()
      updated = p
    })
    if (updated) this.core.broadcast('proxy.usage', { proxyId, usage: updated.usage })
  }

  /** Count one request against an endpoint (once, after its usage settled) and fold this request's
   *  totals into the per-model breakdown — done here, not per-chunk, so byModel matches top-level. */
  private billRequest(
    proxyId: string,
    model?: string,
    totals?: { inputTokens: number; outputTokens: number }
  ): void {
    let updated: ProxyEndpoint | undefined
    this.core.store.mutate((db) => {
      const p = db.proxies.find((x) => x.id === proxyId)
      if (!p) return
      p.usage.requests += 1
      if (model) {
        // usageBucket, not `??=`: the model id is upstream-controlled ("__proto__" must not
        // write through to Object.prototype)
        const m = usageBucket(p.usage.byModel, model)
        m.requests += 1
        if (totals) {
          m.inputTokens += totals.inputTokens
          m.outputTokens += totals.outputTokens
        }
      }
      // the permanent daily ledger (per endpoint + per credential) — unlike the counters above it
      // survives usage resets, so "what ran on which day" stays answerable long-term
      recordDailyUsage(db, p.credentialId, p.id, model, totals ?? { inputTokens: 0, outputTokens: 0 })
      updated = p
    })
    if (updated) this.core.broadcast('proxy.usage', { proxyId, usage: updated.usage })
  }

  /** One-shot bill (tokens + request) for the Codex path, whose usage is known only at the end. */
  private bill(
    proxyId: string,
    usage: { inputTokens: number; outputTokens: number; cachedTokens: number; reasoningTokens: number; model?: string }
  ): void {
    this.billTokens(proxyId, usage)
    this.billRequest(proxyId, usage.model, { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
  }

  /** Emit an error in the provider's native shape so the client surfaces the real message
   *  (Anthropic SDKs read {type:'error',error:{message}}; OpenAI SDKs read {error:{message}}). */
  private fail(res: ServerResponse, status: number, message: string, provider?: Provider): void {
    console.warn(`[proxy] ${status}: ${message}`)
    // surface server-side failures in the app window too, so debugging needs no terminal
    if (status >= 500) this.core.broadcast('toast', { kind: 'error', message: mt('proxy.toast', { status, message }) })
    const body =
      provider === 'anthropic'
        ? { type: 'error', error: { type: 'api_error', message } }
        : { error: { message, type: 'api_yes_proxy_error', code: status } }
    res.writeHead(status, { 'content-type': 'application/json', ...CORS })
    res.end(JSON.stringify(body))
  }
}

/** Readable error text including a fetch failure's underlying cause (ECONNREFUSED / ENOTFOUND / …). */
function errText(e: unknown): string {
  if (e instanceof Error) {
    const cause = (e as { cause?: unknown }).cause
    const causeMsg = cause instanceof Error ? cause.message : cause ? String(cause) : ''
    return causeMsg ? `${e.message}（${causeMsg}）` : e.message
  }
  return String(e)
}

/** True for an OpenAI streaming "usage-only" SSE line: `data: {choices:[], usage:{…}}`. That's the
 *  chunk our injected stream_options.include_usage makes the upstream emit; we meter it but drop it
 *  from the client stream so the client sees the stream it would have without our injection. */
function isUsageOnlyDataLine(rawLine: string): boolean {
  const line = rawLine.trim()
  if (!line.startsWith('data:')) return false
  const payload = line.slice(5).trim()
  if (!payload || payload === '[DONE]') return false
  try {
    const o = JSON.parse(payload) as { choices?: unknown; usage?: unknown }
    return (!Array.isArray(o.choices) || o.choices.length === 0) && o.usage != null
  } catch {
    return false
  }
}

function extractKey(req: IncomingMessage): string | null {
  const auth = req.headers['authorization']
  if (typeof auth === 'string' && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim()
  const xkey = req.headers['x-api-key']
  if (typeof xkey === 'string' && xkey.trim()) return xkey.trim()
  return null
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
