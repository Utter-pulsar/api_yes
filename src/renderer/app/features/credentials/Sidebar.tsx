import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import { useT } from '../../lib/i18n'
import { api } from '../../lib/bridge'
import { useDoodleScrollbar } from '../../lib/useDoodleScrollbar'
import { DoodleButton } from '../../components/doodle/DoodleButton'
import { ProviderBadge, KindBadge, StatusDot } from './badges'
import { AddCredentialDialog } from './AddCredentialDialog'

interface CtxMenu {
  id: string
  name: string
  x: number
  y: number
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
  const [menu, setMenu] = useState<CtxMenu | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useDoodleScrollbar(listRef, 'y')

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
    <aside className="flex w-72 shrink-0 flex-col border-r-2 border-ink/80">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h2 className="font-doodle text-lg font-bold">{t('sidebar.title')}</h2>
        <DoodleButton variant="primary" className="!px-2.5 !py-1 text-sm" onClick={() => setAdding(true)}>
          {t('sidebar.add')}
        </DoodleButton>
      </div>

      <div ref={listRef} className="relative min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-4">
        {credentials.length === 0 && (
          <div className="mt-10 whitespace-pre-line px-3 text-center font-doodle text-sm leading-relaxed opacity-50">
            {t('sidebar.empty')}
          </div>
        )}
        {credentials.map((c) => {
          const count = proxies.filter((p) => p.credentialId === c.id).length
          const active = c.id === selectedId
          return (
            <button
              key={c.id}
              onClick={() => select(c.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                // keep this gesture from reaching the window close-listeners (re-open race)
                e.stopPropagation()
                select(c.id)
                setMenu({ id: c.id, name: c.name, x: e.clientX, y: e.clientY })
              }}
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
    </aside>
  )
}
