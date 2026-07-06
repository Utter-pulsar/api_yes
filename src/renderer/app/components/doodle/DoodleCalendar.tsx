import { useState } from 'react'
import { useStore } from '../../store'
import { useT } from '../../lib/i18n'

// Sunday-first, matching the grid's use of Date.getDay() offsets.
const DOW_KEYS = [
  'cal.dow.sun',
  'cal.dow.mon',
  'cal.dow.tue',
  'cal.dow.wed',
  'cal.dow.thu',
  'cal.dow.fri',
  'cal.dow.sat'
] as const

// ── local-day helpers ──
// Day keys are LOCAL zero-padded 'YYYY-MM-DD', matching the usage ledger's dayKey semantics.
// Never Date.toISOString here — that would shift days across timezones.
const pad2 = (n: number): string => String(n).padStart(2, '0')
const keyOf = (y: number, m: number, d: number): string => `${y}-${pad2(m + 1)}-${pad2(d)}`
const todayKeyOf = (): string => {
  const now = new Date()
  return keyOf(now.getFullYear(), now.getMonth(), now.getDate())
}
/** 'YYYY-MM-DD' sorts lexically, so range checks and clamping are plain string comparisons. */
const clampKey = (key: string, min?: string, max?: string): string => {
  if (min && key < min) return min
  if (max && key > max) return max
  return key
}
const monthOf = (key: string): { y: number; m: number } | null => {
  const hit = /^(\d{4})-(\d{2})-\d{2}$/.exec(key)
  return hit ? { y: Number(hit[1]), m: Number(hit[2]) - 1 } : null
}

/**
 * Hand-drawn month-grid day picker (no native <input type="date">). Calendar math runs on
 * plain integer {y, m, d} in LOCAL time; `onPick` receives a local 'YYYY-MM-DD' key. Width
 * is driven by the parent so it can be full-width inside a dialog row.
 */
export function DoodleCalendar({
  value,
  onPick,
  minDay,
  maxDay,
  className = ''
}: {
  /** selected day 'YYYY-MM-DD' (LOCAL); also the initially shown month */
  value?: string
  onPick: (day: string) => void
  /** inclusive clamp; days outside are disabled (dimmed, unclickable) */
  minDay?: string
  maxDay?: string
  className?: string
}): JSX.Element {
  const t = useT()
  const lang = useStore((s) => s.lang)

  const [view, setView] = useState<{ y: number; m: number }>(() => {
    const init = monthOf(clampKey(value ?? todayKeyOf(), minDay, maxDay))
    if (init) return init
    const now = new Date()
    return { y: now.getFullYear(), m: now.getMonth() }
  })
  const { y, m } = view

  const todayKey = todayKeyOf()
  const firstDow = new Date(y, m, 1).getDay()
  const daysInMonth = new Date(y, m + 1, 0).getDate()

  const cells: (number | null)[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  // Nav disables when the WHOLE adjacent month is out of range.
  const prevLast = new Date(y, m, 0)
  const nextFirst = new Date(y, m + 1, 1)
  const prevDisabled =
    !!minDay && keyOf(prevLast.getFullYear(), prevLast.getMonth(), prevLast.getDate()) < minDay
  const nextDisabled =
    !!maxDay && keyOf(nextFirst.getFullYear(), nextFirst.getMonth(), 1) > maxDay

  const goMonth = (delta: number): void => {
    const d = new Date(y, m + delta, 1)
    setView({ y: d.getFullYear(), m: d.getMonth() })
  }
  const pickToday = (): void => {
    const key = clampKey(todayKey, minDay, maxDay)
    const mo = monthOf(key)
    if (mo) setView(mo)
    onPick(key)
  }

  const title = new Date(y, m, 1).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'long'
  })

  return (
    <div className={`space-y-2 p-3 font-doodle text-ink ${className}`}>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => goMonth(-1)}
          disabled={prevDisabled}
          aria-label={t('cal.prevMonth')}
          title={t('cal.prevMonth')}
          className="h-7 w-7 rounded-[8px] enabled:hover:bg-ink/10 disabled:opacity-40"
        >
          ‹
        </button>
        <span className="font-bold">{title}</span>
        <button
          type="button"
          onClick={() => goMonth(1)}
          disabled={nextDisabled}
          aria-label={t('cal.nextMonth')}
          title={t('cal.nextMonth')}
          className="h-7 w-7 rounded-[8px] enabled:hover:bg-ink/10 disabled:opacity-40"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs opacity-50">
        {DOW_KEYS.map((k) => (
          <div key={k}>{t(k)}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (d === null) return <div key={`b${i}`} />
          const key = keyOf(y, m, d)
          const out = (!!minDay && key < minDay) || (!!maxDay && key > maxDay)
          const isSel = key === value
          const isToday = key === todayKey
          // marker bg stays a light accent in BOTH themes → fixed dark text/border for contrast
          const tone = isSel
            ? 'border-[#2B2B2B] bg-marker-knot text-[#2B2B2B]'
            : isToday
              ? 'border-dashed border-ink/50'
              : 'border-transparent'
          const state = out ? 'opacity-40' : isSel ? '' : 'hover:bg-ink/5'
          return (
            <button
              key={d}
              type="button"
              disabled={out}
              onClick={() => onPick(key)}
              className={`h-8 rounded-[8px] border-2 text-sm transition-colors ${tone} ${state}`}
            >
              {d}
            </button>
          )
        })}
      </div>

      <button
        type="button"
        onClick={pickToday}
        className="w-full rounded-[8px] py-1 text-xs opacity-60 hover:bg-ink/5 hover:opacity-100"
      >
        {t('cal.today')}
      </button>
    </div>
  )
}
