import type { DailyModelUsage, Id, ProxyEndpoint, UsageHistoryStore } from '@shared/types'
import { LEGACY_MODEL_KEY, UNKNOWN_MODEL_KEY, emptyUsageHistory } from '@shared/types'
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

/**
 * One-time upgrade migration: build the daily ledgers from the lifetime counters of endpoints that
 * existed BEFORE the ledger did (data files with no `usageHistory` at all). Old versions already
 * kept a per-model lifetime breakdown (`usage.byModel`), so that part is attributed to its REAL
 * model names; whatever the top-level counters hold beyond the breakdown (requests whose model
 * never arrived) is folded into the LEGACY_MODEL_KEY pseudo-model. Everything is dated to the
 * endpoint's last-used local day — the closest real date the old data carries — or to today.
 */
export function seedHistoryFromCounters(proxies: ProxyEndpoint[]): UsageHistoryStore {
  const store = emptyUsageHistory()
  for (const p of proxies) {
    const u = p.usage
    if (!u) continue
    const total = { requests: u.requests || 0, inputTokens: u.inputTokens || 0, outputTokens: u.outputTokens || 0 }
    if (total.requests + total.inputTokens + total.outputTokens === 0) continue
    const day = dayKey(u.lastUsedAt ? new Date(u.lastUsedAt) : new Date())

    const attributed = { requests: 0, inputTokens: 0, outputTokens: 0 }
    const entries: Array<[string, DailyModelUsage]> = []
    for (const [model, m] of Object.entries(u.byModel ?? {})) {
      const rec = { requests: m.requests || 0, inputTokens: m.inputTokens || 0, outputTokens: m.outputTokens || 0 }
      if (rec.requests + rec.inputTokens + rec.outputTokens === 0) continue
      entries.push([model, rec])
      attributed.requests += rec.requests
      attributed.inputTokens += rec.inputTokens
      attributed.outputTokens += rec.outputTokens
    }
    const rest: DailyModelUsage = {
      requests: Math.max(0, total.requests - attributed.requests),
      inputTokens: Math.max(0, total.inputTokens - attributed.inputTokens),
      outputTokens: Math.max(0, total.outputTokens - attributed.outputTokens)
    }
    if (rest.requests + rest.inputTokens + rest.outputTokens > 0) entries.push([LEGACY_MODEL_KEY, rest])

    for (const [ledger, id] of [
      [store.proxies, p.id],
      [store.credentials, p.credentialId]
    ] as const) {
      const days = (ledger[id] ??= {})
      const dayRec = (days[day] ??= {})
      for (const [model, rec] of entries) {
        const b = usageBucket(dayRec, model) // byModel keys are upstream-controlled too
        b.requests += rec.requests
        b.inputTokens += rec.inputTokens
        b.outputTokens += rec.outputTokens
      }
    }
  }
  return store
}

export function registerUsageHistoryService(core: AppCore): void {
  core.queries.register('usage.history', ({ scope, id }) => {
    const ledgers =
      scope === 'credential' ? core.store.data.usageHistory.credentials : core.store.data.usageHistory.proxies
    return { days: ledgers[id] ?? {} }
  })
}
