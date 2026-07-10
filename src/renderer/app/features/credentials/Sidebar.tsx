import { useEffect, useRef, useState } from 'react'
import type { Provider } from '@shared/types'
import { useStore } from '../../store'
import { useT } from '../../lib/i18n'
import { api } from '../../lib/bridge'
import { useDoodleScrollbar } from '../../lib/useDoodleScrollbar'
import { useSpringyWidth } from '../../lib/useSpringyWidth'
import { DoodleButton } from '../../components/doodle/DoodleButton'
import { ProviderBadge, KindBadge, StatusDot } from './badges'
import { AddCredentialDialog } from './AddCredentialDialog'
import { UsageHistoryDialog } from '../usage/UsageHistoryDialog'

interface CtxMenu {
  id: string
  name: string
  x: number
  y: number
}

// ----- resizable / collapsible sidebar (persisted, springy Q弹 settle) -----
const WIDTH_KEY = 'api-yes-sidebar-width'
const COLLAPSED_KEY = 'api-yes-sidebar-collapsed'
const MIN_W = 220
const MAX_W = 560
const DEFAULT_W = 288 // the old w-72
const COLLAPSED_W = 64
const clampW = (w: number): number => Math.max(MIN_W, Math.min(MAX_W, w))
const readWidth = (): number => {
  const v = Number(localStorage.getItem(WIDTH_KEY))
  return Number.isFinite(v) && v > 0 ? clampW(v) : DEFAULT_W
}
const readCollapsed = (): boolean => localStorage.getItem(COLLAPSED_KEY) === '1'

// collapsed-rail wash per provider (badges.tsx owns the chip styles; only a tint is needed here)
const providerTint: Record<Provider, string> = {
  openai: 'bg-marker-sky/20',
  anthropic: 'bg-marker-knot/15'
}

function Chevron({ dir }: { dir: 'left' | 'right' }): JSX.Element {
  const d = dir === 'left' ? 'M10 3 L5 8 L10 13' : 'M6 3 L11 8 L6 13'
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d={d} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The left list of credentials. Click to open; right-click for a quick menu (test/rename/delete). */
export function Sidebar(): JSX.Element {
  const credentials = useStore((s) => s.credentials)
  const selectedId = useStore((s) => s.selectedId)
  const select = useStore((s) => s.select)
  const proxies = useStore((s) => s.proxies)
  const toast = useStore((s) => s.toast)
  const askPrompt = useStore((s) => s.askPrompt)
  const askConfirm = useStore((s) => s.askConfirm)
  const t = useT()
  const [adding, setAdding] = useState(false)
  // the app-level (all credentials rolled up) usage-history dialog
  const [usageOpen, setUsageOpen] = useState(false)
  const [menu, setMenu] = useState<CtxMenu | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useDoodleScrollbar(listRef, 'y')

  // Width is spring-driven by direct DOM mutation; React only re-renders on collapse toggle.
  // NOTE: only style.width is ever animated — never a transform — because the context menu and
  // AddCredentialDialog are position:fixed children and a transformed ancestor would trap them.
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const collapsedRef = useRef(collapsed)
  const userWidth = useRef(readWidth())
  const initialWidth = useRef(collapsed ? COLLAPSED_W : userWidth.current).current
  const {
    ref: asideRef,
    startResize,
    animateTo,
    getWidth
  } = useSpringyWidth({
    initial: initialWidth,
    min: MIN_W,
    max: MAX_W,
    onSettle: (w) => {
      // a collapse/expand settle must not clobber the remembered user width
      if (collapsedRef.current) return
      userWidth.current = clampW(w)
      localStorage.setItem(WIDTH_KEY, String(userWidth.current))
    }
  })
  const toggleCollapsed = (): void => {
    const next = !collapsedRef.current
    if (next) {
      // commit the LIVE width before collapsing: a just-released drag may still be mid-settle,
      // and its onSettle (the normal commit point) is skipped once collapsedRef flips
      userWidth.current = clampW(getWidth())
      localStorage.setItem(WIDTH_KEY, String(userWidth.current))
    }
    collapsedRef.current = next
    setCollapsed(next)
    localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
    animateTo(next ? COLLAPSED_W : userWidth.current)
  }

  // Close the menu on any outside press / escape / scroll / resize. Crucially, the close listeners
  // are attached on the NEXT tick: otherwise the very gesture that opened the menu (a contextmenu
  // event still bubbling to window) would immediately close it again — which made the 2nd+
  // right-click look completely dead.
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const id = window.setTimeout(() => {
      window.addEventListener('pointerdown', close)
      window.addEventListener('contextmenu', close)
      window.addEventListener('scroll', close, true)
      window.addEventListener('resize', close)
    }, 0)
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onEsc)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onEsc)
    }
  }, [menu])

  const openMenu = (e: React.MouseEvent, id: string, name: string): void => {
    e.preventDefault()
    // keep this gesture from reaching the window close-listeners (re-open race)
    e.stopPropagation()
    select(id)
    setMenu({ id, name, x: e.clientX, y: e.clientY })
  }

  const doTest = async (id: string): Promise<void> => {
    try {
      const r = await api.command('credentials.test', { id })
      toast(r.ok ? 'success' : 'error', r.message)
    } catch (e) {
      toast('error', e instanceof Error ? e.message : String(e))
    }
  }
  const doRename = async (id: string, name: string): Promise<void> => {
    const next = await askPrompt(t('api.renamePrompt'), name)
    if (next === null) return
    await api.command('credentials.update', { id, patch: { name: next } })
  }
  const doDelete = async (id: string, name: string): Promise<void> => {
    if (!(await askConfirm(t('detail.deleteConfirm', { n: name })))) return
    await api.command('credentials.delete', { id })
    toast('success', t('detail.deleted'))
  }

  return (
    <aside
      ref={asideRef}
      style={{ width: initialWidth }}
      className="relative flex shrink-0 flex-col border-r-2 border-ink/80"
    >
      {collapsed ? (
        <div className="flex flex-col items-center gap-2 px-2 pb-2 pt-4">
          <button
            title={t('sidebar.expand')}
            onClick={toggleCollapsed}
            className="doodle-edge flex h-9 w-9 items-center justify-center rounded-[10px] border-2 border-ink/40 bg-card/60 transition hover:border-ink/70"
          >
            <Chevron dir="right" />
          </button>
          <button
            title={t('sidebar.add')}
            onClick={() => setAdding(true)}
            className="doodle-edge flex h-9 w-9 items-center justify-center rounded-[10px] border-2 border-ink/40 bg-card/60 font-doodle text-base font-bold transition hover:border-ink/70"
          >
            ＋
          </button>
          <button
            title={t('sidebar.usageTitle')}
            onClick={() => setUsageOpen(true)}
            className="doodle-edge flex h-9 w-9 items-center justify-center rounded-[10px] border-2 border-ink/40 bg-card/60 font-doodle text-base transition hover:border-ink/70"
          >
            📊
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 px-4 pb-2 pt-4">
          <h2 className="min-w-0 flex-1 truncate font-doodle text-lg font-bold">
            {/* the heading doubles as the entry to the app-wide usage history */}
            <button
              type="button"
              title={t('sidebar.usageTitle')}
              onClick={() => setUsageOpen(true)}
              className="max-w-full cursor-pointer truncate align-bottom transition hover:opacity-70"
            >
              {t('sidebar.title')}
            </button>
          </h2>
          <DoodleButton
            variant="primary"
            className="!px-2.5 !py-1 text-sm"
            onClick={() => setAdding(true)}
          >
            {t('sidebar.add')}
          </DoodleButton>
          <button
            title={t('sidebar.collapse')}
            onClick={toggleCollapsed}
            className="shrink-0 rounded-[8px] p-1 opacity-50 transition hover:bg-ink/5 hover:opacity-100"
          >
            <Chevron dir="left" />
          </button>
        </div>
      )}

      <div
        ref={listRef}
        className={`relative min-h-0 flex-1 space-y-2 overflow-y-auto pb-4 ${
          // pt-1 keeps the first mini-square's overhanging status dot inside the scroll clip box
          collapsed ? 'px-2 pt-1' : 'px-3'
        }`}
      >
        {!collapsed && credentials.length === 0 && (
          <div className="mt-10 whitespace-pre-line px-3 text-center font-doodle text-sm leading-relaxed opacity-50">
            {t('sidebar.empty')}
          </div>
        )}
        {credentials.map((c) => {
          const count = proxies.filter((p) => p.credentialId === c.id).length
          const active = c.id === selectedId
          if (collapsed) {
            return (
              <button
                key={c.id}
                onClick={() => select(c.id)}
                onContextMenu={(e) => openMenu(e, c.id, c.name)}
                title={c.name}
                className={`doodle-edge relative mx-auto flex h-10 w-10 items-center justify-center rounded-[12px] border-2 font-doodle text-base font-bold transition ${
                  active
                    ? 'border-marker-knot bg-marker-knot/10'
                    : `border-ink/25 hover:border-ink/60 ${providerTint[c.provider]}`
                } ${c.enabled ? '' : 'opacity-55'}`}
              >
                {/* first character stands in for the name; spread handles astral glyphs/emoji */}
                {[...c.name.trim()][0] ?? '·'}
                <span className="absolute -right-1 -top-1 flex">
                  <StatusDot ok={c.lastTest?.ok} />
                </span>
              </button>
            )
          }
          return (
            <button
              key={c.id}
              onClick={() => select(c.id)}
              onContextMenu={(e) => openMenu(e, c.id, c.name)}
              className={`doodle-edge block w-full rounded-[12px] border-2 px-3 py-2.5 text-left font-doodle transition ${
                active
                  ? 'border-marker-knot bg-marker-knot/10'
                  : 'border-ink/30 bg-card/60 hover:border-ink/60'
              } ${c.enabled ? '' : 'opacity-55'}`}
            >
              <div className="flex items-center gap-2">
                <StatusDot ok={c.lastTest?.ok} />
                <span className="flex-1 truncate text-base font-bold">{c.name}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <ProviderBadge provider={c.provider} />
                <KindBadge kind={c.kind} />
                <span className="ml-auto text-xs opacity-55">
                  {c.enabled ? t('sidebar.apiCount', { n: count }) : t('sidebar.disabled')}
                </span>
              </div>
            </button>
          )
        })}
      </div>

      {/* width drag handle — a wide invisible hit zone straddling the right border, with a small
          visible "white fry" capsule. z-[45] keeps it above the doodle scrollthumb (z-40) but
          below shared modal shells (z-50), so dialogs can cover it cleanly. */}
      {!collapsed && (
        <div
          onPointerDown={startResize}
          title={t('sidebar.resize')}
          className="group absolute -right-[7px] top-0 z-[45] flex h-full w-3 touch-none cursor-col-resize items-center justify-center"
        >
          <div className="doodle-edge h-10 w-1.5 rounded-full border-2 border-ink/60 bg-paper transition group-hover:border-ink" />
        </div>
      )}

      {/* right-click context menu */}
      {menu && (
        <div
          className="fixed z-[85] min-w-[140px] rounded-[10px] border-2 border-ink bg-card p-1 font-doodle shadow-md"
          style={{ top: menu.y, left: menu.x }}
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {[
            { label: t('ctx.test'), run: () => void doTest(menu.id) },
            { label: t('ctx.rename'), run: () => void doRename(menu.id, menu.name) },
            { label: t('ctx.delete'), run: () => void doDelete(menu.id, menu.name), danger: true }
          ].map((item) => (
            <button
              key={item.label}
              onClick={() => {
                setMenu(null)
                item.run()
              }}
              className={`block w-full rounded-[6px] px-3 py-1.5 text-left text-sm hover:bg-marker-yellow/40 ${
                item.danger ? 'text-marker-coral hover:bg-marker-coral/15' : ''
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      <AddCredentialDialog open={adding} onClose={() => setAdding(false)} />
      <UsageHistoryDialog scope="app" id={null} name="" open={usageOpen} onClose={() => setUsageOpen(false)} />
    </aside>
  )
}
