import { useEffect, useState } from 'react'
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

/** Reverse-proxy server section: port, autostart, start/stop, and live state. */
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

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border-2 border-ink/30 p-3">
      <div className="flex items-center justify-between">
        <span className="text-base">{t('settings.apiServer')}</span>
        <span className={`mono text-xs ${status.running ? 'text-marker-green' : 'text-ink/45'}`}>
          {status.running
            ? t('settings.running', { p: status.port })
            : status.error
              ? t('settings.startFailed')
              : t('settings.stopped')}
        </span>
      </div>
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
