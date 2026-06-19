export type Id = string

/** The two API "shapes" API-YES understands. The proxy is format-preserving: an OpenAI
 *  credential exposes an OpenAI-format endpoint, an Anthropic one an Anthropic-format endpoint. */
export type Provider = 'openai' | 'anthropic'

/** How a credential authenticates upstream. */
export type CredentialKind = 'oauth' | 'apikey'

/** Result of a connectivity / auth test against the upstream. */
export interface TestResult {
  ok: boolean
  /** epoch ms the test ran */
  at: number
  /** human-friendly summary (success detail or the error) */
  message: string
  /** optional HTTP status the upstream returned */
  status?: number
}

/** One model as reported by the upstream `/models` (or `/v1/models`) endpoint. */
export interface ModelInfo {
  id: string
  /** OpenAI: "owned_by"; Anthropic: "display_name" — whichever the provider gives. */
  label?: string
  /** epoch seconds, if the provider reports a creation date */
  created?: number
}

export const PROVIDER_LABEL: Record<Provider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic'
}
