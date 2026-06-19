import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { shell } from 'electron'
import type { CredentialView, Provider, TestResult } from '@shared/types'
import type { AppCore } from './context'
import { toCredentialView, type OAuthTokens, type StoredCredential } from './store'
import { beginAnthropicAuth, exchangeAnthropicCode, splitPastedCode } from './oauth/anthropic-oauth'
import { beginOpenAIAuth, exchangeOpenAICode, OPENAI_OAUTH } from './oauth/openai-oauth'
import type { Pkce } from './oauth/pkce'
import { mt } from './i18n'

const CODEX_BASE = 'https://chatgpt.com/backend-api/codex'
const SESSION_TTL_MS = 5 * 60_000

interface OAuthSession {
  id: string
  provider: Provider
  name?: string
  mode: 'loopback' | 'paste'
  pkce: Pkce
  loopback?: Server
  timer?: ReturnType<typeof setTimeout>
}

const RESULT_HTML = (ok: boolean, msg: string): string => `<!doctype html><html><head>
<meta charset="utf-8"><title>API-YES</title><style>
body{font-family:system-ui,sans-serif;background:#FBF7EF;color:#2B2B2B;display:grid;place-items:center;height:100vh;margin:0}
.card{border:2px solid #2B2B2B;border-radius:16px;padding:32px 40px;text-align:center;background:#fff;box-shadow:3px 3px 0 0 rgba(43,43,43,.85)}
h1{margin:.2em 0;font-size:22px}p{opacity:.7}
</style></head><body><div class="card"><h1>${ok ? mt('oauthpage.ok') : mt('oauthpage.fail')}</h1>
<p>${msg}</p><p>${mt('oauthpage.close')}</p></div></body></html>`

export function registerOAuthService(core: AppCore): void {
  const sessions = new Map<string, OAuthSession>()

  const views = (): CredentialView[] =>
    core.store.data.credentials
      .slice()
      .sort((a, b) => a.order - b.order)
      .map(toCredentialView)

  const createCredential = (provider: Provider, name: string | undefined, tokens: OAuthTokens): StoredCredential => {
    const now = Date.now()
    const order = core.store.data.credentials.reduce((m, c) => Math.max(m, c.order), -1) + 1
    const cred: StoredCredential = {
      id: randomUUID(),
      name: name?.trim() || (provider === 'anthropic' ? mt('name.claudeSub') : mt('name.chatgptSub')),
      provider,
      kind: 'oauth',
      baseUrl: provider === 'anthropic' ? 'https://api.anthropic.com' : CODEX_BASE,
      oauth: tokens,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      order
    }
    core.store.mutate((db) => db.credentials.push(cred))
    core.broadcast('credentials.changed', views())
    return cred
  }

  const cleanup = (s: OAuthSession): void => {
    if (s.timer) clearTimeout(s.timer)
    if (s.loopback) s.loopback.close()
    sessions.delete(s.id)
  }

  // ── loopback capture (OpenAI) ──────────────────────────────────────────────
  const startLoopback = (s: OAuthSession): void => {
    const srv = createServer((req, res) => {
      const u = new URL(req.url ?? '/', `http://localhost:${OPENAI_OAUTH.redirectPort}`)
      if (!u.pathname.startsWith('/auth/callback')) {
        res.writeHead(404)
        res.end()
        return
      }
      const code = u.searchParams.get('code')
      const state = u.searchParams.get('state')
      const error = u.searchParams.get('error')
      void (async (): Promise<void> => {
        try {
          if (error) throw new Error(error)
          if (!code) throw new Error(mt('oauth.missingCode'))
          if (state && state !== s.pkce.state) throw new Error(mt('oauth.stateMismatch'))
          core.broadcast('oauth.status', { sessionId: s.id, phase: 'exchanging' })
          const tokens = await exchangeOpenAICode({ code, verifier: s.pkce.verifier })
          const cred = createCredential('openai', s.name, tokens)
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          res.end(RESULT_HTML(true, mt('oauth.connectedChatgpt')))
          core.broadcast('oauth.status', { sessionId: s.id, phase: 'success', credentialId: cred.id })
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          res.end(RESULT_HTML(false, message))
          core.broadcast('oauth.status', { sessionId: s.id, phase: 'error', message })
        } finally {
          cleanup(s)
        }
      })()
    })
    srv.on('error', (e: NodeJS.ErrnoException) => {
      const message =
        e.code === 'EADDRINUSE'
          ? mt('oauth.portInUse', { port: OPENAI_OAUTH.redirectPort })
          : (e.message ?? String(e))
      core.broadcast('oauth.status', { sessionId: s.id, phase: 'error', message })
      cleanup(s)
    })
    // bind dual-stack (covers both 127.0.0.1 and ::1 that "localhost" may resolve to)
    srv.listen(OPENAI_OAUTH.redirectPort)
    s.loopback = srv
  }

  core.commands.register('oauth.begin', ({ provider, name }) => {
    const id = randomUUID()
    if (provider === 'anthropic') {
      const handle = beginAnthropicAuth()
      const s: OAuthSession = { id, provider, name, mode: 'paste', pkce: handle.pkce }
      s.timer = setTimeout(() => cleanup(s), SESSION_TTL_MS)
      sessions.set(id, s)
      void shell.openExternal(handle.url)
      return { sessionId: id, authUrl: handle.url, mode: 'paste' as const }
    }
    const handle = beginOpenAIAuth()
    const s: OAuthSession = { id, provider, name, mode: 'loopback', pkce: handle.pkce }
    s.timer = setTimeout(() => cleanup(s), SESSION_TTL_MS)
    sessions.set(id, s)
    startLoopback(s)
    void shell.openExternal(handle.url)
    return { sessionId: id, authUrl: handle.url, mode: 'loopback' as const }
  })

  core.commands.register('oauth.submitCode', async ({ sessionId, code }): Promise<TestResult> => {
    const s = sessions.get(sessionId)
    if (!s) return { ok: false, at: Date.now(), message: mt('oauth.sessionExpired') }
    if (s.mode !== 'paste') return { ok: false, at: Date.now(), message: mt('oauth.noPasteNeeded') }
    try {
      core.broadcast('oauth.status', { sessionId, phase: 'exchanging' })
      const { code: rawCode, state } = splitPastedCode(code)
      const tokens = await exchangeAnthropicCode({
        code: rawCode,
        state: state ?? s.pkce.state,
        verifier: s.pkce.verifier
      })
      const cred = createCredential('anthropic', s.name, tokens)
      core.broadcast('oauth.status', { sessionId, phase: 'success', credentialId: cred.id })
      cleanup(s)
      return { ok: true, at: Date.now(), message: mt('oauth.success') }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      core.broadcast('oauth.status', { sessionId, phase: 'error', message })
      return { ok: false, at: Date.now(), message }
    }
  })

  core.commands.register('oauth.cancel', ({ sessionId }) => {
    const s = sessions.get(sessionId)
    if (s) {
      cleanup(s)
      core.broadcast('oauth.status', { sessionId, phase: 'cancelled' })
    }
  })
}
