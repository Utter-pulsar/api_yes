import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { AppSettings } from '@shared/types'
import { api } from '../lib/bridge'
import { useStore } from '../store'
import { useT } from '../lib/i18n'
import { DialogShell } from './DialogShell'
import { DoodleToggle } from './doodle/DoodleToggle'
import { DoodleButton } from './doodle/DoodleButton'
import { fieldCls } from './doodle/DoodleInput'

function SettingRow({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="flex flex-col">
        <span className="text-base">{label}</span>
        {hint && <span className="text-xs opacity-60">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

/**
 * Reverse-proxy server section: port, autostart, start/stop, and live state.
 *
 * The body is COLLAPSED at rest and peeks open on hover; a click anywhere inside pins it open
 * (so hovering away no longer closes it). It unpins + collapses on the header's fold button or on
 * any click outside the box (still within the settings dialog). The fold button also suppresses
 * hover-reopen until the pointer leaves, so it visibly closes even while still hovered.
 */
function ProxyServerSection({
  settings,
  update
}: {
  settings: AppSettings | null
  update: (patch: Partial<AppSettings>) => void
}): JSX.Element {
  const status = useStore((s) => s.proxyStatus)
  const t = useT()
  const [port, setPort] = useState(String(settings?.proxyPort ?? 8788))
  const [busy, setBusy] = useState(false)

  const boxRef = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(false)
  const [hover, setHover] = useState(false)
  const [suppressHover, setSuppressHover] = useState(false)
  const open = pinned || (hover && !suppressHover)

  // while pinned, any pointer-down outside the box (dialog, scrim, anywhere) unpins it
  useEffect(() => {
    if (!pinned) return
    const onDown = (e: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setPinned(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pinned])

  useEffect(() => {
    if (settings) setPort(String(settings.proxyPort))
  }, [settings])

  const toggle = async (): Promise<void> => {
    setBusy(true)
    try {
      if (status.running) await api.command('proxy.stop', undefined)
      else await api.command('proxy.start', undefined)
    } finally {
      setBusy(false)
    }
  }

  const fold = (e: React.MouseEvent): void => {
    e.stopPropagation() // don't let the box's own pin-on-click swallow the fold
    if (open) {
      setPinned(false)
      setSuppressHover(true) // stay closed while the pointer is still over the box
    } else {
      setPinned(true)
    }
  }

  return (
    <div
      ref={boxRef}
      className="flex flex-col rounded-[10px] border-2 border-ink/30 p-3"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false)
        setSuppressHover(false)
      }}
      onMouseDown={() => setPinned(true)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-base">{t('settings.apiServer')}</span>
        <div className="flex items-center gap-2">
          <span className={`mono text-xs ${status.running ? 'text-marker-green' : 'text-ink/45'}`}>
            {status.running
              ? t('settings.running', { p: status.port })
              : status.error
                ? t('settings.startFailed')
                : t('settings.stoppedPort', { p: status.port })}
          </span>
          <button
            onMouseDown={(e) => e.stopPropagation()} /* keep the box's pin-on-mousedown out of it */
            onClick={fold} /* click-driven so Enter/Space work too */
            aria-expanded={open}
            title={open ? t('settings.collapse') : t('settings.expand')}
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
      </div>

      <motion.div
        initial={false}
        // height:0 + overflow-hidden hides but does NOT unfocus — inert keeps the collapsed port
        // input / buttons out of the tab order so they can't be edited invisibly
        inert={!open}
        animate={open ? { height: 'auto', opacity: 1 } : { height: 0, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 24 }}
        className="overflow-hidden"
      >
        <div className="flex flex-col gap-2 pt-2">
          {status.error && <span className="text-xs text-marker-coral">{status.error}</span>}
          <label className="flex flex-col gap-1">
            <span className="text-sm opacity-70">{t('settings.port')}</span>
            <input
              className={`${fieldCls} mono w-32`}
              inputMode="numeric"
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
              onBlur={() => {
                const p = Math.min(65535, Math.max(1, Number(port) || 8788))
                setPort(String(p))
                update({ proxyPort: p })
              }}
            />
          </label>
          <span className="text-xs opacity-45">{t('settings.bindHint')}</span>
          <div className="mt-1 flex items-center gap-2">
            <DoodleButton variant={status.running ? 'danger' : 'primary'} disabled={busy} onClick={() => void toggle()}>
              {status.running ? t('settings.stop') : t('settings.start')}
            </DoodleButton>
          </div>
          <SettingRow label={t('settings.autostart')} hint={t('settings.autostartHint')}>
            <DoodleToggle
              label={t('settings.autostart')}
              checked={!!settings?.proxyAutoStart}
              onChange={(v) => update({ proxyAutoStart: v })}
            />
          </SettingRow>
        </div>
      </motion.div>
    </div>
  )
}

function LangSection(): JSX.Element {
  const lang = useStore((s) => s.lang)
  const setLang = useStore((s) => s.setLang)
  const t = useT()
  return (
    <SettingRow label={t('settings.language')}>
      <div className="doodle-edge flex gap-1 rounded-[10px] border-2 border-ink/40 p-1 text-sm">
        {(['zh', 'en'] as const).map((l) => (
          <button
            key={l}
            onClick={() => setLang(l)}
            className={`rounded-[7px] px-3 py-1 transition ${
              lang === l ? 'bg-marker-knot text-[#2B2B2B]' : 'hover:bg-ink/5'
            }`}
          >
            {l === 'zh' ? '中文' : 'English'}
          </button>
        ))}
      </div>
    </SettingRow>
  )
}

export function SettingsDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const t = useT()

  useEffect(() => {
    if (open) void api.query('settings.get', undefined).then(setSettings)
  }, [open])

  const update = (patch: Partial<AppSettings>): void => {
    setSettings((s) => (s ? { ...s, ...patch } : s))
    void api.command('settings.update', { patch }).then(setSettings)
  }

  return (
    <DialogShell open={open} onClose={onClose} title={t('settings.title')}>
      <LangSection />

      <ProxyServerSection settings={settings} update={update} />

      <SettingRow label={t('settings.background')} hint={t('settings.backgroundHint')}>
        <DoodleToggle
          label={t('settings.background')}
          checked={!!settings?.runInBackground}
          onChange={(v) => update({ runInBackground: v })}
        />
      </SettingRow>

      <SettingRow label={t('settings.launchAtLogin')} hint={t('settings.launchAtLoginHint')}>
        <DoodleToggle
          label={t('settings.launchAtLogin')}
          checked={!!settings?.launchAtLogin}
          onChange={(v) => update({ launchAtLogin: v })}
        />
      </SettingRow>

      <button
        onClick={onClose}
        className="mx-auto mt-2 block rounded-[8px] border-2 border-ink px-5 py-1 text-base hover:bg-marker-yellow/40"
      >
        {t('common.ok')}
      </button>
    </DialogShell>
  )
}
