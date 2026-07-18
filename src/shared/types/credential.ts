import type { CredentialKind, Id, Provider, TestResult } from './common'

/** OAuth subscription account info surfaced to the UI (never the tokens themselves). */
export interface OAuthAccount {
  email?: string
  /** e.g. "Claude Pro", "Claude Max", "ChatGPT Plus" */
  plan?: string
  organization?: string
}

/** Duplicate upstream API-key metadata, derived in main (the renderer never sees the raw key). */
export interface SameApiKeyInfo {
  duplicated: boolean
  groupSize: number
  /** whether this duplicate group has opted into the special same-key mode */
  modeEnabled: boolean
  /** within an enabled duplicate group, whether THIS credential's toggle is the active one */
  active: boolean
}

/**
 * The renderer-facing view of a credential. NEVER carries the raw secret (API key or OAuth
 * tokens) — only a masked preview and, for OAuth, the account/expiry metadata. The secret-bearing
 * record lives only in the main process (see main/services/store.ts → StoredCredential).
 */
export interface CredentialView {
  id: Id
  name: string
  provider: Provider
  kind: CredentialKind
  /** upstream base URL (e.g. https://api.openai.com/v1 or https://api.anthropic.com) */
  baseUrl: string
  /** apikey only: masked preview like "sk-…AB12" */
  keyPreview?: string
  /** apikey only: duplicate-key metadata, derived from the exact raw key in main */
  sameApiKey?: SameApiKeyInfo
  /** oauth only */
  account?: OAuthAccount
  /** oauth only: access-token expiry (epoch ms); compared to now for the 有效/过期 badge */
  expiresAt?: number
  /** oauth only: granted scopes */
  scopes?: string[]
  /** master switch — when false, ALL of this credential's API keys are refused (403) */
  enabled: boolean
  createdAt: number
  updatedAt: number
  order: number
  lastTest?: TestResult
}

/** Payload to create an API-key credential (the OAuth path goes through oauth.* commands). */
export interface NewApiKeyCredential {
  provider: Provider
  name: string
  baseUrl: string
  apiKey: string
}

/** A not-yet-saved API-key credential, used to test connectivity before adding. */
export type ApiKeyDraft = NewApiKeyCredential

/** Default upstream base URLs per provider, offered as the placeholder/initial value. */
export const DEFAULT_BASE_URL: Record<Provider, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com'
}
