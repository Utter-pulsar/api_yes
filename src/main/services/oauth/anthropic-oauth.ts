import type { OAuthTokens } from '../store'
import { createPkce, type Pkce } from './pkce'
import { mt } from '../i18n'

/**
 * Claude Code OAuth (Claude Pro/Max subscription). Constants verified across multiple OSS
 * implementations (opencode, claude-code-login). The token obtained here is used as a Bearer
 * token against the Messages API, NOT as an x-api-key — and the Messages request must carry the
 * "You are Claude Code" system prefix + oauth beta header (see provider/upstream.ts).
 */
export const ANTHROPIC_OAUTH = {
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  authorizeUrl: 'https://claude.ai/oauth/authorize',
  tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
  // paste-mode: the authorize page redirects to this console page which DISPLAYS the code for the
  // user to copy back (format: "<code>#<state>").
  redirectUri: 'https://console.anthropic.com/oauth/code/callback',
  scope: 'org:create_api_key user:profile user:inference'
} as const

export interface AnthropicAuthHandle {
  url: string
  pkce: Pkce
}

/** Build the authorize URL (paste-mode) + the PKCE pair to remember for the exchange. */
export function beginAnthropicAuth(): AnthropicAuthHandle {
  const pkce = createPkce()
  const u = new URL(ANTHROPIC_OAUTH.authorizeUrl)
  u.searchParams.set('code', 'true')
  u.searchParams.set('client_id', ANTHROPIC_OAUTH.clientId)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('redirect_uri', ANTHROPIC_OAUTH.redirectUri)
  u.searchParams.set('scope', ANTHROPIC_OAUTH.scope)
  u.searchParams.set('code_challenge', pkce.challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  u.searchParams.set('state', pkce.state)
  return { url: u.toString(), pkce }
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  account?: { email_address?: string; uuid?: string }
  organization?: { name?: string; uuid?: string }
}

function toTokens(r: TokenResponse): OAuthTokens {
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    expiresAt: r.expires_in ? Date.now() + r.expires_in * 1000 : undefined,
    scopes: (r.scope ?? ANTHROPIC_OAUTH.scope).split(/\s+/).filter(Boolean),
    account: {
      email: r.account?.email_address,
      organization: r.organization?.name,
      plan: mt('name.claudeSub')
    }
  }
}

/**
 * Exchange the pasted authorization code for tokens. The pasted value may be "code#state"; the
 * caller passes the raw code (without the #state) and the original state separately.
 */
export async function exchangeAnthropicCode(input: {
  code: string
  state: string
  verifier: string
}): Promise<OAuthTokens> {
  const res = await fetch(ANTHROPIC_OAUTH.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code: input.code,
      state: input.state,
      client_id: ANTHROPIC_OAUTH.clientId,
      redirect_uri: ANTHROPIC_OAUTH.redirectUri,
      code_verifier: input.verifier
    })
  })
  if (!res.ok) {
    throw new Error(mt('oauth.anthropicAuthFail', { status: res.status, t: (await res.text()).slice(0, 300) }))
  }
  return toTokens((await res.json()) as TokenResponse)
}

/** Refresh an expired/expiring access token. */
export async function refreshAnthropicToken(refreshToken: string): Promise<OAuthTokens> {
  const res = await fetch(ANTHROPIC_OAUTH.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: ANTHROPIC_OAUTH.clientId
    })
  })
  if (!res.ok) {
    throw new Error(mt('oauth.anthropicRefreshFail', { status: res.status, t: (await res.text()).slice(0, 300) }))
  }
  const tokens = toTokens((await res.json()) as TokenResponse)
  // refresh responses sometimes omit a new refresh_token → keep the old one
  if (!tokens.refreshToken) tokens.refreshToken = refreshToken
  return tokens
}

/** Split a pasted "code#state" into its parts (state optional). */
export function splitPastedCode(pasted: string): { code: string; state?: string } {
  const trimmed = pasted.trim()
  const hash = trimmed.indexOf('#')
  if (hash === -1) return { code: trimmed }
  return { code: trimmed.slice(0, hash), state: trimmed.slice(hash + 1) }
}
