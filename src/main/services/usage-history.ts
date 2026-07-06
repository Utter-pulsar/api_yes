import type {
  CredentialHistoryNode,
  DailyModelUsage,
  Id,
  ProxyHistoryNode,
  UsageHistoryChildEntry,
  UsageHistoryDays,
  UsageHistoryStore,
  UsageHistoryTree,
  UsageTotals
} from '@shared/types'
import {
  LEGACY_ENTRY_KEY,
  LEGACY_MODEL_KEY,
  UNKNOWN_MODEL_KEY,
  emptyUsage,
  emptyUsageHistoryTree
} from '@shared/types'
import type { AppCore } from './context'
import type { Database } from './store'

/** Local-time day key 'YYYY-MM-DD' — the calendar the user sees, not UTC. */
export function dayKey(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// ── prototype-pollution-safe map access ─────────────────────────────────────────────────────────
// Model ids come from upstream response bodies and entity ids arrive over IPC, so keys like
// "__proto__"/"constructor" must never walk (or, via `??=`, write through to) Object.prototype.
// All tree maps (nodes, day maps, model buckets) go through these own-property helpers.

function getOwn<T>(obj: Record<string, T>, key: string): T | undefined {
  return Object.getOwnPropertyDescriptor(obj, key)?.value as T | undefined
}

function setOwn<T>(obj: Record<string, T>, key: string, value: T): T {
  Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true })
  return value
}

function getOrCreateOwn<T>(obj: Record<string, T>, key: string, make: () => T): T {
  return getOwn(obj, key) ?? setOwn(obj, key, make())
}

function deleteOwn<T>(obj: Record<string, T>, key: string): void {
  if (Object.hasOwn(obj, key)) delete obj[key]
}

/** Get-or-create the per-model counter as an OWN data property (see helpers above). */
export function usageBucket(obj: Record<string, DailyModelUsage>, key: string): DailyModelUsage {
  return getOrCreateOwn(obj, key, () => ({ requests: 0, inputTokens: 0, outputTokens: 0 }))
}

/** Sanitize an externally-sourced counter: non-negative finite number, else 0. */
function nn(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
}

function hasDays(days: UsageHistoryDays): boolean {
  return Object.keys(days).length > 0
}

// ── pure ledger arithmetic (plain objects in, plain objects out) ─────────────────────────────────

/** Fold every (day, model) record of `src` into `target`, sanitized; all-zero records are skipped. */
export function sumDaysInto(target: UsageHistoryDays, src: UsageHistoryDays): void {
  for (const day of Object.keys(src)) {
    const dayRec = getOwn(src, day)
    if (!dayRec) continue
    for (const model of Object.keys(dayRec)) {
      const u = getOwn(dayRec, model)
      if (!u) continue
      const requests = nn(u.requests)
      const inputTokens = nn(u.inputTokens)
      const outputTokens = nn(u.outputTokens)
      if (requests + inputTokens + outputTokens === 0) continue
      const b = usageBucket(getOrCreateOwn(target, day, () => ({})), model)
      b.requests += requests
      b.inputTokens += inputTokens
      b.outputTokens += outputTokens
    }
  }
}

/** Per (day, model): max(0, a − b). Records that clamp to all-zero are dropped. */
function subtractDaysClamped(a: UsageHistoryDays, b: UsageHistoryDays): UsageHistoryDays {
  const out: UsageHistoryDays = {}
  for (const day of Object.keys(a)) {
    const dayA = getOwn(a, day)
    if (!dayA) continue
    const dayB = getOwn(b, day)
    for (const model of Object.keys(dayA)) {
      const ua = getOwn(dayA, model)
      if (!ua) continue
      const ub = dayB ? getOwn(dayB, model) : undefined
      const d: DailyModelUsage = {
        requests: Math.max(0, nn(ua.requests) - nn(ub?.requests)),
        inputTokens: Math.max(0, nn(ua.inputTokens) - nn(ub?.inputTokens)),
        outputTokens: Math.max(0, nn(ua.outputTokens) - nn(ub?.outputTokens))
      }
      if (d.requests + d.inputTokens + d.outputTokens === 0) continue
      setOwn(getOrCreateOwn(out, day, () => ({})), model, d)
    }
  }
  return out
}

/** A credential's ledger is DERIVED: its unattributed legacyDays + Σ its api-key leaves. */
export function deriveCredentialDays(node: CredentialHistoryNode): UsageHistoryDays {
  const out: UsageHistoryDays = {}
  sumDaysInto(out, node.legacyDays)
  for (const id of Object.keys(node.proxies)) {
    const leaf = getOwn(node.proxies, id)
    if (leaf) sumDaysInto(out, leaf.days)
  }
  return out
}

/** The app ledger is DERIVED: its unattributed legacyDays + Σ every credential node. */
export function deriveAppDays(tree: UsageHistoryTree): UsageHistoryDays {
  const out: UsageHistoryDays = {}
  sumDaysInto(out, tree.legacyDays)
  for (const id of Object.keys(tree.credentials)) {
    const node = getOwn(tree.credentials, id)
    if (!node) continue
    sumDaysInto(out, node.legacyDays)
    for (const pid of Object.keys(node.proxies)) {
      const leaf = getOwn(node.proxies, pid)
      if (leaf) sumDaysInto(out, leaf.days)
    }
  }
  return out
}

/** Lifetime sums of one ledger — a child entry's numbers in a parent's breakdown list. */
export function totalsOf(days: UsageHistoryDays): UsageTotals {
  const { total } = ledgerSums(days)
  return { requests: total.requests, inputTokens: total.inputTokens, outputTokens: total.outputTokens }
}

// ── tree node access (shared with credential-service / proxy-service for tombstoning) ───────────

/** Own-property read of a credential node — never walks Object.prototype for a hostile id. */
export function getCredentialNode(tree: UsageHistoryTree, credentialId: Id): CredentialHistoryNode | undefined {
  return getOwn(tree.credentials, credentialId)
}

/** Own-property read of an api-key leaf under its credential node. */
export function getProxyLeaf(tree: UsageHistoryTree, credentialId: Id, proxyId: Id): ProxyHistoryNode | undefined {
  const node = getOwn(tree.credentials, credentialId)
  return node ? getOwn(node.proxies, proxyId) : undefined
}

/**
 * Get-or-create the credential node and its api-key leaf, refreshing both names from the live
 * entities so a later tombstone carries the freshest display name.
 */
function ensureLeaf(db: Database, credentialId: Id, proxyId: Id): ProxyHistoryNode {
  const cred = db.credentials.find((c) => c.id === credentialId)
  const node = getOrCreateOwn(db.usageHistory.credentials, credentialId, () => ({
    name: cred?.name ?? credentialId,
    deleted: false,
    legacyDays: {},
    proxies: {}
  }))
  if (cred) node.name = cred.name
  const proxy = db.proxies.find((p) => p.id === proxyId)
  const leaf = getOrCreateOwn(node.proxies, proxyId, () => ({
    name: proxy?.name ?? proxyId,
    deleted: false,
    days: {}
  }))
  if (proxy) leaf.name = proxy.name
  return leaf
}

// ── the one-time upgrade from the flat pre-tree shape ────────────────────────────────────────────

/** The slice of the persisted DB the migration needs (structural, so store.ts can pass raw JSON). */
export interface LegacyHistorySource {
  credentials?: Array<{ id: Id; name: string }>
  proxies?: Array<{ id: Id; credentialId: Id; name: string }>
  usageHistory?: UsageHistoryStore
}

/**
 * Fold the flat ≤ v0.0.7 ledgers into the hierarchy tree. Pure; the invariant is that no usage is
 * lost and no total shrinks:
 *   • each live proxy's old ledger becomes its leaf's days;
 *   • orphaned proxy ledgers (entity already gone — the old shape kept no owner) → app legacyDays;
 *   • per credential, the old credential ledger's surplus over Σ its (migrated) leaves — usage the
 *     flat shape could no longer attribute to a specific key — lands in that node's legacyDays;
 *   • orphaned credential ledgers → app legacyDays.
 */
export function migrateLegacyHistory(raw: LegacyHistorySource): UsageHistoryTree {
  const tree = emptyUsageHistoryTree()
  const oldCredLedgers = raw.usageHistory?.credentials ?? {}
  const oldProxyLedgers = raw.usageHistory?.proxies ?? {}

  for (const c of raw.credentials ?? []) {
    setOwn(tree.credentials, c.id, { name: c.name, deleted: false, legacyDays: {}, proxies: {} })
  }

  const liveProxyIds = new Set<string>()
  for (const p of raw.proxies ?? []) {
    liveProxyIds.add(p.id)
    // fallback node named by id: a proxy whose credential entity is somehow already gone
    const node = getOrCreateOwn(tree.credentials, p.credentialId, () => ({
      name: p.credentialId,
      deleted: false,
      legacyDays: {},
      proxies: {}
    }))
    const days: UsageHistoryDays = {}
    sumDaysInto(days, getOwn(oldProxyLedgers, p.id) ?? {})
    setOwn(node.proxies, p.id, { name: p.name, deleted: false, days })
  }

  for (const id of Object.keys(oldProxyLedgers)) {
    if (liveProxyIds.has(id)) continue
    sumDaysInto(tree.legacyDays, getOwn(oldProxyLedgers, id) ?? {})
  }

  for (const id of Object.keys(oldCredLedgers)) {
    const ledger = getOwn(oldCredLedgers, id) ?? {}
    const node = getOwn(tree.credentials, id)
    if (!node) {
      sumDaysInto(tree.legacyDays, ledger)
      continue
    }
    const attributed: UsageHistoryDays = {}
    for (const pid of Object.keys(node.proxies)) {
      const leaf = getOwn(node.proxies, pid)
      if (leaf) sumDaysInto(attributed, leaf.days)
    }
    node.legacyDays = subtractDaysClamped(ledger, attributed)
  }

  return tree
}

// ── write paths ──────────────────────────────────────────────────────────────────────────────────

/**
 * Fold one settled request into the permanent daily ledger. Only the api-key LEAF stores days —
 * the credential and app levels are derived at read time, so a single write covers every scope.
 * Called from the proxy's billRequest (inside a store.mutate), i.e. exactly once per request that
 * produced parseable usage.
 */
export function recordDailyUsage(
  db: Database,
  credentialId: Id,
  proxyId: Id,
  model: string | undefined,
  totals: { inputTokens: number; outputTokens: number }
): void {
  const modelKey = model?.trim() || UNKNOWN_MODEL_KEY
  const leaf = ensureLeaf(db, credentialId, proxyId)
  const rec = usageBucket(getOrCreateOwn(leaf.days, dayKey(), () => ({})), modelKey)
  rec.requests += 1
  rec.inputTokens += nn(totals.inputTokens)
  rec.outputTokens += nn(totals.outputTokens)
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
      const u = getOwn(dayRec, model)
      if (!u) continue
      const m = perModel.get(model) ?? { requests: 0, inputTokens: 0, outputTokens: 0 }
      m.requests += nn(u.requests)
      m.inputTokens += nn(u.inputTokens)
      m.outputTokens += nn(u.outputTokens)
      perModel.set(model, m)
      total.requests += nn(u.requests)
      total.inputTokens += nn(u.inputTokens)
      total.outputTokens += nn(u.outputTokens)
    }
  }
  return { perModel, total }
}

/**
 * Boot-time self-healing: fold into the daily ledger any usage the lifetime counters hold that
 * the ledger doesn't — usage from app versions before the ledger existed, and tokens billed on a
 * stream the app was killed in the middle of (counters bill per-delta; the ledger writes once at
 * request end). Per live endpoint: the deficit of each `byModel` entry is seeded under its REAL
 * model name, the remaining unattributable deficit under LEGACY_MODEL_KEY, dated to the endpoint's
 * last-used local day (or today). Seeds ONLY the api-key leaf — the derived levels follow for
 * free. Idempotent — once the ledger covers the counters every deficit clamps to zero; after a
 * usage reset the counters sit BELOW the ledger and nothing is seeded.
 * Returns true if anything was written (caller should persist).
 */
export function reconcileHistoryWithCounters(db: Database): boolean {
  let seeded = false
  for (const p of db.proxies) {
    const u = p.usage
    if (!u) continue
    const sums = ledgerSums(getProxyLeaf(db.usageHistory, p.credentialId, p.id)?.days)
    const entries: Array<[string, DailyModelUsage]> = []
    const attributed = { requests: 0, inputTokens: 0, outputTokens: 0 }
    for (const [model, m] of Object.entries(u.byModel ?? {})) {
      const have = sums.perModel.get(model)
      const d: DailyModelUsage = {
        requests: Math.max(0, nn(m.requests) - (have?.requests ?? 0)),
        inputTokens: Math.max(0, nn(m.inputTokens) - (have?.inputTokens ?? 0)),
        outputTokens: Math.max(0, nn(m.outputTokens) - (have?.outputTokens ?? 0))
      }
      if (d.requests + d.inputTokens + d.outputTokens === 0) continue
      entries.push([model, d])
      attributed.requests += d.requests
      attributed.inputTokens += d.inputTokens
      attributed.outputTokens += d.outputTokens
    }
    const rest: DailyModelUsage = {
      requests: Math.max(0, nn(u.requests) - sums.total.requests - attributed.requests),
      inputTokens: Math.max(0, nn(u.inputTokens) - sums.total.inputTokens - attributed.inputTokens),
      outputTokens: Math.max(0, nn(u.outputTokens) - sums.total.outputTokens - attributed.outputTokens)
    }
    if (rest.requests + rest.inputTokens + rest.outputTokens > 0) entries.push([LEGACY_MODEL_KEY, rest])
    if (entries.length === 0) continue

    seeded = true
    const leaf = ensureLeaf(db, p.credentialId, p.id)
    const dayRec = getOrCreateOwn(leaf.days, dayKey(u.lastUsedAt ? new Date(u.lastUsedAt) : new Date()), () => ({}))
    for (const [model, rec] of entries) {
      const b = usageBucket(dayRec, model) // byModel keys are upstream-controlled too
      b.requests += rec.requests
      b.inputTokens += rec.inputTokens
      b.outputTokens += rec.outputTokens
    }
  }
  return seeded
}

// ── the query / command surface ──────────────────────────────────────────────────────────────────

function legacyEntry(totals: UsageTotals): UsageHistoryChildEntry {
  return { id: LEGACY_ENTRY_KEY, name: '', deleted: false, legacy: true, totals }
}

/** App-scope breakdown: live credentials in db order, then tombstones (name-sorted), legacy last. */
function credentialEntries(db: Database): UsageHistoryChildEntry[] {
  const tree = db.usageHistory
  const entries: UsageHistoryChildEntry[] = []
  const seen = new Set<string>()
  const push = (id: string, node: CredentialHistoryNode): void => {
    entries.push({ id, name: node.name, deleted: node.deleted, totals: totalsOf(deriveCredentialDays(node)) })
  }
  for (const c of db.credentials.slice().sort((a, b) => a.order - b.order)) {
    const node = getOwn(tree.credentials, c.id)
    if (!node) continue
    seen.add(c.id)
    push(c.id, node)
  }
  Object.keys(tree.credentials)
    .filter((id) => !seen.has(id))
    .map((id) => [id, getOwn(tree.credentials, id)] as const)
    .filter((pair): pair is [string, CredentialHistoryNode] => pair[1] !== undefined)
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .forEach(([id, node]) => push(id, node))
  if (hasDays(tree.legacyDays)) entries.push(legacyEntry(totalsOf(tree.legacyDays)))
  return entries
}

/** Credential-scope breakdown: live api keys in db order, then tombstones, legacy surplus last. */
function proxyEntries(db: Database, credentialId: Id, node: CredentialHistoryNode): UsageHistoryChildEntry[] {
  const entries: UsageHistoryChildEntry[] = []
  const seen = new Set<string>()
  const push = (id: string, leaf: ProxyHistoryNode): void => {
    entries.push({ id, name: leaf.name, deleted: leaf.deleted, totals: totalsOf(leaf.days) })
  }
  for (const p of db.proxies.filter((x) => x.credentialId === credentialId).sort((a, b) => a.order - b.order)) {
    const leaf = getOwn(node.proxies, p.id)
    if (!leaf) continue
    seen.add(p.id)
    push(p.id, leaf)
  }
  Object.keys(node.proxies)
    .filter((id) => !seen.has(id))
    .map((id) => [id, getOwn(node.proxies, id)] as const)
    .filter((pair): pair is [string, ProxyHistoryNode] => pair[1] !== undefined)
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .forEach(([id, leaf]) => push(id, leaf))
  if (hasDays(node.legacyDays)) entries.push(legacyEntry(totalsOf(node.legacyDays)))
  return entries
}

export function registerUsageHistoryService(core: AppCore): void {
  core.queries.register('usage.history', (input) => {
    const db = core.store.data
    const tree = db.usageHistory
    if (input.scope === 'app') {
      return { days: deriveAppDays(tree), children: credentialEntries(db) }
    }
    if (input.scope === 'credential') {
      const node = getCredentialNode(tree, input.id)
      if (!node) return { days: {} }
      return { days: deriveCredentialDays(node), children: proxyEntries(db, input.id, node) }
    }
    // proxy scope: the leaf's days verbatim; the owning credential is unknown, so scan for it
    for (const cid of Object.keys(tree.credentials)) {
      const leaf = getProxyLeaf(tree, cid, input.id)
      if (leaf) return { days: leaf.days }
    }
    return { days: {} }
  })

  core.commands.register('usage.history.deleteEntry', (input) => {
    let countersReset = false
    core.store.mutate((db) => {
      const tree = db.usageHistory
      // Purging a record whose ENTITY is still live must also zero that endpoint's lifetime
      // counters (same semantics as proxies.resetUsage): the boot-time reconcile seeds
      // max(0, counters − ledger) into a fresh leaf, so counters left standing would silently
      // resurrect everything the user just deleted on the next launch.
      const resetCounters = (match: (pid: Id, credId: Id) => boolean): void => {
        for (const p of db.proxies) {
          if (match(p.id, p.credentialId)) {
            p.usage = emptyUsage()
            countersReset = true
          }
        }
      }
      if (input.kind === 'credential') {
        deleteOwn(tree.credentials, input.credentialId)
        resetCounters((_pid, credId) => credId === input.credentialId)
        return
      }
      if (input.kind === 'proxy') {
        const node = getCredentialNode(tree, input.credentialId)
        if (node) deleteOwn(node.proxies, input.proxyId)
        resetCounters((pid) => pid === input.proxyId)
        return
      }
      // legacy: clear the unattributed-surplus bucket (app-level when credentialId is omitted);
      // no entity backs it, so there are no counters to touch
      if (input.credentialId === undefined) {
        tree.legacyDays = {}
        return
      }
      const node = getCredentialNode(tree, input.credentialId)
      if (node) node.legacyDays = {}
    })
    // the live usage meters in the API list just went to zero — let the renderer know
    if (countersReset) {
      core.broadcast(
        'proxies.changed',
        core.store.data.proxies.slice().sort((a, b) => a.order - b.order)
      )
    }
  })

  core.commands.register('usage.history.renameEntry', ({ credentialId, proxyId, name }) => {
    const trimmed = name.trim()
    if (!trimmed) return
    core.store.mutate((db) => {
      const node = getCredentialNode(db.usageHistory, credentialId)
      if (!node) return
      if (proxyId === undefined) {
        node.name = trimmed
        return
      }
      const leaf = getOwn(node.proxies, proxyId)
      if (leaf) leaf.name = trimmed
    })
  })
}
