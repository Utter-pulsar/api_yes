import { useEffect, useRef, useState } from 'react'
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
const YEAR_MIN = 1
const YEAR_MAX = 9999
const YEAR_ITEM_W = 54
const YEAR_RADIUS = 4

// ── local-day helpers ──
// Day keys are LOCAL zero-padded 'YYYY-MM-DD', matching the usage ledger's dayKey semantics.
// Never Date.toISOString here — that would shift days across timezones.
const pad2 = (n: number): string => String(n).padStart(2, '0')
const clampYear = (y: number): number => Math.max(YEAR_MIN, Math.min(YEAR_MAX, y))
const localDate = (y: number, m: number, d: number): Date => {
  const date = new Date(0)
  date.setFullYear(clampYear(y), m, d)
  date.setHours(0, 0, 0, 0)
  return date
}
const keyOf = (y: number, m: number, d: number): string => `${String(clampYear(y)).padStart(4, '0')}-${pad2(m + 1)}-${pad2(d)}`
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
  rangeStart,
  rangeEnd,
  className = ''
}: {
  /** selected day 'YYYY-MM-DD' (LOCAL); also the initially shown month */
  value?: string
  onPick: (day: string) => void
  /** inclusive clamp; days outside are disabled (dimmed, unclickable) */
  minDay?: string
  maxDay?: string
  /** optional inclusive highlighted window */
  rangeStart?: string
  rangeEnd?: string
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
  const [yearOpen, setYearOpen] = useState(false)
  const [yearDragX, setYearDragX] = useState(0)
  const [yearSettling, setYearSettling] = useState(false)
  const yearDragRef = useRef<{ startX: number; baseYear: number } | null>(null)
  const settleTimerRef = useRef<number | undefined>(undefined)
  const { y, m } = view

  useEffect(() => {
    const next = monthOf(clampKey(value ?? todayKeyOf(), minDay, maxDay))
    if (!next) return
    setView((prev) => (prev.y === next.y && prev.m === next.m ? prev : next))
  }, [maxDay, minDay, value])

  useEffect(
    () => () => {
      if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current)
    },
    []
  )

  const todayKey = todayKeyOf()
  const firstDow = localDate(y, m, 1).getDay()
  const daysInMonth = localDate(y, m + 1, 0).getDate()

  const cells: (number | null)[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  // Nav disables when the WHOLE adjacent month is out of range, or when the year would exceed the
  // lexical day-key format the ledger uses.
  const prevLast = localDate(y, m, 0)
  const nextFirst = localDate(y, m + 1, 1)
  const prevDisabled =
    y <= YEAR_MIN && m === 0
      ? true
      : !!minDay && keyOf(prevLast.getFullYear(), prevLast.getMonth(), prevLast.getDate()) < minDay
  const nextDisabled =
    y >= YEAR_MAX && m === 11 ? true : !!maxDay && keyOf(nextFirst.getFullYear(), nextFirst.getMonth(), 1) > maxDay

  const goMonth = (delta: number): void => {
    const d = localDate(y, m + delta, 1)
    if (d.getFullYear() < YEAR_MIN || d.getFullYear() > YEAR_MAX) return
    setView({ y: d.getFullYear(), m: d.getMonth() })
  }
  const pickToday = (): void => {
    const key = clampKey(todayKey, minDay, maxDay)
    const mo = monthOf(key)
    if (mo) setView(mo)
    setYearOpen(false)
    onPick(key)
  }

  const title = localDate(y, m, 1).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'long'
  })
  const years = Array.from({ length: YEAR_RADIUS * 2 + 1 }, (_, i) => {
    const year = y + i - YEAR_RADIUS
    return year < YEAR_MIN || year > YEAR_MAX ? null : year
  })

  const settleYearTrack = (): void => {
    setYearSettling(true)
    setYearDragX(0)
    if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current)
    settleTimerRef.current = window.setTimeout(() => setYearSettling(false), 160)
  }
  const onYearDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current)
    setYearSettling(false)
    e.currentTarget.setPointerCapture(e.pointerId)
    yearDragRef.current = { startX: e.clientX, baseYear: y }
  }
  const onYearMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = yearDragRef.current
    if (!d) return
    const dx = e.clientX - d.startX
    const steps = Math.round(dx / YEAR_ITEM_W)
    const nextYear = clampYear(d.baseYear - steps)
    if (nextYear !== view.y) setView((prev) => ({ ...prev, y: nextYear }))
    setYearDragX(dx - (d.baseYear - nextYear) * YEAR_ITEM_W)
  }
  const onYearUp = (): void => {
    if (!yearDragRef.current) return
    yearDragRef.current = null
    settleYearTrack()
  }

  return (
    <div className={`space-y-2 p-3 font-doodle text-ink ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => goMonth(-1)}
          disabled={prevDisabled}
          aria-label={t('cal.prevMonth')}
          title={t('cal.prevMonth')}
          className="h-7 w-7 shrink-0 rounded-[8px] enabled:hover:bg-ink/10 disabled:opacity-40"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => setYearOpen((open) => !open)}
          title={t('cal.pickYear')}
          className="min-w-0 flex-1 rounded-[8px] px-2 py-1 text-center font-bold transition hover:bg-ink/5"
        >
          <span className="truncate">{title}</span>
        </button>
        <button
          type="button"
          onClick={() => goMonth(1)}
          disabled={nextDisabled}
          aria-label={t('cal.nextMonth')}
          title={t('cal.nextMonth')}
          className="h-7 w-7 shrink-0 rounded-[8px] enabled:hover:bg-ink/10 disabled:opacity-40"
        >
          ›
        </button>
      </div>

      {yearOpen && (
        <div className="doodle-edge space-y-1 rounded-[10px] border-2 border-ink/25 bg-ink/5 p-2">
          <div className="text-center text-[11px] opacity-55">{t('cal.pickYear')}</div>
          <div
            className="relative overflow-hidden rounded-[8px]"
            onPointerDown={onYearDown}
            onPointerMove={onYearMove}
            onPointerUp={onYearUp}
            onPointerCancel={onYearUp}
          >
            <div className="pointer-events-none absolute inset-y-0 left-1/2 z-10 w-[54px] -translate-x-1/2 rounded-[8px] border-2 border-ink/25 bg-card/75" />
            <div className="touch-none select-none">
              <div
                className={`flex items-center justify-center ${yearSettling ? 'transition-transform duration-150 ease-out' : ''}`}
                style={{ transform: `translateX(${yearDragX}px)` }}
              >
                {years.map((year, i) =>
                  year === null ? (
                    <div key={`blank-${i}`} className="h-8 w-[54px] shrink-0" />
                  ) : (
                    <button
                      key={year}
                      type="button"
                      onClick={() => setView((prev) => ({ ...prev, y: year }))}
                      className={`h-8 w-[54px] shrink-0 rounded-[8px] text-sm transition ${year === y ? 'font-bold opacity-100' : 'opacity-55 hover:opacity-90'}`}
                    >
                      {year}
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      )}

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
          const inRange = !!rangeStart && !!rangeEnd && key >= rangeStart && key <= rangeEnd
          const isSel = key === value
          const isToday = key === todayKey
          const isStart = key === rangeStart || (!rangeStart && isSel)
          const isEnd = key === rangeEnd
          // marker bg stays a light accent in BOTH themes → fixed dark text/border for contrast.
          // Range middles are lighter so the picked start day still reads as the main handle.
          const tone = isStart
            ? 'border-[#2B2B2B] bg-marker-knot text-[#2B2B2B]'
            : isEnd
              ? 'border-ink/35 bg-marker-knot/35 text-ink'
              : inRange
                ? 'border-transparent bg-marker-knot/20'
                : isToday
                  ? 'border-dashed border-ink/50'
                  : 'border-transparent'
          const state = out ? 'opacity-40' : isStart ? '' : 'hover:bg-ink/5'
          return (
            <button
              key={d}
              type="button"
              disabled={out}
              onClick={() => {
                setYearOpen(false)
                onPick(key)
              }}
              aria-current={isToday ? 'date' : undefined}
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
