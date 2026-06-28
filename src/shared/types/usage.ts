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
