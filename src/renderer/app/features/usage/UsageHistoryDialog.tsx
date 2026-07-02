import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { UsageHistoryDays } from '@shared/types'
import { UNKNOWN_MODEL_KEY } from '@shared/types'
import { api } from '../../lib/bridge'
import { useStore } from '../../store'
import { useT } from '../../lib/i18n'
import { compact, grouped } from '../../lib/format'
import { DialogShell } from '../../components/DialogShell'

/**
 * Chart palettes validated with the dataviz six checks (CVD ΔE, lightness band, chroma, contrast)
 * against the card surfaces the dialog renders on (#FFFFFF light / #2A2420 dark). The categorical
 * slot ORDER is the colorblind-safety mechanism (chosen to maximize the worst adjacent CVD ΔE) —
 * never reorder or cycle it; models beyond 8 fold into a gray "other" so hues are never reused.
 */
const SERIES: Record<'paper' | 'dark', string[]> = {
  paper: ['#5B8DEF', '#E3A81C', '#2FAFA5', '#7BC950', '#9B6DFF', '#FF6B6B', '#E570CE', '#D97757'],
  dark: ['#5B8DEF', '#B5820C', '#1FA79B', '#55A02F', '#9B6DFF', '#E85555', '#D054B8', '#D06C4C']
}
const OTHER_COLOR = '#8A8781'
/** Sequential single-hue (green) ramp for the heatmap, per theme — light→dark = little→much. */
const HEAT: Record<'paper' | 'dark', string[]> = {
  paper: ['#C9E7B2', '#96CE6B', '#63AC3A', '#3D7E1E'],
  dark: ['#2E4A20', '#3E6A26', '#52912E', '#6FBE3F']
}

const CELL = 11 // heat cell / bar width
const PITCH = 13 // CELL + 2px surface gap
const HEAT_WEEKS = 27 // 26 full weeks + the current partial one ⇒ ≥183 days: “at least half a year”
const BAR_DAYS = 30
const TT_W = 220 // tooltip width

type ViewMode = 'heat' | 'bars'
const MODE_KEY = 'api-yes-usage-history-view'
const readMode = (): ViewMode => (localStorage.getItem(MODE_KEY) === 'bars' ? 'bars' : 'heat')

// ── local-day helpers (the ledger is keyed by LOCAL 'YYYY-MM-DD', matching the main process) ──
const dayKeyOf = (d: Date): string => {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const mondayOf = (d: Date): Date => addDays(d, -((d.getDay() + 6) % 7))

interface DayEntry {
  model: string
  label: string
  color: string
  tokens: number
  requests: number
}
interface DayInfo {
  key: string
  date: Date
  total: number
  requests: number
  entries: DayEntry[] // sorted by tokens desc; only models actually used that day
}
interface Tip {
  key: string
  left: number
  top: number
  info: DayInfo
}

export function UsageHistoryDialog({
  scope,
  id,
  name,
  open,
  onClose
}: {
  scope: 'credential' | 'proxy'
  id: string | null
  name: string
  open: boolean
  onClose: () => void
}): JSX.Element {
  const t = useT()
  const lang = useStore((s) => s.lang)
  const theme = useStore((s) => s.theme)
  const proxies = useStore((s) => s.proxies)
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US'

  const [days, setDays] = useState<UsageHistoryDays | null>(null)
  const [loading, setLoading] = useState(false)
  const [mode, setModeState] = useState<ViewMode>(readMode)
  const [tip, setTip] = useState<Tip | null>(null)
  // request token: only the latest in-flight fetch may apply (id switches / rapid refreshes)
  const reqRef = useRef(0)
  const proxiesRef = useRef(proxies)
  proxiesRef.current = proxies

  const setMode = (m: ViewMode): void => {
    localStorage.setItem(MODE_KEY, m)
    setTip(null)
    setModeState(m)
  }

  const load = async (): Promise<void> => {
    if (!id) return
    const myReq = ++reqRef.current
    setLoading(true)
    try {
      const r = await api.query('usage.history', { scope, id })
      if (myReq !== reqRef.current) return
      setDays(r.days)
    } catch {
      if (myReq === reqRef.current) setDays({})
    } finally {
      if (myReq === reqRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      setDays(null)
      setTip(null)
      // re-read the persisted view mode: another instance (credential vs proxy dialogs are separate
      // component instances) may have switched it since this one mounted
      setModeState(readMode())
      void load()
    }
    return () => {
      reqRef.current++
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id, scope])

  // live refresh: when a request is billed to this endpoint (or any endpoint of this credential),
  // re-pull the ledger after a short quiet period so an open dialog tracks usage as it happens
  useEffect(() => {
    if (!open || !id) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = api.on('proxy.usage', ({ proxyId }) => {
      const relevant =
        scope === 'proxy'
          ? proxyId === id
          : proxiesRef.current.some((p) => p.id === proxyId && p.credentialId === id)
      if (!relevant) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void load(), 400)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id, scope])

  // ── range + per-model stats for the CURRENT view (heat: 27 weeks; bars: 30 days) ──
  // day anchor: a per-minute tick while open — setState with the same key string is a React no-op,
  // so this re-renders exactly once, at local midnight, keeping a left-open dialog on today
  const [todayKey, setTodayKey] = useState(() => dayKeyOf(new Date()))
  useEffect(() => {
    if (!open) return
    setTodayKey(dayKeyOf(new Date()))
    const timer = setInterval(() => setTodayKey(dayKeyOf(new Date())), 60_000)
    return () => clearInterval(timer)
  }, [open])
  // 'YYYY-MM-DDT00:00:00' (no zone suffix) parses as LOCAL midnight
  const today = useMemo(() => new Date(`${todayKey}T00:00:00`), [todayKey])

  const gridStart = useMemo(() => addDays(mondayOf(today), -(HEAT_WEEKS - 1) * 7), [today])
  const rangeStart = mode === 'heat' ? gridStart : addDays(today, -(BAR_DAYS - 1))

  const stats = useMemo(() => {
    const per = new Map<string, { tokens: number; requests: number }>()
    let grandTokens = 0
    let grandReqs = 0
    let maxDayTotal = 0
    // step with addDays (fresh construction from date fields), NOT setDate mutation: in zones whose
    // DST gap starts at local midnight the mutated time sticks at 01:00 and the `<= today` (00:00)
    // comparison would silently drop today from the totals
    let cur = new Date(rangeStart)
    while (cur.getTime() <= today.getTime()) {
      const rec = days?.[dayKeyOf(cur)]
      if (rec) {
        let dayTotal = 0
        for (const [model, u] of Object.entries(rec)) {
          const tk = u.inputTokens + u.outputTokens
          const e = per.get(model) ?? { tokens: 0, requests: 0 }
          e.tokens += tk
          e.requests += u.requests
          per.set(model, e)
          grandTokens += tk
          grandReqs += u.requests
          dayTotal += tk
        }
        if (dayTotal > maxDayTotal) maxDayTotal = dayTotal
      }
      cur = addDays(cur, 1)
    }
    const ranked = [...per.entries()]
      .map(([model, e]) => ({ model, ...e }))
      .sort((a, b) => b.tokens - a.tokens)
    const slot = new Map(ranked.map((r, i) => [r.model, i]))
    return { ranked, slot, grandTokens, grandReqs, maxDayTotal }
  }, [days, rangeStart, today])

  const colorOf = (model: string): string => {
    const s = stats.slot.get(model)
    return s !== undefined && s < 8 ? SERIES[theme][s] : OTHER_COLOR
  }
  const labelOf = (model: string): string => (model === UNKNOWN_MODEL_KEY ? t('uh.unknownModel') : model)

  const dayInfo = (date: Date): DayInfo => {
    const key = dayKeyOf(date)
    const rec = days?.[key]
    const entries: DayEntry[] = rec
      ? Object.entries(rec)
          .map(([model, u]) => ({
            model,
            label: labelOf(model),
            color: colorOf(model),
            tokens: u.inputTokens + u.outputTokens,
            requests: u.requests
          }))
          .sort((a, b) => b.tokens - a.tokens)
      : []
    return {
      key,
      date,
      entries,
      total: entries.reduce((s, e) => s + e.tokens, 0),
      requests: entries.reduce((s, e) => s + e.requests, 0)
    }
  }

  /** Anchor the tooltip above (x, topY) in chart coords, clamped to the chart width; flip below
   *  the anchor when there is no room above. */
  const showTip = (info: DayInfo, anchorX: number, topY: number, svgW: number): void => {
    const rows = Math.max(1, info.entries.length)
    const estH = 40 + rows * 17 + (info.entries.length ? 23 : 0)
    let top = topY - estH - 6
    if (top < -4) top = topY + PITCH + 6
    setTip({
      key: info.key,
      left: Math.max(0, Math.min(anchorX - TT_W / 2, svgW - TT_W)),
      top,
      info
    })
  }

  const dateLabel = (d: Date): string =>
    d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' })

  const rangeLabel = mode === 'heat' ? t('uh.rangeHeat') : t('uh.rangeBars')

  return (
    <DialogShell open={open} onClose={onClose} title={t('uh.title')} width="w-[32rem]">
      {/* header: whose ledger + view-mode toggle */}
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-bold opacity-70" title={name}>
          {name}
        </span>
        <div className="doodle-edge flex shrink-0 gap-1 rounded-[10px] border-2 border-ink/40 p-1 text-sm">
          {(['heat', 'bars'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-[7px] px-3 py-0.5 transition ${
                mode === m ? 'bg-marker-knot text-[#2B2B2B]' : 'hover:bg-ink/5'
              }`}
            >
              {m === 'heat' ? t('uh.modeHeat') : t('uh.modeBars')}
            </button>
          ))}
        </div>
      </div>

      {days === null ? (
        <div className="py-10 text-center text-sm opacity-50">{t('common.loading')}</div>
      ) : (
        <motion.div
          key={mode}
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 320, damping: 20 }}
          className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}
        >
          {mode === 'heat' ? (
            <HeatGrid
              theme={theme}
              locale={locale}
              t={t}
              today={today}
              gridStart={gridStart}
              maxDayTotal={stats.maxDayTotal}
              dayInfo={dayInfo}
              tipKey={tip?.key}
              showTip={showTip}
              hideTip={() => setTip(null)}
              tip={tip}
              dateLabel={dateLabel}
            />
          ) : (
            <BarsChart
              t={t}
              locale={locale}
              today={today}
              maxDayTotal={stats.maxDayTotal}
              slot={stats.slot}
              dayInfo={dayInfo}
              tipKey={tip?.key}
              showTip={showTip}
              hideTip={() => setTip(null)}
              tip={tip}
              dateLabel={dateLabel}
            />
          )}

          {/* totals for the visible range: the grand total + every model's share. This list doubles
              as the chart legend (bar mode) and as the always-visible value channel the tooltips
              enhance — values here are reachable without hovering anything. */}
          <div className="mt-4 flex items-baseline justify-between gap-2">
            <span className="text-sm font-bold">
              {t('uh.total')} <span className="opacity-50">· {rangeLabel}</span>
            </span>
            <span className="mono text-base font-bold" title={`${grouped(stats.grandTokens)} tokens`}>
              {compact(stats.grandTokens)} tokens
              <span className="ml-2 text-xs font-normal opacity-50">{t('uh.reqs', { n: grouped(stats.grandReqs) })}</span>
            </span>
          </div>
          {stats.ranked.length === 0 ? (
            <div className="rounded-[10px] border-2 border-dashed border-ink/25 px-4 py-6 text-center text-sm opacity-50">
              {t('uh.empty')}
            </div>
          ) : (
            <div className="mt-1 flex flex-col gap-1">
              {stats.ranked.map((r) => (
                <div key={r.model} className="flex items-center gap-2 text-sm">
                  {mode === 'bars' && (
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                      style={{ background: colorOf(r.model) }}
                    />
                  )}
                  <span className="mono min-w-0 flex-1 truncate opacity-75" title={labelOf(r.model)}>
                    {labelOf(r.model)}
                  </span>
                  <span className="shrink-0 text-xs opacity-45">{t('uh.reqs', { n: grouped(r.requests) })}</span>
                  <span className="mono w-20 shrink-0 text-right font-bold" title={`${grouped(r.tokens)} tokens`}>
                    {compact(r.tokens)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </DialogShell>
  )
}

/** The shared hover tooltip card: date, one value-first row per model used that day, and a total. */
function TipCard({
  tip,
  t,
  dateLabel
}: {
  tip: Tip
  t: (k: string, v?: Record<string, string | number>) => string
  dateLabel: (d: Date) => string
}): JSX.Element {
  return (
    <div
      className="doodle-edge pointer-events-none absolute z-20 rounded-[8px] border-2 border-ink/70 bg-card px-2.5 py-2 shadow-doodle"
      style={{ left: tip.left, top: tip.top, width: TT_W }}
    >
      <div className="text-xs font-bold">{dateLabel(tip.info.date)}</div>
      {tip.info.entries.length === 0 ? (
        <div className="mt-1 text-xs opacity-50">{t('uh.noUsage')}</div>
      ) : (
        <>
          <div className="mt-1 flex flex-col gap-0.5">
            {tip.info.entries.map((e) => (
              <div key={e.model} className="flex items-center gap-1.5 text-xs">
                <span className="h-[3px] w-3 shrink-0 rounded-full" style={{ background: e.color }} />
                <span className="mono min-w-0 flex-1 truncate opacity-70">{e.label}</span>
                <span className="mono shrink-0 font-bold">{grouped(e.tokens)}</span>
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex items-center justify-between border-t border-ink/20 pt-1 text-xs">
            <span className="opacity-60">
              {t('uh.ttTotal')}
              <span className="ml-1.5 opacity-70">{t('uh.reqs', { n: tip.info.requests })}</span>
            </span>
            <span className="mono font-bold">{t('uh.tokensN', { n: grouped(tip.info.total) })}</span>
          </div>
        </>
      )}
    </div>
  )
}

/** GitHub-style contribution calendar: 27 Monday-first weeks, one green-ramp cell per local day. */
function HeatGrid({
  theme,
  locale,
  t,
  today,
  gridStart,
  maxDayTotal,
  dayInfo,
  tipKey,
  showTip,
  hideTip,
  tip,
  dateLabel
}: {
  theme: 'paper' | 'dark'
  locale: string
  t: (k: string, v?: Record<string, string | number>) => string
  today: Date
  gridStart: Date
  maxDayTotal: number
  dayInfo: (d: Date) => DayInfo
  tipKey: string | undefined
  showTip: (info: DayInfo, anchorX: number, topY: number, svgW: number) => void
  hideTip: () => void
  tip: Tip | null
  dateLabel: (d: Date) => string
}): JSX.Element {
  const LEFT = 30
  const TOP = 16
  const svgW = LEFT + HEAT_WEEKS * PITCH - (PITCH - CELL)
  const svgH = TOP + 7 * PITCH - (PITCH - CELL)
  const ramp = HEAT[theme]

  // month labels: mark each column whose Monday lands in a new month (skip cramped repeats);
  // labels on the last two columns anchor to the right edge so they can't clip past the SVG
  const monthLabels: { x: number; text: string; end: boolean }[] = []
  let lastMonth = -1
  let lastLabelCol = -10
  for (let w = 0; w < HEAT_WEEKS; w++) {
    const colDate = addDays(gridStart, w * 7)
    if (colDate.getMonth() !== lastMonth) {
      lastMonth = colDate.getMonth()
      if (w - lastLabelCol >= 3) {
        monthLabels.push({
          x: LEFT + w * PITCH,
          end: w >= HEAT_WEEKS - 2,
          text: colDate.toLocaleDateString(locale, { month: 'short' })
        })
        lastLabelCol = w
      }
    }
  }

  const cells: JSX.Element[] = []
  const hits: JSX.Element[] = []
  for (let w = 0; w < HEAT_WEEKS; w++) {
    for (let r = 0; r < 7; r++) {
      const date = addDays(gridStart, w * 7 + r)
      if (date.getTime() > today.getTime()) continue
      const info = dayInfo(date)
      const x = LEFT + w * PITCH
      const y = TOP + r * PITCH
      const level =
        info.total <= 0 || maxDayTotal <= 0
          ? -1
          : Math.min(3, Math.ceil((4 * info.total) / maxDayTotal) - 1)
      const active = tipKey === info.key
      cells.push(
        <rect
          key={info.key}
          x={x}
          y={y}
          width={CELL}
          height={CELL}
          rx={3}
          className={`${level < 0 ? 'fill-ink/10' : ''} ${active ? 'stroke-ink/70' : ''}`.trim() || undefined}
          fill={level < 0 ? undefined : ramp[level]}
          strokeWidth={active ? 1.5 : 0}
          pointerEvents="none"
        />
      )
      hits.push(
        <rect
          key={`h-${info.key}`}
          x={x - 1}
          y={y - 1}
          width={PITCH}
          height={PITCH}
          fill="transparent"
          onMouseEnter={() => showTip(info, x + CELL / 2, y, svgW)}
          onMouseLeave={hideTip}
        />
      )
    }
  }

  return (
    <div className="relative mx-auto mt-3" style={{ width: svgW }}>
      <svg width={svgW} height={svgH} className="block font-doodle">
        {monthLabels.map((m) => (
          <text
            key={m.x}
            x={m.end ? svgW : m.x}
            y={10}
            textAnchor={m.end ? 'end' : undefined}
            className="fill-ink/50 text-[9px]"
          >
            {m.text}
          </text>
        ))}
        {([0, 2, 4] as const).map((r) => (
          <text
            key={r}
            x={LEFT - 6}
            y={TOP + r * PITCH + CELL - 2}
            textAnchor="end"
            className="fill-ink/50 text-[9px]"
          >
            {t(r === 0 ? 'uh.dow.mon' : r === 2 ? 'uh.dow.wed' : 'uh.dow.fri')}
          </text>
        ))}
        {cells}
        {hits}
      </svg>
      {/* intensity legend */}
      <div className="mt-1.5 flex items-center justify-end gap-1 text-[10px] opacity-60">
        <span>{t('uh.less')}</span>
        <span className="h-[11px] w-[11px] rounded-[3px] bg-ink/10" />
        {ramp.map((c) => (
          <span key={c} className="h-[11px] w-[11px] rounded-[3px]" style={{ background: c }} />
        ))}
        <span>{t('uh.more')}</span>
      </div>
      {tip && <TipCard tip={tip} t={t} dateLabel={dateLabel} />}
    </div>
  )
}

/** Last-30-days stacked columns: one ≤24px bar per day, segments = models (2px surface gaps),
 *  rounded data-end on the top segment only, hairline gridlines with compact tick values. */
function BarsChart({
  t,
  locale,
  today,
  maxDayTotal,
  slot,
  dayInfo,
  tipKey,
  showTip,
  hideTip,
  tip,
  dateLabel
}: {
  t: (k: string, v?: Record<string, string | number>) => string
  locale: string
  today: Date
  maxDayTotal: number
  slot: Map<string, number>
  dayInfo: (d: Date) => DayInfo
  tipKey: string | undefined
  showTip: (info: DayInfo, anchorX: number, topY: number, svgW: number) => void
  hideTip: () => void
  tip: Tip | null
  dateLabel: (d: Date) => string
}): JSX.Element {
  const LEFT = 40
  const RIGHT = 4
  const TOP = 10
  const PLOT_H = 130
  const AXIS_H = 18
  const svgW = LEFT + BAR_DAYS * PITCH - (PITCH - CELL) + RIGHT
  const svgH = TOP + PLOT_H + AXIS_H
  const niceMax = niceCeil(maxDayTotal)
  const yOf = (tokens: number): number => TOP + PLOT_H * (1 - tokens / niceMax)

  const bars: JSX.Element[] = []
  const hits: JSX.Element[] = []
  for (let i = 0; i < BAR_DAYS; i++) {
    const date = addDays(today, i - (BAR_DAYS - 1))
    const info = dayInfo(date)
    const x = LEFT + i * PITCH
    if (info.total > 0) {
      // stack in fixed slot order, most-used model of the RANGE at the baseline — the same model
      // keeps the same color and position across all 30 days
      const segs = [...info.entries].sort(
        (a, b) => (slot.get(a.model) ?? 99) - (slot.get(b.model) ?? 99)
      )
      // models past the 8 hue slots merge into a single gray "other" segment (hues never cycle)
      const drawn: { color: string; tokens: number }[] = []
      for (const e of segs) {
        const s = slot.get(e.model) ?? 99
        if (s < 8) drawn.push({ color: e.color, tokens: e.tokens })
        else if (drawn.length && drawn[drawn.length - 1].color === OTHER_COLOR)
          drawn[drawn.length - 1].tokens += e.tokens
        else drawn.push({ color: OTHER_COLOR, tokens: e.tokens })
      }
      let yLow = TOP + PLOT_H
      drawn.forEach((seg, j) => {
        let h = (seg.tokens / niceMax) * PLOT_H
        if (j === drawn.length - 1) h = Math.max(h, 2) // a used day is always visible
        const yTop = yLow - h
        const last = j === drawn.length - 1
        // 2px surface gap above every non-top segment (skipped when the sliver is too thin to survive)
        const gapped = !last && h >= 4
        if (last) {
          bars.push(
            <path key={`${info.key}-${j}`} d={topRoundedRect(x, yTop, CELL, h, Math.min(3, h))} fill={seg.color} />
          )
        } else {
          bars.push(
            <rect
              key={`${info.key}-${j}`}
              x={x}
              y={gapped ? yTop + 2 : yTop}
              width={CELL}
              height={gapped ? h - 2 : h}
              fill={seg.color}
            />
          )
        }
        yLow = yTop
      })
      if (tipKey === info.key) {
        bars.push(
          <rect
            key={`ring-${info.key}`}
            x={x - 2}
            y={yLow - 2}
            width={CELL + 4}
            height={TOP + PLOT_H - yLow + 2}
            rx={4}
            fill="none"
            className="stroke-ink/60"
            strokeWidth={1.5}
          />
        )
      }
    }
    hits.push(
      <rect
        key={`h-${info.key}`}
        x={x - 1}
        y={TOP}
        width={PITCH}
        height={PLOT_H}
        fill="transparent"
        onMouseEnter={() => showTip(info, x + CELL / 2, info.total > 0 ? yOf(info.total) : TOP + PLOT_H - PITCH, svgW)}
        onMouseLeave={hideTip}
      />
    )
  }

  const xLabels: JSX.Element[] = []
  for (let i = 0; i < BAR_DAYS; i++) {
    if ((BAR_DAYS - 1 - i) % 5 !== 0) continue
    const date = addDays(today, i - (BAR_DAYS - 1))
    xLabels.push(
      <text
        key={i}
        x={LEFT + i * PITCH + CELL / 2}
        y={TOP + PLOT_H + 13}
        textAnchor="middle"
        className="mono fill-ink/50 text-[9px]"
      >
        {date.toLocaleDateString(locale, { month: 'numeric', day: 'numeric' })}
      </text>
    )
  }

  return (
    <div className="relative mx-auto mt-3" style={{ width: svgW }}>
      <svg width={svgW} height={svgH} className="block font-doodle">
        {/* hairline gridlines + compact tick values (they carry the values bars don't label) */}
        {[0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={LEFT - 2}
              x2={svgW - RIGHT}
              y1={yOf(niceMax * f)}
              y2={yOf(niceMax * f)}
              className="stroke-ink/15"
              strokeWidth={1}
            />
            <text x={LEFT - 6} y={yOf(niceMax * f) + 3} textAnchor="end" className="mono fill-ink/50 text-[9px]">
              {tickLabel(niceMax * f)}
            </text>
          </g>
        ))}
        {/* baseline */}
        <line
          x1={LEFT - 2}
          x2={svgW - RIGHT}
          y1={TOP + PLOT_H}
          y2={TOP + PLOT_H}
          className="stroke-ink/30"
          strokeWidth={1}
        />
        <text x={LEFT - 6} y={TOP + PLOT_H + 3} textAnchor="end" className="mono fill-ink/50 text-[9px]">
          0
        </text>
        {bars}
        {xLabels}
        {hits}
      </svg>
      {tip && <TipCard tip={tip} t={t} dateLabel={dateLabel} />}
    </div>
  )
}

/** Smallest "clean" axis max ≥ n: 1/2/2.5/5 × 10^k. */
function niceCeil(n: number): number {
  if (n <= 0) return 1000
  const pow = Math.pow(10, Math.floor(Math.log10(n)))
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * pow >= n) return m * pow
  }
  return 10 * pow
}

/** Exact axis-tick label — compact() would round the 2.5-family's midline (12,500 → "13k"),
 *  making the axis read 0 / 13k / 25k. Every niceCeil tick has ≤ 2 decimals, so this is exact. */
function tickLabel(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${parseFloat((n / 1000).toFixed(2))}k`
  return `${parseFloat((n / 1_000_000).toFixed(2))}M`
}

/** A rect path rounded ONLY at its top corners — the data-end of a column; square at the baseline. */
function topRoundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, h, w / 2))
  return [
    `M ${x} ${y + h}`,
    `L ${x} ${y + rr}`,
    `Q ${x} ${y} ${x + rr} ${y}`,
    `L ${x + w - rr} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + rr}`,
    `L ${x + w} ${y + h}`,
    'Z'
  ].join(' ')
}
