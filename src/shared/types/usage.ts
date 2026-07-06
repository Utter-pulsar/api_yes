import type { Provider } from './common'

/**
 * One rate-limit / quota window of a subscription (OAuth) credential — e.g. the rolling 5-hour
 * window, the weekly window, or a model-family-specific weekly window. The renderer renders each
 * as a progress bar + percentage; it maps the stable `key` to a localized label (see i18n
 * `usage.win.*`) so the panel stays fully bilingual without the main process knowing the language.
 */
export interface UsageWindow {
  /**
   * Stable identifier the renderer maps to a localized label. Known keys:
   *   '5h' | 'weekly' | 'weekly_opus' | 'weekly_sonnet'
   * An unknown key falls back to `label` (then to the key itself).
   */
  key: string
  /** Optional already-resolved fallback label, used only when `key` is not a known one. */
  label?: string
  /** 0..100, clamped — the percent of this window consumed. The bar + the "%" both read this. */
  percent: number
  /** Raw consumed amount, when the provider reports one (else omit → show only the percent). */
  used?: number
  /** The window's limit/allowance, in the same unit as `used`. */
  limit?: number
  /** Unit of `used`/`limit` for display: 'tokens' | 'requests' | 'credits'. */
  unit?: string
  /** Epoch ms when the window resets, when known. */
  resetsAt?: number
}

/**
 * A subscription usage/quota snapshot for an OAuth credential, returned by `credentials.usage`.
 * Only meaningful for `kind === 'oauth'`; API-key credentials have no subscription windows.
 */
export interface UsageReport {
  ok: boolean
  provider: Provider
  /** Epoch ms the snapshot was taken. */
  at: number
  /** The windows we could read; empty on failure or when the provider exposes none. */
  windows: UsageWindow[]
  /** Human-friendly note: the error on failure, or a hint (e.g. "based on the last request"). */
  message?: string
}

// ── long-term daily usage history (per credential / per proxy endpoint) ─────────────────────────

/**
 * Pseudo-model key for requests whose upstream response carried no model id. Kept parenthesised so
 * it can never collide with a real model id; the renderer maps it to a localized label.
 */
export const UNKNOWN_MODEL_KEY = '(unknown)'

/**
 * Pseudo-model key for usage accumulated by app versions BEFORE the daily ledger existed and not
 * attributable to a specific model (the endpoint's lifetime counters minus its byModel breakdown).
 * Seeded once, on first launch after upgrading. Localized by the renderer like UNKNOWN_MODEL_KEY.
 */
export const LEGACY_MODEL_KEY = '(legacy)'

/** One local day's consumption of one model, accumulated request-by-request as the proxy bills. */
export interface DailyModelUsage {
  requests: number
  inputTokens: number
  outputTokens: number
}

/**
 * The permanent daily ledger for one scope (a credential or a proxy endpoint):
 * local-time day 'YYYY-MM-DD' → model id → that day's usage. Only models actually used on a day
 * appear, and entries survive model-list changes — the history is what happened, not what the
 * upstream currently offers.
 */
export type UsageHistoryDays = Record<string, Record<string, DailyModelUsage>>

/** Lifetime sums of one ledger, shown as a child entry's numbers in a parent's breakdown list. */
export interface UsageTotals {
  requests: number
  inputTokens: number
  outputTokens: number
}

/**
 * Pseudo-id for the synthetic "unattributed surplus" child entry in a breakdown list: usage a
 * parent level accumulated that can no longer be attributed to a named child (pre-tree app
 * versions). Parenthesised so it can never collide with a real credential/proxy id.
 */
export const LEGACY_ENTRY_KEY = '(legacy)'

// ── the persisted history tree: app → credentials → api keys ────────────────────────────────────
//
// Totals at each level are DERIVED: a credential's ledger = its legacyDays + Σ its proxy nodes,
// the app ledger = its legacyDays + Σ credential nodes. Deleting an ENTITY (credential / api key)
// only tombstones its node (`deleted: true`) — every ancestor total is unchanged. Only purging a
// node from its parent's breakdown list (usage.history.deleteEntry) removes its contribution,
// which then shrinks every ancestor consistently.

/** api-key (proxy endpoint) leaf node — the only level whose days are stored, not derived. */
export interface ProxyHistoryNode {
  /** last-known display name (kept for tombstoned entries) */
  name: string
  /** true once the api-key entity was deleted; the record lives on as a historical entry */
  deleted: boolean
  days: UsageHistoryDays
}

export interface CredentialHistoryNode {
  name: string
  deleted: boolean
  /** unattributed usage: pre-upgrade surplus of the old credential ledger over Σ its api keys */
  legacyDays: UsageHistoryDays
  proxies: Record<string, ProxyHistoryNode>
}

export interface UsageHistoryTree {
  /** unattributed app-level usage (orphaned pre-upgrade ledgers) */
  legacyDays: UsageHistoryDays
  credentials: Record<string, CredentialHistoryNode>
}

export function emptyUsageHistoryTree(): UsageHistoryTree {
  return { legacyDays: {}, credentials: {} }
}

/**
 * The persisted shape BEFORE the history tree (≤ v0.0.7): two flat ledger maps. Read once by the
 * store's migration and folded into a UsageHistoryTree; never written again.
 */
export interface UsageHistoryStore {
  credentials: Record<string, UsageHistoryDays>
  proxies: Record<string, UsageHistoryDays>
}

// ── what the `usage.history` query returns ──────────────────────────────────────────────────────

/** One row of a parent scope's breakdown list (its lower-level records, live + historical). */
export interface UsageHistoryChildEntry {
  /** credential/proxy id, or LEGACY_ENTRY_KEY for the synthetic surplus row */
  id: string
  name: string
  /** entity is gone — render as a historical entry */
  deleted: boolean
  /** the synthetic unattributed-surplus row: not drillable, renderer supplies its label */
  legacy?: boolean
  totals: UsageTotals
}

/** Everything the `usage.history` query returns for one scope. */
export interface UsageHistoryReport {
  /** the (derived) per-day per-model ledger of the requested scope */
  days: UsageHistoryDays
  /** app scope → credential entries; credential scope → api-key entries; proxy scope → omitted */
  children?: UsageHistoryChildEntry[]
}
