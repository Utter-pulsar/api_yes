import type { OAuthTokens } from '../store'
import { createPkce, decodeJwt, type Pkce } from './pkce'
import { mt } from '../i18n'

/**
 * Codex CLI OAuth (ChatGPT Plus/Pro/Team sign-in). Constants verified against the openai/codex
 * source. The access token obtained here can ONLY call the Codex backend
 * (https://chatgpt.com/backend-api/codex/responses) — not api.openai.com/v1 — and needs the
 * chatgpt-account-id derived from the id_token (see provider/upstream.ts).
 */
export const OPENAI_OAUTH = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  authorizeUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  redirectPort: 1455,
  redirectUri: 'http://localhost:1455/auth/callback',
  scope: 'openid profile email offline_access'
} as const

export interface OpenAIAuthHandle {
  url: string
  pkce: Pkce
}

export function beginOpenAIAuth(): OpenAIAuthHandle {
  const pkce = createPkce()
  const u = new URL(OPENAI_OAUTH.authorizeUrl)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', OPENAI_OAUTH.clientId)
  u.searchParams.set('redirect_uri', OPENAI_OAUTH.redirectUri)
  u.searchParams.set('scope', OPENAI_OAUTH.scope)
  u.searchParams.set('code_challenge', pkce.challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  u.searchParams.set('id_token_add_organizations', 'true')
  u.searchParams.set('codex_cli_simplified_flow', 'true')
  u.searchParams.set('state', pkce.state)
  return { url: u.toString(), pkce }
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  id_token?: string
  expires_in?: number
  scope?: string
}

/** Pull the ChatGPT account id + email/plan out of the id_token claims. */
function accountFromIdToken(idToken?: string): {
  accountId?: string
  email?: string
  plan?: string
  organization?: string
} {
  if (!idToken) return {}
  const claims = decodeJwt(idToken)
  if (!claims) return {}
  const auth = claims['https://api.openai.com/auth'] as
    | { chatgpt_account_id?: string; chatgpt_plan_type?: string; organization_id?: string }
    | undefined
  return {
    accountId: auth?.chatgpt_account_id,
    plan: auth?.chatgpt_plan_type ? `ChatGPT ${auth.chatgpt_plan_type}` : mt('name.chatgptSub'),
    organization: auth?.organization_id,
    email: typeof claims.email === 'string' ? claims.email : undefined
  }
}

function toTokens(r: TokenResponse): OAuthTokens {
  const acct = accountFromIdToken(r.id_token)
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    expiresAt: r.expires_in ? Date.now() + r.expires_in * 1000 : undefined,
    scopes: (r.scope ?? OPENAI_OAUTH.scope).split(/\s+/).filter(Boolean),
    account: { email: acct.email, plan: acct.plan, organization: acct.organization },
    extra: { chatgptAccountId: acct.accountId, idToken: r.id_token }
  }
}

export async function exchangeOpenAICode(input: {
  code: string
  verifier: string
}): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: OPENAI_OAUTH.redirectUri,
    client_id: OPENAI_OAUTH.clientId,
    code_verifier: input.verifier
  })
  const res = await fetch(OPENAI_OAUTH.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })
  if (!res.ok) {
    throw new Error(mt('oauth.openaiAuthFail', { status: res.status, t: (await res.text()).slice(0, 300) }))
  }
  return toTokens((await res.json()) as TokenResponse)
}

export async function refreshOpenAIToken(refreshToken: string): Promise<OAuthTokens> {
  const res = await fetch(OPENAI_OAUTH.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: OPENAI_OAUTH.clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: OPENAI_OAUTH.scope
    })
  })
  if (!res.ok) {
    throw new Error(mt('oauth.openaiRefreshFail', { status: res.status, t: (await res.text()).slice(0, 300) }))
  }
  const tokens = toTokens((await res.json()) as TokenResponse)
  if (!tokens.refreshToken) tokens.refreshToken = refreshToken
  return tokens
}
