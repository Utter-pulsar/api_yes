import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { CredentialView, ProxyEndpoint, ProxyServerStatus } from '@shared/types'
import { api } from '../../lib/bridge'
import { useStore } from '../../store'
import { useT } from '../../lib/i18n'
import { compact, grouped, ago } from '../../lib/format'
import { DoodleButton } from '../../components/doodle/DoodleButton'
import { DoodleToggle } from '../../components/doodle/DoodleToggle'
import { UsageHistoryDialog } from '../usage/UsageHistoryDialog'

interface ProxyOpenUi {
  pinnedIds: string[]
  hoveredId: string | null
  suppressedIds: string[]
}

interface ProxySameKeyInfo {
  duplicated: boolean
  groupSize: number
  modeEnabled: boolean
  active: boolean
}

interface ProxyOpenPrefs {
  globalExpanded: boolean
  byCredential: Record<string, boolean>
}

const EMPTY_UI: ProxyOpenUi = { pinnedIds: [], hoveredId: null, suppressedIds: [] }
const OPEN_PREFS_KEY = 'api-yes-proxy-open-prefs'

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids))
}

function readOpenPrefs(): ProxyOpenPrefs {
  try {
    const raw = localStorage.getItem(OPEN_PREFS_KEY)
    if (!raw) return { globalExpanded: false, byCredential: {} }
    const parsed = JSON.parse(raw) as Partial<ProxyOpenPrefs>
    return {
      globalExpanded: parsed.globalExpanded === true,
      byCredential: parsed.byCredential && typeof parsed.byCredential === 'object' ? parsed.byCredential : {}
    }
  } catch {
    return { globalExpanded: false, byCredential: {} }
  }
}

function writeOpenPrefs(prefs: ProxyOpenPrefs): void {
  localStorage.setItem(OPEN_PREFS_KEY, JSON.stringify(prefs))
}

function buildSameKeyInfoMap(proxies: ProxyEndpoint[]): Map<string, ProxySameKeyInfo> {
  const groups = new Map<string, ProxyEndpoint[]>()
  for (const proxy of proxies) {
    const key = proxy.key.trim()
    if (!key) continue
    const group = groups.get(key)
    if (group) group.push(proxy)
    else groups.set(key, [proxy])
  }

  const result = new Map<string, ProxySameKeyInfo>()
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const modeEnabled = group.some((proxy) => proxy.sameKeyMode === true)
    for (const proxy of group) {
      result.set(proxy.id, {
        duplicated: true,
        groupSize: group.length,
        modeEnabled,
        active: modeEnabled && proxy.sameKeyActive === true
      })
    }
  }
  return result
}

/** The API keys hanging off one credential. Each key has its OWN URL + access scope + usage. */
export function ProxyList({ credential }: { credential: CredentialView }): JSX.Element {
  // select the RAW array (stable reference) and derive here — a selector returning a fresh
  // filtered array each call breaks zustand v5's useSyncExternalStore (infinite re-render).
  const allProxies = useStore((s) => s.proxies)
  const proxies = useMemo(
    () => allProxies.filter((p) => p.credentialId === credential.id).sort((a, b) => a.order - b.order),
    [allProxies, credential.id]
  )
  const status = useStore((s) => s.proxyStatus)
  const toast = useStore((s) => s.toast)
  const askPrompt = useStore((s) => s.askPrompt)
  const askConfirm = useStore((s) => s.askConfirm)
  const t = useT()
  const [creating, setCreating] = useState(false)
  // the endpoint whose usage-history dialog is open. Held HERE (not in the card): the card's
  // .doodle-edge applies a CSS filter, which would become the containing block for the dialog's
  // position:fixed overlay and trap it inside the card.
  const [historyId, setHistoryId] = useState<string | null>(null)
  const historyProxy = proxies.find((p) => p.id === historyId)
  const [uiByCredential, setUiByCredential] = useState<Record<string, ProxyOpenUi>>({})
  const [openPrefs, setOpenPrefs] = useState<ProxyOpenPrefs>(readOpenPrefs)
  const clickTimer = useRef<number | undefined>(undefined)

  const ui = uiByCredential[credential.id] ?? EMPTY_UI
  const patchUi = (updater: (prev: ProxyOpenUi) => ProxyOpenUi): void => {
    setUiByCredential((prev) => ({ ...prev, [credential.id]: updater(prev[credential.id] ?? EMPTY_UI) }))
  }
  const saveOpenPrefs = (updater: (prev: ProxyOpenPrefs) => ProxyOpenPrefs): void => {
    setOpenPrefs((prev) => {
      const next = updater(prev)
      writeOpenPrefs(next)
      return next
    })
  }

  const credentialDefaultExpanded = openPrefs.byCredential[credential.id] ?? openPrefs.globalExpanded

  useEffect(
    () => () => {
      if (clickTimer.current) window.clearTimeout(clickTimer.current)
    },
    []
  )

  useEffect(() => {
    const existing = new Set(proxies.map((p) => p.id))
    setUiByCredential((prev) => {
      const current = prev[credential.id]
      if (!current) {
        return {
          ...prev,
          [credential.id]: {
            pinnedIds: credentialDefaultExpanded ? proxies.map((p) => p.id) : [],
            hoveredId: null,
            suppressedIds: []
          }
        }
      }
      return {
        ...prev,
        [credential.id]: {
          pinnedIds: current.pinnedIds.filter((id) => existing.has(id)),
          hoveredId: current.hoveredId && existing.has(current.hoveredId) ? current.hoveredId : null,
          suppressedIds: current.suppressedIds.filter((id) => existing.has(id))
        }
      }
    })
    if (historyId && !existing.has(historyId)) setHistoryId(null)
  }, [credential.id, credentialDefaultExpanded, historyId, proxies])

  const pinnedSet = useMemo(() => new Set(ui.pinnedIds), [ui.pinnedIds])
  const suppressedSet = useMemo(() => new Set(ui.suppressedIds), [ui.suppressedIds])
  const sameKeyInfoById = useMemo(() => buildSameKeyInfoMap(allProxies), [allProxies])

  const setCurrentDefaultExpanded = (expanded: boolean): void => {
    saveOpenPrefs((prev) => {
      const byCredential = { ...prev.byCredential }
      if (expanded === prev.globalExpanded) delete byCredential[credential.id]
      else byCredential[credential.id] = expanded
      return { ...prev, byCredential }
    })
    setUiByCredential((prev) => ({
      ...prev,
      [credential.id]: {
        pinnedIds: expanded ? proxies.map((p) => p.id) : [],
        hoveredId: null,
        suppressedIds: []
      }
    }))
  }

  const setGlobalDefaultExpanded = (expanded: boolean): void => {
    saveOpenPrefs(() => ({ globalExpanded: expanded, byCredential: {} }))
    const grouped = new Map<string, string[]>()
    for (const proxy of allProxies) {
      const ids = grouped.get(proxy.credentialId)
      if (ids) ids.push(proxy.id)
      else grouped.set(proxy.credentialId, [proxy.id])
    }
    if (!grouped.has(credential.id)) grouped.set(credential.id, [])
    setUiByCredential(
      Object.fromEntries(
        [...grouped.entries()].map(([credentialId, ids]) => [
          credentialId,
          { pinnedIds: expanded ? ids : [], hoveredId: null, suppressedIds: [] }
        ])
      )
    )
  }

  const handleDefaultToggleClick = (): void => {
    if (clickTimer.current) window.clearTimeout(clickTimer.current)
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = undefined
      setCurrentDefaultExpanded(!credentialDefaultExpanded)
    }, 220)
  }

  const handleDefaultToggleDoubleClick = (): void => {
    if (clickTimer.current) {
      window.clearTimeout(clickTimer.current)
      clickTimer.current = undefined
    }
    setGlobalDefaultExpanded(!credentialDefaultExpanded)
  }

  const maybeEnableSameKeyMode = async (proxy: ProxyEndpoint): Promise<void> => {
    const snapshot = allProxies.some((p) => p.id === proxy.id)
      ? allProxies.map((p) => (p.id === proxy.id ? proxy : p))
      : [...allProxies, proxy]
    const duplicates = snapshot.filter((p) => p.key.trim() === proxy.key.trim())
    if (duplicates.length < 2 || duplicates.some((p) => p.sameKeyMode === true)) return
    if (!(await askConfirm(t('api.sameKeyConfirm', { n: Math.max(1, duplicates.length - 1) })))) return
    try {
      await api.command('proxies.setSameKeyMode', { id: proxy.id, enabled: true })
      toast('success', t('api.sameKeyModeEnabled'))
    } catch (e) {
      toast('error', e instanceof Error ? e.message : String(e))
    }
  }

  const enableSameKeyMode = async (id: string): Promise<void> => {
    try {
      await api.command('proxies.setSameKeyMode', { id, enabled: true })
      toast('success', t('api.sameKeyModeEnabled'))
    } catch (e) {
      toast('error', e instanceof Error ? e.message : String(e))
    }
  }

  const toggleSameKeyActive = async (id: string, active: boolean): Promise<void> => {
    try {
      await api.command('proxies.setSameKeyActive', { id, active })
    } catch (e) {
      toast('error', e instanceof Error ? e.message : String(e))
    }
  }

  const openFor = (id: string): boolean => pinnedSet.has(id) || (ui.hoveredId === id && !suppressedSet.has(id))
  const pin = (id: string): void =>
    patchUi((prev) => ({
      ...prev,
      pinnedIds: uniqueIds([...prev.pinnedIds, id]),
      suppressedIds: prev.suppressedIds.filter((x) => x !== id)
    }))
  const hoverIn = (id: string): void => patchUi((prev) => ({ ...prev, hoveredId: id }))
  const hoverOut = (id: string): void =>
    patchUi((prev) => ({
      ...prev,
      hoveredId: prev.hoveredId === id ? null : prev.hoveredId,
      suppressedIds: prev.suppressedIds.filter((x) => x !== id)
    }))
  const fold = (id: string): void =>
    patchUi((prev) => ({
      ...prev,
      pinnedIds: prev.pinnedIds.filter((x) => x !== id),
      suppressedIds: uniqueIds([...prev.suppressedIds, id]),
      hoveredId: prev.hoveredId === id ? id : prev.hoveredId
    }))

  const create = async (): Promise<void> => {
    const name = await askPrompt(t('api.namePrompt'), t('api.defaultName', { n: proxies.length + 1 }))
    if (name === null) return
    setCreating(true)
    try {
      const created = await api.command('proxies.create', { credentialId: credential.id, name })
      pin(created.id)
      await maybeEnableSameKeyMode(created)
      toast('success', t('api.created'))
    } catch (e) {
      toast('error', e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-doodle text-lg font-bold">{t('api.title')}</h3>
        <div className="flex flex-wrap items-center gap-2">
          {proxies.length > 0 && (
            <DoodleButton
              variant="default"
              className="text-sm"
              title={t('api.defaultToggleHint')}
              onClick={handleDefaultToggleClick}
              onDoubleClick={handleDefaultToggleDoubleClick}
            >
              {credentialDefaultExpanded ? t('api.collapseAll') : t('api.expandAll')}
            </DoodleButton>
          )}
          <DoodleButton variant="primary" className="text-sm" disabled={creating} onClick={() => void create()}>
            {t('api.new')}
          </DoodleButton>
        </div>
      </div>

      {!status.running && (
        <span className="text-xs text-marker-coral">{t('api.serverDown')}</span>
      )}

      {proxies.length === 0 ? (
        <div className="rounded-[10px] border-2 border-dashed border-ink/25 px-4 py-8 text-center text-sm opacity-50">
          {t('api.empty')}
        </div>
      ) : (
        proxies.map((p) => (
          <ProxyCard
            key={p.id}
            proxy={p}
            provider={credential.provider}
            status={status}
            sameKeyInfo={sameKeyInfoById.get(p.id)}
            open={openFor(p.id)}
            onHistory={() => setHistoryId(p.id)}
            onPin={() => pin(p.id)}
            onHoverIn={() => hoverIn(p.id)}
            onHoverOut={() => hoverOut(p.id)}
            onFold={() => fold(p.id)}
            onAfterKeyChange={maybeEnableSameKeyMode}
            onEnableSameKeyMode={() => void enableSameKeyMode(p.id)}
            onToggleSameKeyActive={(active) => void toggleSameKeyActive(p.id, active)}
          />
        ))
      )}

      <UsageHistoryDialog
        scope="proxy"
        id={historyId}
        name={historyProxy?.name ?? ''}
        open={historyId !== null}
        onClose={() => setHistoryId(null)}
      />
    </div>
  )
}

function ProxyCard({
  proxy,
  provider,
  status,
  sameKeyInfo,
  open,
  onHistory,
  onPin,
  onHoverIn,
  onHoverOut,
  onFold,
  onAfterKeyChange,
  onEnableSameKeyMode,
  onToggleSameKeyActive
}: {
  proxy: ProxyEndpoint
  provider: CredentialView['provider']
  status: ProxyServerStatus
  sameKeyInfo?: ProxySameKeyInfo
  open: boolean
  onHistory: () => void
  onPin: () => void
  onHoverIn: () => void
  onHoverOut: () => void
  onFold: () => void
  onAfterKeyChange: (proxy: ProxyEndpoint) => Promise<void>
  onEnableSameKeyMode: () => void
  onToggleSameKeyActive: (active: boolean) => void
}): JSX.Element {
  const toast = useStore((s) => s.toast)
  const askPrompt = useStore((s) => s.askPrompt)
  const askConfirm = useStore((s) => s.askConfirm)
  const t = useT()
  const [reveal, setReveal] = useState(false)

  // undefined (legacy key) reads as loopback-only — matches the server's bind logic
  const localOnly = proxy.localOnly !== false
  // this key's own reachable address: loopback unless it allows LAN (then the real LAN IP)
  const host = localOnly ? '127.0.0.1' : (status.lanHost ?? '0.0.0.0')
  const base = `http://${host}:${status.port}`
  const url = provider === 'openai' ? `${base}/v1` : base

  const masked = `${proxy.key.slice(0, provider === 'anthropic' ? 14 : 8)}${'•'.repeat(12)}${proxy.key.slice(-4)}`

  const copy = (text: string, msg: string): void => {
    void api.command('clipboard.write', { text })
    toast('success', msg)
  }
  const setExposure = (localOnly: boolean): void =>
    void api.command('proxies.update', { id: proxy.id, patch: { localOnly } })
  const rename = async (): Promise<void> => {
    const name = await askPrompt(t('api.renamePrompt'), proxy.name)
    if (name === null) return
    await api.command('proxies.update', { id: proxy.id, patch: { name } })
  }
  const editKey = async (): Promise<void> => {
    const key = await askPrompt(t('api.customKeyPrompt'), proxy.key)
    if (!key) return
    try {
      const updated = await api.command('proxies.update', { id: proxy.id, patch: { key } })
      await onAfterKeyChange(updated)
      toast('success', t('api.keyUpdated'))
    } catch (e) {
      toast('error', e instanceof Error ? e.message : String(e))
    }
  }
  const regen = async (): Promise<void> => {
    if (!(await askConfirm(t('api.regenConfirm')))) return
    await api.command('proxies.regenerateKey', { id: proxy.id })
    toast('success', t('api.regenerated'))
  }
  const reset = async (): Promise<void> => {
    if (!(await askConfirm(t('api.resetConfirm')))) return
    await api.command('proxies.resetUsage', { id: proxy.id })
  }
  const setLimit = async (): Promise<void> => {
    const cur = proxy.limitTotalTokens ? String(proxy.limitTotalTokens) : ''
    const v = await askPrompt(t('api.limitPrompt'), cur)
    if (v === null) return
    const n = Math.max(0, Math.floor(Number(v.replace(/[^0-9]/g, '')) || 0))
    await api.command('proxies.update', { id: proxy.id, patch: { limitTotalTokens: n } })
    toast('success', n ? t('api.limitSet', { n: n.toLocaleString('en-US') }) : t('api.limitCleared'))
  }
  const remove = async (): Promise<void> => {
    if (!(await askConfirm(t('api.deleteConfirm', { n: proxy.name })))) return
    await api.command('proxies.delete', { id: proxy.id })
    toast('success', t('detail.deleted'))
  }

  const sameKeyText = sameKeyInfo
    ? t('api.sameKeyHint', {
        n: Math.max(1, sameKeyInfo.groupSize - 1),
        state: sameKeyInfo.active ? t('api.sameKeyActive') : t('api.sameKeyInactive')
      })
    : null

  const u = proxy.usage
  return (
    <div
      className={`doodle-edge flex flex-col rounded-[12px] border-2 p-3 transition ${
        proxy.enabled ? 'border-ink/35 bg-card/60' : 'border-ink/20 bg-ink/5 opacity-70'
      }`}
      onMouseEnter={onHoverIn}
      onMouseLeave={onHoverOut}
      onMouseDown={onPin}
    >
      <div className="flex items-center gap-2">
        <button onClick={() => void rename()} className="truncate text-base font-bold hover:underline" title={t('api.renameTitle')}>
          {proxy.name}
        </button>
        <span className="ml-auto text-xs opacity-50">{ago(u.lastUsedAt)}</span>
        <DoodleToggle
          label={t('common.enable')}
          checked={proxy.enabled}
          onChange={(v) => void api.command('proxies.update', { id: proxy.id, patch: { enabled: v } })}
        />
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            if (open) onFold()
            else onPin()
          }}
          aria-expanded={open}
          title={open ? t('api.cardCollapse') : t('api.cardExpand')}
          className="rounded-[6px] border-2 border-ink/30 px-1.5 py-0.5 text-xs leading-none hover:bg-ink/5"
        >
          <motion.span
            className="inline-block"
            animate={{ rotate: open ? 90 : 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          >
            ▸
          </motion.span>
        </button>
      </div>

      <motion.div
        initial={false}
        inert={!open}
        animate={open ? { height: 'auto', opacity: 1 } : { height: 0, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 24 }}
        className="overflow-hidden"
      >
        <div className="flex flex-col gap-2 pt-2">
          {sameKeyInfo && !sameKeyInfo.modeEnabled && (
            <div className="doodle-edge flex flex-wrap items-center gap-3 rounded-[10px] border-2 border-marker-yellow/60 bg-marker-yellow/15 px-3 py-2 text-sm">
              <div className="flex-1 leading-relaxed">{t('api.sameKeyPromptBanner', { n: Math.max(1, sameKeyInfo.groupSize - 1) })}</div>
              <DoodleButton variant="primary" className="text-sm" onClick={onEnableSameKeyMode}>
                {t('api.sameKeyEnableCta')}
              </DoodleButton>
            </div>
          )}

          {sameKeyInfo?.modeEnabled && (
            <div className="doodle-edge flex flex-wrap items-center gap-3 rounded-[10px] border-2 border-marker-knot/50 bg-marker-knot/10 px-3 py-2 text-sm">
              <div className="flex-1 leading-relaxed">{sameKeyText}</div>
              <div className="flex items-center gap-2">
                <span className="text-sm opacity-65">{t('api.sameKeyToggle')}</span>
                <DoodleToggle
                  label={t('api.sameKeyToggle')}
                  checked={sameKeyInfo.active}
                  onChange={onToggleSameKeyActive}
                />
              </div>
            </div>
          )}

          {/* this key's own address */}
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs opacity-55">{t('api.addr')}</span>
            <code className="mono flex-1 truncate rounded-[7px] border-2 border-ink/20 bg-paper/60 px-2 py-1 text-sm">
              {url}
            </code>
            <button
              className="shrink-0 rounded-[6px] border-2 border-ink/40 px-2 py-0.5 text-xs hover:bg-ink/5"
              onClick={() => copy(url, t('api.copiedAddr'))}
            >
              {t('common.copy')}
            </button>
          </div>

          {/* the key */}
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs opacity-55">{t('api.key')}</span>
            <code className="mono flex-1 truncate rounded-[7px] border-2 border-ink/20 bg-paper/60 px-2 py-1 text-sm">
              {reveal ? proxy.key : masked}
            </code>
            <button className="shrink-0 rounded-[6px] border-2 border-ink/40 px-2 py-0.5 text-xs hover:bg-ink/5" onClick={() => setReveal((v) => !v)}>
              {reveal ? t('common.hide') : t('common.show')}
            </button>
            <button className="shrink-0 rounded-[6px] border-2 border-ink/40 px-2 py-0.5 text-xs hover:bg-ink/5" onClick={() => copy(proxy.key, t('api.copiedKey'))}>
              {t('common.copy')}
            </button>
          </div>

          {/* per-key access scope */}
          <div className="flex items-center gap-2">
            <span className="text-xs opacity-55">{t('api.scope')}</span>
            <div className="doodle-edge flex gap-1 rounded-[8px] border-2 border-ink/30 p-0.5 text-xs">
              <button
                onClick={() => setExposure(true)}
                className={`rounded-[5px] px-2 py-0.5 transition ${localOnly ? 'bg-marker-knot text-[#2B2B2B]' : 'hover:bg-ink/5'}`}
              >
                {t('api.localOnly')}
              </button>
              <button
                onClick={() => setExposure(false)}
                className={`rounded-[5px] px-2 py-0.5 transition ${!localOnly ? 'bg-marker-knot text-[#2B2B2B]' : 'hover:bg-ink/5'}`}
              >
                {t('api.lan')}
              </button>
            </div>
            {!localOnly && <span className="text-xs opacity-45">{t('api.lanHint')}</span>}
          </div>

          {/* usage meters */}
          <div className="grid grid-cols-4 gap-2 text-center">
            <Meter label={t('api.mReq')} value={grouped(u.requests)} />
            <Meter label={t('api.mIn')} value={compact(u.inputTokens)} title={t('api.mInTitle', { t: grouped(u.inputTokens), c: grouped(u.cachedTokens) })} />
            <Meter label={t('api.mOut')} value={compact(u.outputTokens)} title={t('api.mTokensTitle', { t: grouped(u.outputTokens) })} />
            <Meter label={t('api.mReason')} value={compact(u.reasoningTokens)} title={t('api.mTokensTitle', { t: grouped(u.reasoningTokens) })} />
          </div>

          {/* token cap (input + output) */}
          {proxy.limitTotalTokens ? (
            (() => {
              const used = u.inputTokens + u.outputTokens
              const pct = Math.min(100, Math.round((used / proxy.limitTotalTokens!) * 100))
              const hit = used >= proxy.limitTotalTokens!
              return (
                <div className="text-xs">
                  <div className="flex justify-between opacity-65">
                    <span>{hit ? t('api.capHit') : t('api.cap')}</span>
                    <span className="mono">
                      {compact(used)} / {compact(proxy.limitTotalTokens!)}
                    </span>
                  </div>
                  <div className="doodle-edge mt-1 h-2 overflow-hidden rounded-full border-2 border-ink/40">
                    <div className={`h-full ${hit ? 'bg-marker-coral' : 'bg-marker-knot'}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })()
          ) : null}

          <div className="flex flex-wrap gap-1.5 text-xs">
            <Mini onClick={onHistory}>{t('api.history')}</Mini>
            <Mini onClick={() => void setLimit()}>{proxy.limitTotalTokens ? t('api.changeLimit') : t('api.setLimit')}</Mini>
            <Mini onClick={() => void editKey()}>{t('api.customKey')}</Mini>
            <Mini onClick={() => void regen()}>{t('api.regen')}</Mini>
            <Mini onClick={() => void reset()}>{t('api.resetUsage')}</Mini>
            <Mini danger onClick={() => void remove()}>{t('api.delete')}</Mini>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

function Meter({ label, value, title }: { label: string; value: string; title?: string }): JSX.Element {
  return (
    <div className="rounded-[8px] border-2 border-ink/15 py-1" title={title}>
      <div className="mono text-base font-bold leading-none">{value}</div>
      <div className="mt-0.5 text-[11px] opacity-50">{label}</div>
    </div>
  )
}

function Mini({
  children,
  onClick,
  danger
}: {
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`rounded-[6px] border-2 px-2 py-0.5 transition ${
        danger ? 'border-marker-coral/60 text-marker-coral hover:bg-marker-coral/10' : 'border-ink/30 hover:bg-ink/5'
      }`}
    >
      {children}
    </button>
  )
}
