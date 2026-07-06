import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { UsageHistoryChildEntry, UsageHistoryDays } from '@shared/types'
import { LEGACY_MODEL_KEY, UNKNOWN_MODEL_KEY } from '@shared/types'
import { api } from '../../lib/bridge'
import { useStore } from '../../store'
import { useT } from '../../lib/i18n'
import { compact, grouped } from '../../lib/format'
import { DialogShell } from '../../components/DialogShell'
import { DoodleCalendar } from '../../components/doodle/DoodleCalendar'

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

// ── drag-to-pan tuning (simplified elastic drag: slop → PITCH-quantised steps → rubber-band) ──
const SLOP = 5 // px of pointer travel before a press becomes a pan (clicks/hovers stay cheap)
const MAX_OVER = 40 // px of rubber-band give past either end of the pannable range
/** Overscroll resistance: ~linear near 0, asymptotically approaching MAX_OVER — never a hard wall. */
const resist = (x: number): number => MAX_OVER * (1 - 1 / (x / MAX_OVER + 1))

type ViewMode = 'heat' | 'bars' | 'list'
const MODE_KEY = 'api-yes-usage-history-view'
const readMode = (): ViewMode => {
  const v = localStorage.getItem(MODE_KEY)
  return v === 'bars' || v === 'list' ? v : 'heat'
}

// ── local-day helpers (the ledger is keyed by LOCAL 'YYYY-MM-DD', matching the main process) ──
const dayKeyOf = (d: Date): string => {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const mondayOf = (d: Date): Date => addDays(d, -((d.getDay() + 6) % 7))
// 'YYYY-MM-DDT00:00:00' (no zone suffix) parses as LOCAL midnight
const parseKey = (key: string): Date => new Date(`${key}T00:00:00`)
const keyAddDays = (key: string, n: number): string => dayKeyOf(addDays(parseKey(key), n))
/** Whole days a → b; rounded so DST's 23/25-hour days can't skew the count. */
const dayDiff = (a: string, b: string): number =>
  Math.round((parseKey(b).getTime() - parseKey(a).getTime()) / 86_400_000)

type HistoryScope = 'app' | 'credential' | 'proxy'
/** One level of the drill-down stack: whose ledger the dialog currently shows. */
interface Frame {
  scope: HistoryScope
  id: string | null // null only for the app scope
  name: string
}

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

/** Pointer-pan wiring the parent hands each chart (handlers live up top; charts just attach). */
interface PanProps {
  className: string
  title: string | undefined
  svgRef: React.MutableRefObject<SVGSVGElement | null>
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerUp: () => void
  onPointerCancel: () => void
}

export function UsageHistoryDialog({
  scope,
  id,
  name,
  open,
  onClose
}: {
  scope: HistoryScope
  id: string | null
  name: string
  open: boolean
  onClose: () => void
}): JSX.Element {
  const t = useT()
  const lang = useStore((s) => s.lang)
  const theme = useStore((s) => s.theme)
  const proxies = useStore((s) => s.proxies)
  const toast = useStore((s) => s.toast)
  const askPrompt = useStore((s) => s.askPrompt)
  const askConfirm = useStore((s) => s.askConfirm)
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US'

  // ── drill-down navigation: a stack of frames, seeded from the entry-point props on open ──
  const [stack, setStack] = useState<Frame[]>([{ scope, id, name }])
  const current = stack[stack.length - 1]

  const [days, setDays] = useState<UsageHistoryDays | null>(null)
  const [children, setChildren] = useState<UsageHistoryChildEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [modeRaw, setModeState] = useState<ViewMode>(readMode)
  const [tip, setTip] = useState<Tip | null>(null)
  const [calOpen, setCalOpen] = useState(false)
  // 'list' needs children and an api key has none — fall back to 'heat' for proxy frames WITHOUT
  // overwriting the persisted preference (leaving a proxy frame restores the list)
  const mode: ViewMode = modeRaw === 'list' && current.scope === 'proxy' ? 'heat' : modeRaw
  // request token: only the latest in-flight fetch may apply (frame switches / rapid refreshes)
  const reqRef = useRef(0)
  const proxiesRef = useRef(proxies)
  proxiesRef.current = proxies

  const setMode = (m: ViewMode): void => {
    localStorage.setItem(MODE_KEY, m)
    setTip(null)
    setCalOpen(false)
    setModeState(m)
  }

  const load = async (frame: Frame): Promise<void> => {
    if (frame.scope !== 'app' && !frame.id) return
    const myReq = ++reqRef.current
    setLoading(true)
    try {
      const r = await api.query(
        'usage.history',
        frame.scope === 'app' ? { scope: 'app' } : { scope: frame.scope, id: frame.id! }
      )
      if (myReq !== reqRef.current) return
      setDays(r.days)
      setChildren(r.children ?? null)
    } catch {
      if (myReq === reqRef.current) {
        setDays({})
        setChildren(null)
      }
    } finally {
      if (myReq === reqRef.current) setLoading(false)
    }
  }

  /** Enter a frame (open-seed / drill-down / back): fresh, latest-anchored view, then load it. */
  const enterFrame = (frames: Frame[]): void => {
    setStack(frames)
    setDays(null)
    setChildren(null)
    setTip(null)
    setAnchorKey(null)
    setCalOpen(false)
    void load(frames[frames.length - 1])
  }
  const pushFrame = (f: Frame): void => enterFrame([...stack, f])
  const popFrame = (): void => {
    if (stack.length > 1) enterFrame(stack.slice(0, -1))
  }

  useEffect(() => {
    if (open) {
      // re-read the persisted view mode: another instance (the app / credential / proxy dialogs are
      // separate component instances) may have switched it since this one mounted
      setModeState(readMode())
      enterFrame([{ scope, id, name }])
    }
    return () => {
      reqRef.current++
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id, scope])

  // live refresh: when a request is billed to the CURRENT frame's scope (app = everything, else the
  // endpoint / any endpoint of the credential), re-pull the ledger after a short quiet period so an
  // open dialog tracks usage as it happens
  useEffect(() => {
    if (!open) return
    if (current.scope !== 'app' && !current.id) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = api.on('proxy.usage', ({ proxyId }) => {
      const relevant =
        current.scope === 'app'
          ? true // every billed request rolls up into the app ledger
          : current.scope === 'proxy'
            ? proxyId === current.id
            : proxiesRef.current.some((p) => p.id === proxyId && p.credentialId === current.id)
      if (!relevant) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void load(current), 400)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, current.scope, current.id])

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

  // ── pannable time window: the anchor is the day both charts END on. null = follow today, so the
  // midnight rollover above keeps working; any pan/jump landing exactly on today resets to null. ──
  const [anchorKey, setAnchorKey] = useState<string | null>(null)
  const anchorDayKey = anchorKey ?? todayKey
  const anchor = useMemo(() => parseKey(anchorDayKey), [anchorDayKey])

  // earliest pannable day: the oldest ledger key of the CURRENT frame (no data → panning disabled)
  const earliestDay = useMemo(() => {
    let min: string | null = null
    for (const k of Object.keys(days ?? {})) if (min === null || k < min) min = k
    return min
  }, [days])
  /** 'YYYY-MM-DD' sorts lexically, so clamping into [earliestDay, todayKey] is string comparison. */
  const clampDayKey = (key: string): string =>
    earliestDay && key < earliestDay ? earliestDay : key > todayKey ? todayKey : key

  const gridStart = useMemo(() => addDays(mondayOf(anchor), -(HEAT_WEEKS - 1) * 7), [anchor])
  const rangeStart = mode === 'heat' ? gridStart : addDays(anchor, -(BAR_DAYS - 1))

  const stats = useMemo(() => {
    const per = new Map<string, { tokens: number; requests: number }>()
    let grandTokens = 0
    let grandReqs = 0
    let maxDayTotal = 0
    // step with addDays (fresh construction from date fields), NOT setDate mutation: in zones whose
    // DST gap starts at local midnight the mutated time sticks at 01:00 and the `<= anchor` (00:00)
    // comparison would silently drop the anchor day from the totals
    let cur = new Date(rangeStart)
    while (cur.getTime() <= anchor.getTime()) {
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
  }, [days, rangeStart, anchor])

  const colorOf = (model: string): string => {
    const s = stats.slot.get(model)
    return s !== undefined && s < 8 ? SERIES[theme][s] : OTHER_COLOR
  }
  const labelOf = (model: string): string =>
    model === UNKNOWN_MODEL_KEY
      ? t('uh.unknownModel')
      : model === LEGACY_MODEL_KEY
        ? t('uh.legacyModel')
        : model

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

  // ── elastic drag-to-pan: each full PITCH of pointer travel shifts the anchor one step (heat: a
  // week / a column; bars: a day / a bar), so the columns follow the hand 1:1. The sub-step
  // remainder is a translateX written straight to the <svg> (no React re-render per frame); at a
  // range bound the excess feeds resist() and springs back on release — the Q弹 settle. ──
  const svgRef = useRef<SVGSVGElement | null>(null)
  const panXRef = useRef(0)
  const panRaf = useRef<number | undefined>(undefined)
  const panActiveRef = useRef(false) // suppresses hover tooltips while actually panning
  const dragRef = useRef<{ startX: number; active: boolean; startAnchor: string } | null>(null)
  const canPan = earliestDay !== null
  const daysPerStep = mode === 'heat' ? 7 : 1

  const setPanX = (x: number): void => {
    panXRef.current = x
    if (svgRef.current) svgRef.current.style.transform = x === 0 ? '' : `translateX(${x}px)`
  }
  useEffect(
    () => () => {
      if (panRaf.current !== undefined) cancelAnimationFrame(panRaf.current)
    },
    []
  )
  /** Spring the residual translateX back to 0 — underdamped, so it overshoots a touch and bounces. */
  const springBack = (): void => {
    if (panRaf.current !== undefined) cancelAnimationFrame(panRaf.current)
    let vel = 0
    const step = (): void => {
      vel = (vel + (0 - panXRef.current) * 0.18) * 0.62
      const next = panXRef.current + vel
      if (Math.abs(next) < 0.5 && Math.abs(vel) < 0.5) {
        setPanX(0)
        panRaf.current = undefined
        return
      }
      setPanX(next)
      panRaf.current = requestAnimationFrame(step)
    }
    panRaf.current = requestAnimationFrame(step)
  }

  const onPanDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!canPan || e.button !== 0) return
    if (panRaf.current !== undefined) {
      cancelAnimationFrame(panRaf.current)
      panRaf.current = undefined
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, active: false, startAnchor: anchorDayKey }
  }
  const onPanMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current
    if (!d) return
    let dx = e.clientX - d.startX
    if (!d.active) {
      if (Math.abs(dx) < SLOP) return // a press within the slop stays a plain click / hover
      d.active = true
      panActiveRef.current = true
      setTip(null)
      d.startX += Math.sign(dx) * SLOP // re-base so activation doesn't jump the content 5px
      dx = e.clientX - d.startX
    }
    // dragging RIGHT (positive dx) moves the window BACK in time — the content follows the hand.
    // The pin point is the exact px of real travel available toward the bound in this direction;
    // everything past it rubber-bands (resist starts at 0 there, so the hand-off is seamless)
    const boundKey = dx >= 0 ? earliestDay! : todayKey // canPan ⇒ earliestDay non-null
    const maxPx = (-dayDiff(d.startAnchor, boundKey) / daysPerStep) * PITCH // ≥0 right, ≤0 left
    if (dx >= 0 ? dx > maxPx : dx < maxPx) {
      setAnchorKey(boundKey >= todayKey ? null : boundKey)
      const over = dx - maxPx
      setPanX(Math.sign(over) * resist(Math.abs(over)))
    } else {
      const steps = Math.trunc(dx / PITCH)
      const next = clampDayKey(keyAddDays(d.startAnchor, -steps * daysPerStep))
      setAnchorKey(next >= todayKey ? null : next)
      setPanX(dx - steps * PITCH) // sub-step remainder: smooth glide between quantised steps
    }
  }
  const onPanUp = (): void => {
    if (!dragRef.current) return
    dragRef.current = null
    panActiveRef.current = false
    springBack()
  }
  const pan: PanProps = {
    className: canPan ? 'cursor-grab touch-none select-none active:cursor-grabbing' : '',
    title: canPan ? t('uh.dragHint') : undefined,
    svgRef,
    onPointerDown: onPanDown,
    onPointerMove: onPanMove,
    onPointerUp: onPanUp,
    onPointerCancel: onPanUp
  }

  /** Anchor the tooltip above (x, topY) in chart coords, clamped to the chart width; flip below
   *  the anchor when there is no room above. */
  const showTip = (info: DayInfo, anchorX: number, topY: number, svgW: number): void => {
    if (panActiveRef.current) return // no hover cards mid-pan
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

  // range annotation: the friendly relative label while following today; the explicit window
  // (start – anchor, year only when it isn't the current one) once panned back
  const shortDate = (d: Date): string =>
    d.toLocaleDateString(locale, {
      month: 'short',
      day: 'numeric',
      ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {})
    })
  const rangeLabel =
    anchorKey === null
      ? mode === 'heat'
        ? t('uh.rangeHeat')
        : t('uh.rangeBars')
      : `${shortDate(rangeStart)} – ${shortDate(anchor)}`

  // ── breakdown-list actions (app frame → credential entries; credential frame → api keys) ──
  const drillDown = (e: UsageHistoryChildEntry): void => {
    if (e.legacy) return // the surplus bucket has no ledger of its own
    pushFrame({ scope: current.scope === 'app' ? 'credential' : 'proxy', id: e.id, name: e.name })
  }
  const renameEntry = async (e: UsageHistoryChildEntry): Promise<void> => {
    const next = await askPrompt(t('uh.entryRenamePrompt'), e.name)
    if (next === null) return
    try {
      await api.command(
        'usage.history.renameEntry',
        current.scope === 'app'
          ? { credentialId: e.id, name: next }
          : { credentialId: current.id!, proxyId: e.id, name: next }
      )
      void load(current)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    }
  }
  const deleteEntry = async (e: UsageHistoryChildEntry): Promise<void> => {
    const label = e.legacy ? t('uh.legacyEntry') : e.name
    if (!(await askConfirm(t('uh.entryDeleteConfirm', { n: label })))) return
    try {
      await api.command(
        'usage.history.deleteEntry',
        e.legacy
          ? { kind: 'legacy', credentialId: current.scope === 'app' ? undefined : current.id! }
          : current.scope === 'app'
            ? { kind: 'credential', credentialId: e.id }
            : { kind: 'proxy', credentialId: current.id!, proxyId: e.id }
      )
      toast('success', t('uh.entryDeleted'))
      void load(current)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    }
  }

  const currentName = current.scope === 'app' ? t('uh.appTitle') : current.name
  const modes: ViewMode[] = current.scope === 'proxy' ? ['heat', 'bars'] : ['heat', 'bars', 'list']

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      title={current.scope === 'app' ? t('uh.appTitle') : t('uh.title')}
      width="w-[32rem]"
    >
      {/* header: whose ledger (+ back when drilled down) + time controls + view-mode toggle */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          {stack.length > 1 && (
            <button
              onClick={popFrame}
              className="shrink-0 rounded-[6px] border-2 border-ink/30 px-1.5 py-0.5 text-xs transition hover:bg-ink/5"
            >
              {t('uh.back')}
            </button>
          )}
          <span className="min-w-0 truncate text-sm font-bold opacity-70" title={currentName}>
            {currentName}
          </span>
        </div>
        <div className="relative flex shrink-0 items-center gap-1.5">
          {mode !== 'list' && anchorKey !== null && (
            <button
              onClick={() => {
                setAnchorKey(null)
                setTip(null)
              }}
              className="rounded-[6px] border-2 border-ink/30 px-1.5 py-0.5 text-xs transition hover:bg-ink/5"
            >
              {t('uh.backToNow')}
            </button>
          )}
          {mode !== 'list' && (
            <button
              title={t('uh.jumpDate')}
              disabled={!canPan}
              onClick={() => setCalOpen((v) => !v)}
              className="rounded-[7px] border-2 border-ink/30 px-1.5 py-0.5 text-sm transition enabled:hover:bg-ink/5 disabled:opacity-40"
            >
              📅
            </button>
          )}
          <div className="doodle-edge flex shrink-0 gap-1 rounded-[10px] border-2 border-ink/40 p-1 text-sm">
            {modes.map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-[7px] px-2.5 py-0.5 transition ${
                  mode === m ? 'bg-marker-knot text-[#2B2B2B]' : 'hover:bg-ink/5'
                }`}
              >
                {m === 'heat' ? t('uh.modeHeat') : m === 'bars' ? t('uh.modeBars') : t('uh.modeList')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* date-jump calendar: expands IN FLOW below the header (a floating popover would be clipped
          by DialogShell's overflow-y-auto body — the dialog card is content-sized) */}
      <AnimatePresence initial={false}>
        {calOpen && mode !== 'list' && (
          <motion.div
            key="cal"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ height: { type: 'spring', stiffness: 320, damping: 26 }, opacity: { duration: 0.15 } }}
            style={{ overflow: 'hidden' }}
          >
            <div className="doodle-edge mx-auto mt-1 w-64 rounded-[10px] border-2 border-ink/70 bg-card shadow-doodle">
              <DoodleCalendar
                value={anchorDayKey}
                minDay={earliestDay ?? undefined}
                maxDay={todayKey}
                onPick={(day) => {
                  setAnchorKey(day >= todayKey ? null : day)
                  setTip(null)
                  setCalOpen(false)
                }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
          {mode === 'list' ? (
            <BreakdownList
              entries={children ?? []}
              t={t}
              onOpen={drillDown}
              onRename={(e) => void renameEntry(e)}
              onDelete={(e) => void deleteEntry(e)}
            />
          ) : (
            <>
              {mode === 'heat' ? (
                <HeatGrid
                  theme={theme}
                  locale={locale}
                  t={t}
                  anchor={anchor}
                  gridStart={gridStart}
                  maxDayTotal={stats.maxDayTotal}
                  dayInfo={dayInfo}
                  tipKey={tip?.key}
                  showTip={showTip}
                  hideTip={() => setTip(null)}
                  tip={tip}
                  dateLabel={dateLabel}
                  pan={pan}
                />
              ) : (
                <BarsChart
                  t={t}
                  locale={locale}
                  anchor={anchor}
                  maxDayTotal={stats.maxDayTotal}
                  slot={stats.slot}
                  dayInfo={dayInfo}
                  tipKey={tip?.key}
                  showTip={showTip}
                  hideTip={() => setTip(null)}
                  tip={tip}
                  dateLabel={dateLabel}
                  pan={pan}
                />
              )}

              {/* totals for the visible range: the grand total + every model's share. This list
                  doubles as the chart legend (bar mode) and as the always-visible value channel the
                  tooltips enhance — values here are reachable without hovering anything. */}
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
            </>
          )}
        </motion.div>
      )}
    </DialogShell>
  )
}

/** 'list' view: one row per lower-level record (live + tombstoned + the legacy surplus bucket).
 *  Row body drills down (legacy rows aren't drillable); rename only exists on tombstoned rows —
 *  a live entry's name follows the entity itself. */
function BreakdownList({
  entries,
  t,
  onOpen,
  onRename,
  onDelete
}: {
  entries: UsageHistoryChildEntry[]
  t: (k: string, v?: Record<string, string | number>) => string
  onOpen: (e: UsageHistoryChildEntry) => void
  onRename: (e: UsageHistoryChildEntry) => void
  onDelete: (e: UsageHistoryChildEntry) => void
}): JSX.Element {
  if (entries.length === 0) {
    return (
      <div className="mt-3 rounded-[10px] border-2 border-dashed border-ink/25 px-4 py-6 text-center text-sm opacity-50">
        {t('uh.listEmpty')}
      </div>
    )
  }
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <div className="text-xs opacity-50">{t('uh.listHint')}</div>
      {entries.map((e) => {
        const label = e.legacy ? t('uh.legacyEntry') : e.name
        return (
          <div
            key={e.id}
            onClick={e.legacy ? undefined : () => onOpen(e)}
            className={`doodle-edge flex items-center gap-2 rounded-[8px] border-2 border-ink/25 px-3 py-2 transition ${
              e.legacy ? '' : 'cursor-pointer hover:border-ink/60'
            }`}
          >
            <span
              className={`min-w-0 flex-1 truncate text-sm font-bold ${e.legacy ? 'italic opacity-60' : ''}`}
              title={label}
            >
              {label}
              {e.deleted && (
                <span className="ml-1.5 inline-block rounded border border-ink/30 px-1 align-middle text-[10px] font-normal opacity-60">
                  {t('uh.deletedTag')}
                </span>
              )}
            </span>
            <span className="shrink-0 text-right">
              <span
                className="mono text-sm font-bold"
                title={`${grouped(e.totals.inputTokens + e.totals.outputTokens)} tokens`}
              >
                {compact(e.totals.inputTokens + e.totals.outputTokens)} tokens
              </span>
              <span className="ml-2 text-xs opacity-45">{t('uh.reqs', { n: grouped(e.totals.requests) })}</span>
            </span>
            {e.deleted && (
              <button
                title={t('uh.entryRenamePrompt')}
                onClick={(ev) => {
                  ev.stopPropagation()
                  onRename(e)
                }}
                className="shrink-0 rounded-[6px] border-2 border-ink/30 px-1.5 py-0.5 text-xs transition hover:bg-ink/5"
              >
                ✏️
              </button>
            )}
            <button
              onClick={(ev) => {
                ev.stopPropagation()
                onDelete(e)
              }}
              className="shrink-0 rounded-[6px] border-2 border-marker-coral/60 px-1.5 py-0.5 text-xs text-marker-coral transition hover:bg-marker-coral/10"
            >
              🗑
            </button>
          </div>
        )
      })}
    </div>
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

/** GitHub-style contribution calendar: 27 Monday-first weeks of green-ramp cells, ENDING on the
 *  anchor day (today unless panned back) — cells beyond the anchor are simply skipped. */
function HeatGrid({
  theme,
  locale,
  t,
  anchor,
  gridStart,
  maxDayTotal,
  dayInfo,
  tipKey,
  showTip,
  hideTip,
  tip,
  dateLabel,
  pan
}: {
  theme: 'paper' | 'dark'
  locale: string
  t: (k: string, v?: Record<string, string | number>) => string
  anchor: Date
  gridStart: Date
  maxDayTotal: number
  dayInfo: (d: Date) => DayInfo
  tipKey: string | undefined
  showTip: (info: DayInfo, anchorX: number, topY: number, svgW: number) => void
  hideTip: () => void
  tip: Tip | null
  dateLabel: (d: Date) => string
  pan: PanProps
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
      if (date.getTime() > anchor.getTime()) continue
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
    <div
      className={`relative mx-auto mt-3 ${pan.className}`}
      style={{ width: svgW }}
      title={pan.title}
      onPointerDown={pan.onPointerDown}
      onPointerMove={pan.onPointerMove}
      onPointerUp={pan.onPointerUp}
      onPointerCancel={pan.onPointerCancel}
    >
      <svg ref={pan.svgRef} width={svgW} height={svgH} className="block font-doodle">
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

/** 30-day stacked columns ENDING on the anchor day: one ≤24px bar per day, segments = models (2px
 *  surface gaps), rounded data-end on the top segment only, hairline gridlines + compact ticks. */
function BarsChart({
  t,
  locale,
  anchor,
  maxDayTotal,
  slot,
  dayInfo,
  tipKey,
  showTip,
  hideTip,
  tip,
  dateLabel,
  pan
}: {
  t: (k: string, v?: Record<string, string | number>) => string
  locale: string
  anchor: Date
  maxDayTotal: number
  slot: Map<string, number>
  dayInfo: (d: Date) => DayInfo
  tipKey: string | undefined
  showTip: (info: DayInfo, anchorX: number, topY: number, svgW: number) => void
  hideTip: () => void
  tip: Tip | null
  dateLabel: (d: Date) => string
  pan: PanProps
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
    const date = addDays(anchor, i - (BAR_DAYS - 1))
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
    const date = addDays(anchor, i - (BAR_DAYS - 1))
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
    <div
      className={`relative mx-auto mt-3 ${pan.className}`}
      style={{ width: svgW }}
      title={pan.title}
      onPointerDown={pan.onPointerDown}
      onPointerMove={pan.onPointerMove}
      onPointerUp={pan.onPointerUp}
      onPointerCancel={pan.onPointerCancel}
    >
      <svg ref={pan.svgRef} width={svgW} height={svgH} className="block font-doodle">
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
