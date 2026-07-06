import { useEffect, useRef } from 'react'

// Underdamped width spring → a little overshoot on settle (the Q弹 feel).
const STIFF = 0.2
const DAMP = 0.72

export interface SpringyWidthOptions {
  /** Width applied on mount (also render as `style={{ width }}` so there is no flash). */
  initial: number
  /** Clamp range for DRAG targets only — animateTo() may go outside (e.g. a collapsed rail). */
  min: number
  max: number
  /** Fired once the spring settles, with the rounded final width (persist here). */
  onSettle?: (w: number) => void
}

export interface SpringyWidth {
  /** Attach to the element whose width the spring drives. */
  ref: React.MutableRefObject<HTMLElement | null>
  /** pointerdown handler for a resize handle on the element's RIGHT edge. */
  startResize: (e: React.PointerEvent) => void
  /** Spring to a width programmatically (collapse / expand). */
  animateTo: (w: number) => void
  /** The live (possibly mid-animation) width — for callers that must commit it out-of-band. */
  getWidth: () => number
}

/**
 * Drag-resizable width with a springy settle. The width is written by DIRECT DOM mutation each
 * frame (never React state), so the element tracks the cursor 1:1 with zero re-renders; callers
 * commit state/storage in `onSettle`. Only `style.width` is touched — never a transform — so
 * position:fixed descendants (dialogs, context menus) keep their viewport coordinates.
 */
export function useSpringyWidth(opts: SpringyWidthOptions): SpringyWidth {
  const { min, max } = opts
  const ref = useRef<HTMLElement | null>(null)
  const widthRef = useRef(opts.initial)
  const target = useRef(opts.initial)
  const vel = useRef(0)
  const raf = useRef<number | undefined>(undefined)
  const dragging = useRef(false)
  const onSettle = useRef(opts.onSettle)
  onSettle.current = opts.onSettle
  // teardown of an in-flight drag (window listeners + dragging flag); also run on unmount so a
  // mid-gesture unmount (e.g. an ErrorBoundary swap) can't leak listeners that keep resizing
  const cleanupDrag = useRef<(() => void) | null>(null)
  useEffect(
    () => () => {
      cleanupDrag.current?.()
      if (raf.current !== undefined) cancelAnimationFrame(raf.current)
    },
    []
  )

  const apply = (w: number): void => {
    widthRef.current = w
    if (ref.current) ref.current.style.width = `${w}px`
  }
  const springStep = (): void => {
    vel.current = (vel.current + (target.current - widthRef.current) * STIFF) * DAMP
    apply(widthRef.current + vel.current)
    const settled =
      !dragging.current &&
      Math.abs(target.current - widthRef.current) < 0.4 &&
      Math.abs(vel.current) < 0.4
    if (settled) {
      apply(Math.round(target.current))
      vel.current = 0
      raf.current = undefined
      onSettle.current?.(widthRef.current)
      return
    }
    raf.current = requestAnimationFrame(springStep)
  }
  const kick = (): void => {
    if (raf.current === undefined) raf.current = requestAnimationFrame(springStep)
  }

  const startResize = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    // capture the pointer so the gesture stays ours; the handle element also needs CSS
    // touch-action:none (Tailwind `touch-none`) or touch input pans instead of resizing
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    const startX = e.clientX
    const startW = widthRef.current
    cleanupDrag.current?.()
    dragging.current = true
    const move = (ev: PointerEvent): void => {
      target.current = Math.max(min, Math.min(max, startW + (ev.clientX - startX)))
      kick()
    }
    const end = (): void => {
      cleanupDrag.current?.()
      kick() // let the spring settle (and fire onSettle) after release
    }
    cleanupDrag.current = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      dragging.current = false
      cleanupDrag.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    // the browser can end the gesture with pointercancel instead of pointerup (touch pans,
    // window drags) — without this the listeners leak and the width tracks a released pointer
    window.addEventListener('pointercancel', end)
  }

  const animateTo = (w: number): void => {
    target.current = w
    kick()
  }

  return { ref, startResize, animateTo, getWidth: () => widthRef.current }
}
