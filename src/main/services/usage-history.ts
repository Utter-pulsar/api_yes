import type { DailyModelUsage, Id, UsageHistoryDays } from '@shared/types'
import { LEGACY_MODEL_KEY, UNKNOWN_MODEL_KEY } from '@shared/types'
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

/** Sum one scope's ledger: per-model lifetime totals + the grand total (own keys only). */
function ledgerSums(days: UsageHistoryDays | undefined): {
  perModel: Map<string, DailyModelUsage>
  total: DailyModelUsage
} {
  const perModel = new Map<string, DailyModelUsage>()
  const total: DailyModelUsage = { requests: 0, inputTokens: 0, outputTokens: 0 }
  for (const dayRec of Object.values(days ?? {})) {
    for (const model of Object.keys(dayRec)) {
      const u = Object.getOwnPropertyDescriptor(dayRec, model)?.value as DailyModelUsage | undefined
      if (!u) continue
      const m = perModel.get(model) ?? { requests: 0, inputTokens: 0, outputTokens: 0 }
      m.requests += u.requests || 0
      m.inputTokens += u.inputTokens || 0
      m.outputTokens += u.outputTokens || 0
      perModel.set(model, m)
      total.requests += u.requests || 0
      total.inputTokens += u.inputTokens || 0
      total.outputTokens += u.outputTokens || 0
    }
  }
  return { perModel, total }
}

/**
 * Boot-time self-healing: fold into the daily ledgers any usage the lifetime counters hold that
 * the ledgers don't — usage from app versions before the ledger existed, and tokens billed on a
 * stream the app was killed in the middle of (counters bill per-delta; the ledger writes once at
 * request end). Per endpoint: the deficit of each `byModel` entry is seeded under its REAL model
 * name, the remaining unattributable deficit under LEGACY_MODEL_KEY, dated to the endpoint's
 * last-used local day (or today). Idempotent — once the ledger covers the counters every deficit
 * clamps to zero; after a usage reset the counters sit BELOW the ledger and nothing is seeded.
 * Returns true if anything was written (caller should persist).
 */
export function reconcileHistoryWithCounters(db: Database): boolean {
  let seeded = false
  for (const p of db.proxies) {
    const u = p.usage
    if (!u) continue
    const sums = ledgerSums(db.usageHistory.proxies[p.id])
    const entries: Array<[string, DailyModelUsage]> = []
    const attributed = { requests: 0, inputTokens: 0, outputTokens: 0 }
    for (const [model, m] of Object.entries(u.byModel ?? {})) {
      const have = sums.perModel.get(model)
      const d: DailyModelUsage = {
        requests: Math.max(0, (m.requests || 0) - (have?.requests ?? 0)),
        inputTokens: Math.max(0, (m.inputTokens || 0) - (have?.inputTokens ?? 0)),
        outputTokens: Math.max(0, (m.outputTokens || 0) - (have?.outputTokens ?? 0))
      }
      if (d.requests + d.inputTokens + d.outputTokens === 0) continue
      entries.push([model, d])
      attributed.requests += d.requests
      attributed.inputTokens += d.inputTokens
      attributed.outputTokens += d.outputTokens
    }
    const rest: DailyModelUsage = {
      requests: Math.max(0, (u.requests || 0) - sums.total.requests - attributed.requests),
      inputTokens: Math.max(0, (u.inputTokens || 0) - sums.total.inputTokens - attributed.inputTokens),
      outputTokens: Math.max(0, (u.outputTokens || 0) - sums.total.outputTokens - attributed.outputTokens)
    }
    if (rest.requests + rest.inputTokens + rest.outputTokens > 0) entries.push([LEGACY_MODEL_KEY, rest])
    if (entries.length === 0) continue

    seeded = true
    const day = dayKey(u.lastUsedAt ? new Date(u.lastUsedAt) : new Date())
    for (const [ledger, id] of [
      [db.usageHistory.proxies, p.id],
      [db.usageHistory.credentials, p.credentialId]
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
  return seeded
}

export function registerUsageHistoryService(core: AppCore): void {
  core.queries.register('usage.history', ({ scope, id }) => {
    const ledgers =
      scope === 'credential' ? core.store.data.usageHistory.credentials : core.store.data.usageHistory.proxies
    return { days: ledgers[id] ?? {} }
  })
}
