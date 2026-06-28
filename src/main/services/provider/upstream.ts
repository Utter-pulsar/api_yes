import type { ModelInfo, TestResult } from '@shared/types/common'
import type { UsageReport, UsageWindow } from '@shared/types/usage'
import type { AppCore } from '../context'
import { toCredentialView, type OAuthTokens, type StoredCredential } from '../store'
import { refreshAnthropicToken } from '../oauth/anthropic-oauth'
import { refreshOpenAIToken } from '../oauth/openai-oauth'
import { claudeCodeTransform, joinUpstream, openaiUsageTransform } from './forward-util'
import { CODEX_BASE, CODEX_CHATGPT_MODELS, codexHeaders } from './codex'
import { mt, listJoin } from '../i18n'

export interface ForwardTarget {
  url: string
  /** headers to SET/override on the upstream request (auth, version, UA) */
  setHeaders: Record<string, string>
  /** headers to MERGE (comma-join, de-duped) with the client's existing value rather than
   *  overwrite it — e.g. add our required anthropic-beta WITHOUT dropping the client's betas */
  mergeHeaders?: Record<string, string>
  /** client header names (lower-case) to DROP before forwarding (stale auth) */
  dropHeaders: string[]
  /** optional body rewrite (e.g. inject the Claude Code system prefix); identity if absent */
  transformBody?: (raw: Buffer) => Buffer
}

/** Merge comma-separated header values, de-duplicating, preserving order. */
export function mergeHeaderValue(existing: string | undefined, add: string): string {
  const parts = new Set<string>()
  for (const s of [existing ?? '', add]) {
    for (const p of s.split(',').map((x) => x.trim()).filter(Boolean)) parts.add(p)
  }
  return [...parts].join(',')
}

// ── token freshness ──────────────────────────────────────────────────────────
const EXPIRY_SKEW_MS = 60_000

/** Return a valid access token for an OAuth credential, refreshing + persisting if it's expiring. */
export async function ensureAccessToken(core: AppCore, cred: StoredCredential): Promise<string> {
  const o = cred.oauth
  if (!o?.accessToken) throw new Error(mt('up.missingOAuthToken'))
  const fresh = !o.expiresAt || o.expiresAt - Date.now() > EXPIRY_SKEW_MS
  if (fresh || !o.refreshToken) return o.accessToken

  const refreshed: OAuthTokens =
    cred.provider === 'anthropic'
      ? await refreshAnthropicToken(o.refreshToken)
      : await refreshOpenAIToken(o.refreshToken)
  const merged: OAuthTokens = {
    ...o,
    ...refreshed,
    account: refreshed.account?.email || refreshed.account?.plan ? refreshed.account : o.account,
    extra: { ...o.extra, ...refreshed.extra }
  }
  core.store.mutate((db) => {
    const c = db.credentials.find((x) => x.id === cred.id)
    if (c) {
      c.oauth = merged
      c.updatedAt = Date.now()
    }
  })
  core.broadcast('credentials.changed', core.store.data.credentials.map(toCredentialView))
  return merged.accessToken
}

// ── target resolution ────────────────────────────────────────────────────────
/** Resolve where/how to forward a client request for this credential. */
export async function resolveForward(
  core: AppCore,
  cred: StoredCredential,
  reqPath: string,
  search: string
): Promise<ForwardTarget> {
  if (cred.kind === 'apikey') {
    if (!cred.apiKey) throw new Error(mt('up.missingApiKey'))
    if (cred.provider === 'openai') {
      return {
        url: joinUpstream(cred.baseUrl, reqPath, search),
        setHeaders: { authorization: `Bearer ${cred.apiKey}` },
        dropHeaders: ['x-api-key'],
        // make streaming chat completions report usage so the proxy can meter tokens
        transformBody: openaiUsageTransform(reqPath)
      }
    }
    return {
      url: joinUpstream(cred.baseUrl, reqPath, search),
      setHeaders: { 'x-api-key': cred.apiKey, 'anthropic-version': '2023-06-01' },
      dropHeaders: ['authorization']
    }
  }

  // oauth
  const token = await ensureAccessToken(core, cred)
  if (cred.provider === 'anthropic') {
    return {
      url: joinUpstream(cred.baseUrl, reqPath, search),
      setHeaders: {
        authorization: `Bearer ${token}`,
        'anthropic-version': '2023-06-01',
        // mimic the real Claude Code client
        'user-agent': 'claude-cli/1.0.0 (external, cli)'
      },
      // Claude Code subscription tokens need BOTH betas; merge so the client's own betas survive
      mergeHeaders: { 'anthropic-beta': 'oauth-2025-04-20,claude-code-20250219' },
      dropHeaders: ['x-api-key'],
      transformBody: claudeCodeTransform(reqPath)
    }
  }
  // openai oauth → Codex backend (Codex CLI headers, incl. spoofed User-Agent, to pass Cloudflare)
  const accountId = (cred.oauth?.extra?.chatgptAccountId as string | undefined) ?? ''
  return {
    url: joinUpstream(CODEX_BASE, reqPath, search, { stripV1: true }),
    setHeaders: codexHeaders(token, accountId || undefined),
    dropHeaders: ['x-api-key']
  }
}

// ── direct calls (test / list models) ────────────────────────────────────────
async function directFetch(
  core: AppCore,
  cred: StoredCredential,
  method: string,
  path: string,
  bodyObj?: unknown
): Promise<Response> {
  const target = await resolveForward(core, cred, path, '')
  // no client headers here, so merge = plain set
  const headers: Record<string, string> = { ...target.setHeaders, ...(target.mergeHeaders ?? {}) }
  let body: string | undefined
  if (bodyObj !== undefined) {
    headers['content-type'] = 'application/json'
    let raw: Buffer = Buffer.from(JSON.stringify(bodyObj), 'utf8')
    if (target.transformBody) raw = target.transformBody(raw)
    body = raw.toString('utf8')
  }
  return fetch(target.url, { method, headers, body })
}

// merged model-list item: OpenAI (owned_by/created) ∪ Anthropic (display_name/created_at)
interface ModelListItem {
  id: string
  owned_by?: string
  created?: number
  display_name?: string
  created_at?: string
}
interface ModelListResp {
  data?: ModelListItem[]
}

/** Fetch the upstream model list. ChatGPT-OAuth has no model-list endpoint → returns a message. */
export async function listModels(
  core: AppCore,
  cred: StoredCredential
): Promise<{ ok: boolean; models: ModelInfo[]; message: string }> {
  if (cred.provider === 'openai' && cred.kind === 'oauth') {
    // no public list endpoint for the Codex backend → return the curated Codex-on-ChatGPT set
    return {
      ok: true,
      models: CODEX_CHATGPT_MODELS.map((id) => ({ id, label: 'Codex' })),
      message: mt('up.codexModels', { n: CODEX_CHATGPT_MODELS.length })
    }
  }
  const path = '/v1/models'
  try {
    const res = await directFetch(core, cred, 'GET', path)
    if (!res.ok) {
      return { ok: false, models: [], message: mt('up.listFailed', { status: res.status, t: (await res.text()).slice(0, 200) }) }
    }
    const json = (await res.json()) as ModelListResp
    const models: ModelInfo[] = (json.data ?? []).map((m) => {
      const label = m.display_name ?? m.owned_by
      const created =
        typeof m.created === 'number'
          ? m.created
          : m.created_at
            ? Math.floor(new Date(m.created_at).getTime() / 1000)
            : undefined
      return { id: m.id, label, created }
    })
    models.sort((a, b) => a.id.localeCompare(b.id))
    return { ok: true, models, message: mt('up.modelCount', { n: models.length }) }
  } catch (e) {
    return { ok: false, models: [], message: errMsg(e) }
  }
}

/**
 * Verify the credential — connectivity + auth, NOT a single model.
 *  - API-key / Anthropic-OAuth: the model list is a model-agnostic auth check that also reports the
 *    available models; Anthropic-OAuth falls back to a tiny messages probe if listing is forbidden.
 *  - ChatGPT/Codex-OAuth: there's no model-list endpoint, so we probe the candidate models in
 *    PARALLEL. The verdict is connection-based: 401/403 = real failure (token invalid/expired); any
 *    other response (200, or a 400 model/param rejection) proves the URL + token work. We then list
 *    every model that actually answered, e.g. "连接正常 · 可用模型：…".
 */
export async function testCredential(core: AppCore, cred: StoredCredential): Promise<TestResult> {
  const at = Date.now()

  if (cred.provider === 'openai' && cred.kind === 'oauth') {
    const probe = async (
      model: string
    ): Promise<{ model: string; ok: boolean; status?: number; err?: string }> => {
      try {
        // Codex /responses requires instructions + array input + store:false + stream:true, and
        // rejects max_output_tokens (the subscription manages its own limits). We cancel the stream
        // on the 200 headers, so the model barely generates → ~no cost.
        const res = await directFetch(core, cred, 'POST', '/v1/responses', {
          model,
          instructions: 'You are a helpful assistant.',
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'Reply with: ok' }] }],
          store: false,
          stream: true
        })
        if (res.ok) {
          void res.body?.cancel().catch(() => {})
          return { model, ok: true, status: res.status }
        }
        void res.body?.cancel().catch(() => {})
        return { model, ok: false, status: res.status }
      } catch (e) {
        return { model, ok: false, err: errMsg(e) }
      }
    }
    const probes = await Promise.all(CODEX_CHATGPT_MODELS.map(probe))
    const authFail = probes.find((p) => p.status === 401 || p.status === 403)
    if (authFail) {
      return { ok: false, at, message: mt('up.authFailRelogin', { status: authFail.status ?? '' }), status: authFail.status }
    }
    const available = probes.filter((p) => p.ok).map((p) => p.model)
    if (available.length) {
      return { ok: true, at, message: mt('up.okModels', { list: listJoin(available) }) }
    }
    // reached the server (got an HTTP status) but no candidate model worked → still connected/authed
    if (probes.some((p) => typeof p.status === 'number')) {
      return { ok: true, at, message: mt('up.okNoCandidate') }
    }
    return { ok: false, at, message: mt('up.cannotConnect', { e: probes[0]?.err ?? mt('up.networkError') }) }
  }

  // apikey + anthropic-oauth: model list is a model-agnostic auth check (and lists models)
  const ml = await listModels(core, cred)
  if (ml.ok) return { ok: true, at, message: mt('up.okWithMsg', { m: ml.message }) }
  if (cred.kind === 'apikey') return { ok: false, at, message: ml.message }

  // anthropic oauth: /models may be forbidden for the token → tiny messages probe; 401/403 = fail,
  // any other response = reachable + authed
  try {
    const res = await directFetch(core, cred, 'POST', '/v1/messages', {
      model: 'claude-haiku-4-5',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }]
    })
    if (res.ok) return { ok: true, at, message: mt('up.okSubAuthed'), status: res.status }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, at, message: mt('up.authFail', { status: res.status }), status: res.status }
    }
    return { ok: true, at, message: mt('up.okAuthed'), status: res.status }
  } catch (e) {
    return { ok: false, at, message: errMsg(e) }
  }
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

// ── subscription usage / quota ────────────────────────────────────────────────
// A current Claude Code client UA. The /api/oauth/usage endpoint drops any request whose
// User-Agent isn't `claude-code/*` into an aggressively rate-limited bucket → persistent 429
// (anthropics/claude-code #31021/#31637/#30930), so we override the proxy's claude-cli UA here.
const CLAUDE_CODE_UA = 'claude-code/2.0.77 (external, api-yes)'

const clampPct = (n: number): number => (isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0)

/** A reset value may be an absolute Unix epoch (seconds, >1e7) or a relative seconds-from-now. */
function resolveResetMs(raw: string | null): number | undefined {
  if (raw == null) return undefined
  const n = Number(raw)
  if (!isFinite(n) || n <= 0) return undefined
  return n > 1e7 ? n * 1000 : Date.now() + n * 1000
}

/** Anthropic unified rate-limit windows from a Messages response's headers (5h/7d/7d_opus/7d_sonnet). */
function anthropicWindowsFromHeaders(h: Headers): UsageWindow[] {
  const windows: UsageWindow[] = []
  const add = (key: string, wire: string): void => {
    const util = h.get(`anthropic-ratelimit-unified-${wire}-utilization`)
    if (util == null) return
    const pct = Number(util)
    if (!isFinite(pct)) return
    windows.push({
      key,
      percent: clampPct(pct * 100),
      resetsAt: resolveResetMs(h.get(`anthropic-ratelimit-unified-${wire}-reset`))
    })
  }
  add('5h', '5h')
  add('weekly', '7d')
  add('weekly_opus', '7d_opus')
  add('weekly_sonnet', '7d_sonnet')
  return windows
}

interface OAuthUsageWindow {
  utilization?: number
  resets_at?: string
}

async function fetchAnthropicUsage(core: AppCore, cred: StoredCredential, at: number): Promise<UsageReport> {
  const token = await ensureAccessToken(core, cred)

  // Preferred: the dedicated, zero-cost usage endpoint the Claude Code `/usage` panel calls. It
  // returns utilization (0..1) + an ISO reset per window; the per-model weekly windows may be absent.
  try {
    const res = await fetch(`${new URL(cred.baseUrl).origin}/api/oauth/usage`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'user-agent': CLAUDE_CODE_UA
      }
    })
    if (res.ok) {
      const json = (await res.json()) as Record<string, OAuthUsageWindow | null>
      const windows: UsageWindow[] = []
      const add = (key: string, src: string): void => {
        const o = json[src]
        if (o && typeof o.utilization === 'number') {
          windows.push({
            key,
            // this endpoint reports utilization ALREADY as a 0..100 percent (NOT the 0..1 fraction
            // the unified-* response headers use) — so do not multiply here.
            percent: clampPct(o.utilization),
            resetsAt: o.resets_at ? Date.parse(o.resets_at) || undefined : undefined
          })
        }
      }
      add('5h', 'five_hour')
      add('weekly', 'seven_day')
      add('weekly_opus', 'seven_day_opus')
      add('weekly_sonnet', 'seven_day_sonnet')
      if (windows.length) return { ok: true, provider: 'anthropic', at, windows }
      // 200 but nothing parseable → fall through to the header probe below (json() drained the body)
    } else {
      // release the undici socket on 429/4xx/5xx — the common case is the UA-bucketed 429 above
      void res.body?.cancel().catch(() => {})
    }
  } catch {
    /* network/parse failure → fall through to the header-based probe */
  }

  // Fallback: a tiny Haiku message carries the same numbers as anthropic-ratelimit-unified-* headers.
  // (no `tools` field — tools reclassify an OAuth request into the disabled overage lane and 400.)
  const res = await directFetch(core, cred, 'POST', '/v1/messages', {
    model: 'claude-haiku-4-5',
    max_tokens: 1,
    messages: [{ role: 'user', content: 'hi' }]
  })
  void res.body?.cancel().catch(() => {})
  if (res.status === 401 || res.status === 403) {
    return { ok: false, provider: 'anthropic', at, windows: [], message: mt('usage.authFail', { status: res.status }) }
  }
  const windows = anthropicWindowsFromHeaders(res.headers)
  return windows.length
    ? { ok: true, provider: 'anthropic', at, windows }
    : { ok: false, provider: 'anthropic', at, windows: [], message: mt('usage.noWindows') }
}

/** OpenAI Codex rate-limit windows from a /responses call's headers (primary=5h, secondary=weekly). */
function openaiWindowsFromHeaders(h: Headers): UsageWindow[] {
  const windows: UsageWindow[] = []
  const add = (key: string, wire: string): void => {
    const pct = h.get(`x-codex-${wire}-used-percent`)
    if (pct == null) return
    const n = Number(pct)
    if (!isFinite(n)) return
    windows.push({ key, percent: clampPct(n), resetsAt: resolveResetMs(h.get(`x-codex-${wire}-reset-at`)) })
  }
  add('5h', 'primary')
  add('weekly', 'secondary')
  return windows
}

async function fetchOpenAIUsage(core: AppCore, cred: StoredCredential, at: number): Promise<UsageReport> {
  // No standalone usage endpoint for the Codex backend — the windows ride on the /responses call as
  // account-wide x-codex-primary/secondary-* headers (present even when the model itself 400s). We
  // probe candidate models, cancel the bodies (≈no cost), and read headers off any response that has
  // them. Same shape as testCredential's connectivity probe.
  const probe = async (model: string): Promise<Response | null> => {
    try {
      const res = await directFetch(core, cred, 'POST', '/v1/responses', {
        model,
        instructions: 'You are a helpful assistant.',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
        store: false,
        stream: true
      })
      void res.body?.cancel().catch(() => {})
      return res
    } catch {
      return null
    }
  }
  const responses = (await Promise.all(CODEX_CHATGPT_MODELS.map(probe))).filter(
    (r): r is Response => r !== null
  )
  const withHeaders = responses.find((r) => r.headers.get('x-codex-primary-used-percent') != null)
  if (withHeaders) {
    const windows = openaiWindowsFromHeaders(withHeaders.headers)
    if (windows.length) return { ok: true, provider: 'openai', at, windows }
  }
  const authFail = responses.find((r) => r.status === 401 || r.status === 403)
  if (authFail) {
    return { ok: false, provider: 'openai', at, windows: [], message: mt('usage.authFail', { status: authFail.status }) }
  }
  return { ok: false, provider: 'openai', at, windows: [], message: mt('usage.noWindows') }
}

/** Read a subscription credential's usage/quota windows (5h / weekly / per-model weekly). */
export async function fetchUsage(core: AppCore, cred: StoredCredential): Promise<UsageReport> {
  const at = Date.now()
  if (cred.kind !== 'oauth') {
    return { ok: false, provider: cred.provider, at, windows: [], message: mt('usage.onlySub') }
  }
  try {
    return cred.provider === 'anthropic'
      ? await fetchAnthropicUsage(core, cred, at)
      : await fetchOpenAIUsage(core, cred, at)
  } catch (e) {
    return { ok: false, provider: cred.provider, at, windows: [], message: errMsg(e) }
  }
}
