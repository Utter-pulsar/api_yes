import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { UsageWindow } from '@shared/types'
import { api } from '../../lib/bridge'
import { useT } from '../../lib/i18n'
import { DialogShell } from '../../components/DialogShell'
import { DoodleButton } from '../../components/doodle/DoodleButton'

/** Stable window key → localized label. Unknown keys fall back to the window's own `label`/key. */
const WIN_LABEL_KEY: Record<string, string> = {
  '5h': 'usage.win.5h',
  weekly: 'usage.win.weekly',
  weekly_opus: 'usage.win.weekly_opus',
  weekly_sonnet: 'usage.win.weekly_sonnet'
}

type T = (key: string, vars?: Record<string, string | number>) => string

/** A bilingual, compact "Xd Yh" / "X 天 Y 小时" duration for a future reset. */
function formatDur(ms: number, t: T): string {
  const totalMin = Math.max(1, Math.floor(ms / 60_000))
  const d = Math.floor(totalMin / 1440)
  const h = Math.floor((totalMin % 1440) / 60)
  const m = totalMin % 60
  const parts: string[] = []
  if (d > 0) {
    parts.push(t('usage.dur.d', { n: d }))
    if (h > 0) parts.push(t('usage.dur.h', { n: h }))
  } else if (h > 0) {
    parts.push(t('usage.dur.h', { n: h }))
    if (m > 0) parts.push(t('usage.dur.m', { n: m }))
  } else {
    parts.push(t('usage.dur.m', { n: m }))
  }
  return parts.join(' ')
}

/** One window as a labelled, Q-bouncy progress bar with its percent + reset time. */
function UsageBar({ win, index }: { win: UsageWindow; index: number }): JSX.Element {
  const t = useT()
  const label = WIN_LABEL_KEY[win.key] ? t(WIN_LABEL_KEY[win.key]) : (win.label ?? win.key)
  const pct = Math.max(0, Math.min(100, Math.round(win.percent)))
  const color = pct >= 90 ? 'bg-marker-coral' : pct >= 70 ? 'bg-marker-yellow' : 'bg-marker-green'
  const resetIn = win.resetsAt ? win.resetsAt - Date.now() : undefined

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-bold">{label}</span>
        <span className="mono text-base font-bold">{pct}%</span>
      </div>
      <div className="doodle-edge mt-1.5 h-3 overflow-hidden rounded-full border-2 border-ink/40">
        <motion.div
          className={`h-full rounded-full ${color}`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 16, delay: 0.06 + index * 0.08 }}
        />
      </div>
      {resetIn !== undefined && resetIn > 0 && (
        <div className="mt-1 text-right text-xs opacity-50">
          {t('usage.resetIn', { t: formatDur(resetIn, t) })}
        </div>
      )}
    </div>
  )
}

/**
 * Subscription quota panel for an OAuth credential. Pops with the shared Q-bouncy DialogShell and
 * shows each rate-limit window (5h / weekly / per-model weekly for Anthropic) as a spring-filled
 * progress bar + percentage. Fully bilingual: labels come from the window key via i18n.
 */
export function UsageDialog({
  credentialId,
  open,
  onClose
}: {
  credentialId: string | null
  open: boolean
  onClose: () => void
}): JSX.Element {
  const t = useT()
  const [loading, setLoading] = useState(false)
  const [windows, setWindows] = useState<UsageWindow[]>([])
  const [message, setMessage] = useState('')
  const [ok, setOk] = useState(true)
  // monotonically-increasing request token: a fetch only applies its result if it's still the
  // latest one started. Switching credential (or a manual Refresh) bumps it, so a slow/out-of-order
  // response for a previous credential can never overwrite the panel for the current one.
  const reqRef = useRef(0)

  const load = async (): Promise<void> => {
    if (!credentialId) return
    const myReq = ++reqRef.current
    setLoading(true)
    try {
      const r = await api.command('credentials.usage', { id: credentialId })
      if (myReq !== reqRef.current) return
      setWindows(r.windows)
      setOk(r.ok)
      setMessage(r.message ?? '')
    } catch (e) {
      if (myReq !== reqRef.current) return
      setOk(false)
      setWindows([])
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      if (myReq === reqRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      setWindows([])
      setMessage('')
      setOk(true)
      void load()
    }
    // invalidate any in-flight request when the credential changes or the dialog closes
    return () => {
      reqRef.current++
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, credentialId])

  return (
    <DialogShell open={open} onClose={onClose} title={t('usage.title')} width="w-[24rem]">
      <div className="flex items-center justify-between">
        <span className={`text-sm ${ok ? 'opacity-60' : 'text-marker-coral'}`}>
          {loading ? t('usage.loading') : ok ? t('usage.subtitle') : message || t('usage.empty')}
        </span>
        <DoodleButton variant="ghost" className="text-sm" disabled={loading} onClick={() => void load()}>
          ↻ {t('common.refresh')}
        </DoodleButton>
      </div>

      {windows.length > 0 ? (
        <div className="flex flex-col gap-4 pt-2">
          {windows.map((w, i) => (
            <UsageBar key={w.key} win={w} index={i} />
          ))}
        </div>
      ) : (
        <div className="py-8 text-center text-sm opacity-50">
          {loading ? t('usage.loading') : ok ? t('usage.empty') : message || t('usage.empty')}
        </div>
      )}
    </DialogShell>
  )
}
