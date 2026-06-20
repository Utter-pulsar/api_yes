import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../lib/bridge'
import { useStore } from '../store'
import { useT } from '../lib/i18n'
import { DoodleBox } from './doodle/DoodleBox'
import { ModalScrim } from './ModalScrim'
import { SettingsDialog } from './SettingsDialog'
import { Wordmark } from './Wordmark'
import logoUrl from '@assets/logo.png'

type MenuDialog = 'settings' | 'about' | null

const TITLEBAR_H = 44

/**
 * The integrated window title bar: a hamburger menu + the window controls. On Win/Linux the window
 * is frameless, so we draw our own hand-drawn min/max/close on the RIGHT; on macOS the native
 * traffic lights sit top-left, so the hamburger moves right. The 版本 item pops a Q-bouncy About
 * card with 检查更新.
 */
export function TitleBar(): JSX.Element {
  const isMac = window.platform === 'darwin'
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialog, setDialog] = useState<MenuDialog>(null)
  const [info, setInfo] = useState<{ name: string; version: string; author: string } | null>(null)
  const updateStatus = useStore((s) => s.updateStatus)
  const checkForUpdate = useStore((s) => s.checkForUpdate)
  const theme = useStore((s) => s.theme)
  const toggleTheme = useStore((s) => s.toggleTheme)
  const t = useT()

  useEffect(() => {
    void api.query('app.info', undefined).then(setInfo)
  }, [])

  const updateBusy =
    updateStatus.phase === 'checking' ||
    updateStatus.phase === 'downloading' ||
    updateStatus.phase === 'installing'
  const updateLabel =
    updateStatus.phase === 'checking'
      ? t('update.checking')
      : updateStatus.phase === 'downloading'
        ? t('update.downloading', { p: updateStatus.percent })
        : updateStatus.phase === 'installing'
          ? t('update.installing')
          : t('update.check')
  const updateHint =
    updateStatus.phase === 'none'
      ? t('about.upToDate')
      : updateStatus.phase === 'error'
        ? t('about.updateFailed', { m: updateStatus.message })
        : t('about.updateHint')

  return (
    <>
      <div
        className="app-drag relative z-30 flex shrink-0 items-center gap-2 border-b border-ink/15 px-2"
        style={{ height: TITLEBAR_H, backgroundColor: 'rgb(var(--paper))' }}
      >
        <button
          aria-label={t('menu.aria')}
          onClick={() => setMenuOpen((v) => !v)}
          className={`app-no-drag flex h-8 w-8 items-center justify-center rounded-[8px] text-ink/80 transition hover:bg-ink/10${isMac ? ' ml-auto' : ''}`}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="3.5" y1="6" x2="16.5" y2="6" />
            <line x1="3.5" y1="10" x2="16.5" y2="10" />
            <line x1="3.5" y1="14" x2="16.5" y2="14" />
          </svg>
        </button>

        <img src={logoUrl} alt="" className="app-no-drag h-7 w-7 select-none" draggable={false} />
        <Wordmark height={20} className="select-none text-ink" />

        {!isMac && <WindowControls />}
      </div>

      {/* dropdown under the hamburger */}
      <AnimatePresence>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-[70]" onClick={() => setMenuOpen(false)} />
            <motion.div
              className="fixed z-[80] font-doodle"
              style={{
                top: TITLEBAR_H - 4,
                ...(isMac ? { right: 8 } : { left: 8 }),
                transformOrigin: isMac ? 'top right' : 'top left'
              }}
              initial={{ opacity: 0, scale: 0.85, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -6 }}
              transition={{ type: 'spring', stiffness: 460, damping: 24 }}
            >
              <div className="min-w-[160px] rounded-[10px] border-2 border-ink bg-card p-1 shadow-md">
                {(
                  [
                    { id: 'settings', label: t('menu.settings') },
                    { id: 'theme', label: theme === 'dark' ? t('menu.themeLight') : t('menu.themeDark') },
                    { id: 'about', label: t('menu.about') }
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setMenuOpen(false)
                      if (item.id === 'theme') toggleTheme()
                      else setDialog(item.id)
                    }}
                    className="flex w-full items-center gap-2 rounded-[6px] px-3 py-1.5 text-left text-base hover:bg-marker-yellow/40"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Q-bouncy version / about card */}
      <AnimatePresence>
        {dialog === 'about' && (
          <motion.div
            className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <ModalScrim onDismiss={() => setDialog(null)} />
            <motion.div
              className="pointer-events-auto relative"
              initial={{ scale: 0.8, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.85, opacity: 0, y: 8 }}
              transition={{ type: 'spring', stiffness: 380, damping: 15 }}
            >
              <DoodleBox fill="--card" fillStyle="solid">
                <div className="flex w-72 flex-col items-center gap-2 p-6 text-center font-doodle">
                  <img src={logoUrl} alt="" className="h-16 w-16" draggable={false} />
                  <div className="text-2xl font-bold">{info?.name ?? 'API-YES'}</div>
                  <div className="text-base opacity-70">{t('about.version', { v: info?.version ?? '…' })}</div>
                  <div className="text-sm opacity-50">{t('about.author', { a: info?.author ?? 'Utter_pulsar' })}</div>
                  <p className="px-1 text-xs leading-relaxed opacity-50">{updateHint}</p>
                  <div className="mt-3 flex w-full gap-3">
                    <button
                      onClick={checkForUpdate}
                      disabled={updateBusy}
                      className="flex-1 rounded-[8px] border-2 border-ink px-3 py-1 text-base hover:bg-marker-yellow/40 disabled:opacity-50"
                    >
                      {updateLabel}
                    </button>
                    <button
                      onClick={() => setDialog(null)}
                      className="flex-1 rounded-[8px] border-2 border-ink px-3 py-1 text-base hover:bg-marker-yellow/40"
                    >
                      {t('common.ok')}
                    </button>
                  </div>
                </div>
              </DoodleBox>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <SettingsDialog open={dialog === 'settings'} onClose={() => setDialog(null)} />
    </>
  )
}

/** Hand-drawn minimize / maximize-restore / close for the frameless Win/Linux window. */
function WindowControls(): JSX.Element {
  const [maximized, setMaximized] = useState(false)
  const t = useT()
  useEffect(() => {
    void api.query('window.isMaximized', undefined).then(setMaximized)
    return api.on('window.maximized', setMaximized)
  }, [])
  const btn =
    'app-no-drag flex h-8 w-8 items-center justify-center rounded-[8px] text-ink/80 transition hover:bg-ink/10'
  return (
    <div className="ml-auto flex items-center gap-1">
      <button
        aria-label={t('win.min')}
        title={t('win.min')}
        onClick={() => void api.command('window.minimize', undefined)}
        className={btn}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="4" y1="13" x2="16" y2="13" />
        </svg>
      </button>
      <button
        aria-label={maximized ? t('win.restore') : t('win.max')}
        title={maximized ? t('win.restore') : t('win.max')}
        onClick={() => void api.command('window.toggleMaximize', undefined)}
        className={btn}
      >
        {maximized ? (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4.5" y="6.5" width="9" height="9" rx="1.5" />
            <path d="M7.5 6.5 V4.5 H15.5 V12.5 H13.5" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4.5" y="4.5" width="11" height="11" rx="1.5" />
          </svg>
        )}
      </button>
      <button
        aria-label={t('win.close')}
        title={t('win.close')}
        onClick={() => void api.command('window.close', undefined)}
        className={`${btn} hover:bg-marker-coral hover:text-[#2B2B2B]`}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="5.5" y1="5.5" x2="14.5" y2="14.5" />
          <line x1="14.5" y1="5.5" x2="5.5" y2="14.5" />
        </svg>
      </button>
    </div>
  )
}
