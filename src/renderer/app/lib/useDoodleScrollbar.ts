import { useEffect } from 'react'

/**
 * Replace a scroll container's chunky native scrollbar with a slim, hand-drawn one that matches the
 * doodle aesthetic. The native bar is hidden (via `doodle-scroll-host`) and a thin inky stroke —
 * wobbled by the global `#doodle-wobble` filter through `.doodle-edge` — is overlaid along the
 * scrolled edge. It auto-hides when there's nothing to scroll and thickens on hover/drag.
 *
 * The overlay is two nested nodes: an INVISIBLE hit area (HIT px wide) wrapping the VISIBLE bar.
 * The hit area is appended to the container's positioned parent (so it doesn't scroll with content)
 * and tracks size/position from the container's metrics. Drag it to scroll. 'y' rides the right
 * edge, 'x' the bottom.
 */
const HIT = 10
const EDGE_INSET = 1
const END_PAD = 3
const MIN = 28

export function useDoodleScrollbar(
  scrollRef: React.RefObject<HTMLElement | null>,
  axis: 'x' | 'y' = 'y'
): void {
  useEffect(() => {
    const el = scrollRef.current
    const parent = el?.parentElement
    if (!el || !parent) return
    const horiz = axis === 'x'

    let restorePos: string | null = null
    if (getComputedStyle(parent).position === 'static') {
      restorePos = parent.style.position
      parent.style.position = 'relative'
    }

    el.classList.add('doodle-scroll-host')
    const thumb = document.createElement('div')
    thumb.className = `doodle-scrollthumb ${horiz ? 'is-horizontal' : 'is-vertical'}`
    thumb.style.pointerEvents = 'none'
    thumb.style[horiz ? 'height' : 'width'] = `${HIT}px`
    const bar = document.createElement('div')
    bar.className = 'doodle-scrollthumb-bar doodle-edge'
    thumb.appendChild(bar)
    parent.appendChild(thumb)

    const layout = (): void => {
      const client = horiz ? el.clientWidth : el.clientHeight
      const scroll = horiz ? el.scrollWidth : el.scrollHeight
      const overflow = scroll - client
      if (overflow <= 1) {
        thumb.style.opacity = '0'
        thumb.style.pointerEvents = 'none'
        return
      }
      const track = client - END_PAD * 2
      const size = Math.max(MIN, Math.min(track, (client / scroll) * track))
      const maxOffset = track - size
      const offset = END_PAD + (el[horiz ? 'scrollLeft' : 'scrollTop'] / overflow) * maxOffset
      thumb.style.opacity = '1'
      thumb.style.pointerEvents = 'auto'
      if (horiz) {
        thumb.style.width = `${size}px`
        thumb.style.left = `${el.offsetLeft + offset}px`
        thumb.style.top = `${el.offsetTop + el.offsetHeight - HIT - EDGE_INSET}px`
      } else {
        thumb.style.height = `${size}px`
        thumb.style.top = `${el.offsetTop + offset}px`
        thumb.style.left = `${el.offsetLeft + el.offsetWidth - HIT - EDGE_INSET}px`
      }
    }

    let rafId = 0
    const schedule = (): void => {
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        layout()
      })
    }

    let dragStart = 0
    let scrollStart = 0
    const onDown = (e: PointerEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      dragStart = horiz ? e.clientX : e.clientY
      scrollStart = horiz ? el.scrollLeft : el.scrollTop
      thumb.classList.add('dragging')
      try {
        thumb.setPointerCapture(e.pointerId)
      } catch {
        /* best-effort */
      }
    }
    const onMove = (e: PointerEvent): void => {
      if (!thumb.classList.contains('dragging')) return
      const client = horiz ? el.clientWidth : el.clientHeight
      const scroll = horiz ? el.scrollWidth : el.scrollHeight
      const overflow = scroll - client
      const track = client - END_PAD * 2
      const size = Math.max(MIN, Math.min(track, (client / scroll) * track))
      const maxOffset = track - size
      const delta = (horiz ? e.clientX : e.clientY) - dragStart
      const next = scrollStart + (maxOffset > 0 ? (delta / maxOffset) * overflow : 0)
      if (horiz) el.scrollLeft = next
      else el.scrollTop = next
      schedule()
    }
    const onUp = (e: PointerEvent): void => {
      thumb.classList.remove('dragging')
      try {
        thumb.releasePointerCapture(e.pointerId)
      } catch {
        /* may already be released */
      }
    }
    thumb.addEventListener('pointerdown', onDown)
    thumb.addEventListener('pointermove', onMove)
    thumb.addEventListener('pointerup', onUp)
    thumb.addEventListener('pointercancel', onUp)

    el.addEventListener('scroll', schedule, { passive: true })
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    const mo = new MutationObserver(schedule)
    mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })

    schedule()

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      thumb.removeEventListener('pointerdown', onDown)
      thumb.removeEventListener('pointermove', onMove)
      thumb.removeEventListener('pointerup', onUp)
      thumb.removeEventListener('pointercancel', onUp)
      el.removeEventListener('scroll', schedule)
      ro.disconnect()
      mo.disconnect()
      thumb.remove()
      el.classList.remove('doodle-scroll-host')
      if (restorePos !== null) parent.style.position = restorePos
    }
  }, [scrollRef, axis])
}
