import type { Id } from './common'

/** Cumulative consumption for one proxy endpoint. Tokens are summed across every request. */
export interface ProxyUsage {
  requests: number
  inputTokens: number
  outputTokens: number
  /** cached/prompt-cache read tokens (OpenAI cached_tokens, Anthropic cache_read_input_tokens) */
  cachedTokens: number
  /** reasoning tokens (OpenAI reasoning_tokens / Anthropic thinking) when reported */
  reasoningTokens: number
  /** epoch ms of the most recent request through this endpoint */
  lastUsedAt?: number
  /** per-model breakdown: model id → { requests, input, output } */
  byModel: Record<string, { requests: number; inputTokens: number; outputTokens: number }>
}

export function emptyUsage(): ProxyUsage {
  return { requests: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, byModel: {} }
}

/**
 * A virtual reverse-proxy endpoint. Many can hang off one credential; each carries its own
 * generated key (styled per provider) and its own usage counters, so the user can hand a
 * distinct, separately-metered, individually-revocable key to each tool/app.
 *
 * Clients all hit the SAME local server (http://host:port); the `key` in the Authorization
 * header selects which endpoint (→ credential → upstream) and which counter to bill.
 */
export interface ProxyEndpoint {
  id: Id
  credentialId: Id
  name: string
  /** the local proxy key the user gives to their client — shown in full (it is a LOCAL key) */
  key: string
  /** duplicate-local-key coordination: when mode is on, only one same-key endpoint is active */
  sameKeyMode?: boolean
  sameKeyActive?: boolean
  enabled: boolean
  /** exposure for THIS key: true (default) = loopback-only even when the server is on 0.0.0.0;
   *  false = reachable from the LAN. Each key has its own scope + its own URL. */
  localOnly: boolean
  /** optional cap on total tokens (input + output). 0/undefined = unlimited. Once reached, the
   *  endpoint refuses new requests (429) until the cap is raised or usage is reset. */
  limitTotalTokens?: number
  usage: ProxyUsage
  createdAt: number
  order: number
}

/** State of the single local HTTP reverse-proxy server. */
export interface ProxyServerStatus {
  running: boolean
  host: string
  port: number
  /** the machine's primary LAN IPv4, present only when bound to a wildcard host (0.0.0.0 / ::) —
   *  used to show a reachable address for credentials that allow LAN access */
  lanHost?: string
  /** set when the server failed to start (e.g. EADDRINUSE) */
  error?: string
}
