import type { DailyModelUsage, Id } from '@shared/types'
import { UNKNOWN_MODEL_KEY } from '@shared/types'
import type { AppCore } from './context'
import type { Database } from './store'

/** Local-time day key 'YYYY-MM-DD' — the calendar the user sees, not UTC. */
export function dayKey(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * Get-or-create the per-model counter as an OWN data property. Model ids come from upstream
 * response bodies, so a key like "__proto__"/"constructor" must never walk (or, via `??=`,
 * write through to) Object.prototype — defineProperty pins it as a plain own property.
 */
export function usageBucket(obj: Record<string, DailyModelUsage>, key: string): DailyModelUsage {
  if (Object.hasOwn(obj, key)) return obj[key]
  const rec: DailyModelUsage = { requests: 0, inputTokens: 0, outputTokens: 0 }
  Object.defineProperty(obj, key, { value: rec, writable: true, enumerable: true, configurable: true })
  return rec
}

/**
 * Fold one settled request into the permanent daily ledgers — once under the proxy endpoint and
 * once under its credential, so both scopes can replay "which models, how many tokens, which day"
 * forever, independent of the endpoint's resettable counters. Called from the proxy's billRequest
 * (inside a store.mutate), i.e. exactly once per request that produced parseable usage.
 */
export function recordDailyUsage(
  db: Database,
  credentialId: Id,
  proxyId: Id,
  model: string | undefined,
  totals: { inputTokens: number; outputTokens: number }
): void {
  const day = dayKey()
  const modelKey = model?.trim() || UNKNOWN_MODEL_KEY
  for (const [ledger, id] of [
    [db.usageHistory.credentials, credentialId],
    [db.usageHistory.proxies, proxyId]
  ] as const) {
    const days = (ledger[id] ??= {})
    const rec = usageBucket((days[day] ??= {}), modelKey)
    rec.requests += 1
    rec.inputTokens += totals.inputTokens
    rec.outputTokens += totals.outputTokens
  }
}

export function registerUsageHistoryService(core: AppCore): void {
  core.queries.register('usage.history', ({ scope, id }) => {
    const ledgers =
      scope === 'credential' ? core.store.data.usageHistory.credentials : core.store.data.usageHistory.proxies
    return { days: ledgers[id] ?? {} }
  })
}
