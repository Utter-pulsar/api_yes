import type {
  AppSettings,
  CredentialView,
  Id,
  ModelInfo,
  NewApiKeyCredential,
  ApiKeyDraft,
  Provider,
  ProxyEndpoint,
  ProxyServerStatus,
  ProxyUsage,
  TestResult,
  UsageHistoryReport,
  UsageReport
} from '../types'

// ===========================================================================
// The complete API surface of API-YES.
//   QueryMap   — reads (no side effects)
//   CommandMap — writes / actions (may emit events)
//   EventMap   — pushes from main -> renderer
// ===========================================================================

export type QueryMap = {
  'app.info': { input: void; result: { name: string; version: string; author: string } }
  'settings.get': { input: void; result: AppSettings }
  'window.isMaximized': { input: void; result: boolean }

  'credentials.list': { input: void; result: CredentialView[] }
  'credentials.get': { input: { id: Id }; result: CredentialView | null }

  'proxies.list': { input: { credentialId?: Id }; result: ProxyEndpoint[] }

  'proxy.status': { input: void; result: ProxyServerStatus }

  /**
   * The permanent per-day, per-model token ledger of one scope, plus (for app/credential scopes)
   * the breakdown list of its lower-level records — live and historical (tombstoned) alike.
   */
  'usage.history': {
    input: { scope: 'app' } | { scope: 'credential' | 'proxy'; id: Id }
    result: UsageHistoryReport
  }
}

/** Self-update progress, pushed main → renderer as `update.status`. */
export type UpdateStatus =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'downloading'; percent: number; version?: string }
  | { phase: 'none' }
  | { phase: 'installing'; version: string }
  | { phase: 'error'; message: string }

/** OAuth sign-in progress, pushed main → renderer as `oauth.status`, keyed by session. */
export type OAuthStatus =
  | { sessionId: string; phase: 'waiting'; message?: string }
  | { sessionId: string; phase: 'exchanging' }
  | { sessionId: string; phase: 'success'; credentialId: Id }
  | { sessionId: string; phase: 'error'; message: string }
  | { sessionId: string; phase: 'cancelled' }

/** What an oauth.begin returns so the renderer can show the link / pick its UI. */
export interface OAuthBegin {
  sessionId: string
  /** the full provider authorize URL (also opened in the system browser by main) */
  authUrl: string
  /** 'loopback' = main captures the redirect automatically; 'paste' = user pastes the code back */
  mode: 'loopback' | 'paste'
}

export type CommandMap = {
  // ---- window controls (frameless on Win/Linux) ----
  'window.minimize': { input: void; result: void }
  'window.toggleMaximize': { input: void; result: void }
  'window.close': { input: void; result: void }

  // ---- settings ----
  'settings.update': { input: { patch: Partial<AppSettings> }; result: AppSettings }

  // ---- self-update ----
  'update.check': { input: void; result: void }

  // ---- credentials (API-key path) ----
  'credentials.createApiKey': { input: NewApiKeyCredential; result: CredentialView }
  'credentials.update': {
    input: { id: Id; patch: { name?: string; baseUrl?: string; apiKey?: string; enabled?: boolean } }
    result: CredentialView
  }
  'credentials.delete': { input: { id: Id }; result: void }
  'credentials.reorder': { input: { orderedIds: Id[] }; result: void }
  'credentials.setSameApiKeyMode': { input: { id: Id; enabled: boolean }; result: CredentialView }
  'credentials.setSameApiKeyActive': { input: { id: Id; active: boolean }; result: CredentialView }
  /** test an EXISTING credential's upstream auth */
  'credentials.test': { input: { id: Id }; result: TestResult }
  /** test a not-yet-saved API-key draft, before adding */
  'credentials.testDraft': { input: { draft: ApiKeyDraft }; result: TestResult }
  /** fetch the upstream model list for an existing credential */
  'credentials.listModels': {
    input: { id: Id }
    result: { ok: boolean; models: ModelInfo[]; message: string }
  }
  /** read subscription usage/quota windows for an OAuth credential (5h / weekly / …) */
  'credentials.usage': { input: { id: Id }; result: UsageReport }

  // ---- OAuth sign-in ----
  'oauth.begin': { input: { provider: Provider; name?: string }; result: OAuthBegin }
  /** paste-mode only: hand the pasted authorization code back to finish the exchange */
  'oauth.submitCode': { input: { sessionId: string; code: string }; result: TestResult }
  'oauth.cancel': { input: { sessionId: string }; result: void }
  /** open an arbitrary url in the system browser (for the manual "open link" affordance) */
  'shell.openExternal': { input: { url: string }; result: void }

  // ---- proxy endpoints ----
  'proxies.create': { input: { credentialId: Id; name?: string; key?: string }; result: ProxyEndpoint }
  'proxies.update': {
    input: {
      id: Id
      patch: { name?: string; key?: string; enabled?: boolean; localOnly?: boolean; limitTotalTokens?: number }
    }
    result: ProxyEndpoint
  }
  'proxies.delete': { input: { id: Id }; result: void }
  'proxies.setSameKeyMode': { input: { id: Id; enabled: boolean }; result: ProxyEndpoint }
  'proxies.setSameKeyActive': { input: { id: Id; active: boolean }; result: ProxyEndpoint }
  'proxies.regenerateKey': { input: { id: Id }; result: ProxyEndpoint }
  'proxies.resetUsage': { input: { id: Id }; result: ProxyEndpoint }
  /** generate a fresh provider-styled key WITHOUT saving (for the create form's "骰子") */
  'proxies.suggestKey': { input: { credentialId: Id }; result: { key: string } }

  // ---- usage history tree (permanent ledger management) ----
  /**
   * Purge one record from a parent's breakdown list. Unlike deleting the entity (which only
   * tombstones the record), this removes its contribution — every ancestor total shrinks.
   */
  'usage.history.deleteEntry': {
    input:
      | { kind: 'credential'; credentialId: Id }
      | { kind: 'proxy'; credentialId: Id; proxyId: Id }
      /** clear an unattributed-surplus bucket; app-level one when credentialId is omitted */
      | { kind: 'legacy'; credentialId?: Id }
    result: void
  }
  /** rename a historical (tombstoned) entry's display name */
  'usage.history.renameEntry': { input: { credentialId: Id; proxyId?: Id; name: string }; result: void }

  // ---- the local reverse-proxy server ----
  'proxy.start': { input: void; result: ProxyServerStatus }
  'proxy.stop': { input: void; result: ProxyServerStatus }
  'proxy.restart': { input: void; result: ProxyServerStatus }
  /** copy text to the clipboard from the renderer (keys etc.) */
  'clipboard.write': { input: { text: string }; result: void }
}

export type EventMap = {
  'credentials.changed': CredentialView[]
  'proxies.changed': ProxyEndpoint[]
  'settings.changed': AppSettings
  /** live usage tick for a single endpoint as a request completes */
  'proxy.usage': { proxyId: Id; usage: ProxyUsage }
  'proxy.status': ProxyServerStatus
  'oauth.status': OAuthStatus
  'update.status': UpdateStatus
  'window.maximized': boolean
  'toast': { kind: 'info' | 'success' | 'error'; message: string }
}

export type QueryName = keyof QueryMap
export type CommandName = keyof CommandMap
export type EventName = keyof EventMap

/** The object exposed on `window.api` by the preload script. */
export interface ApiYesApi {
  query<K extends QueryName>(name: K, input: QueryMap[K]['input']): Promise<QueryMap[K]['result']>
  command<K extends CommandName>(
    name: K,
    input: CommandMap[K]['input']
  ): Promise<CommandMap[K]['result']>
  on<K extends EventName>(name: K, cb: (payload: EventMap[K]) => void): () => void
  onAny(cb: (name: EventName, payload: unknown) => void): () => void
}
