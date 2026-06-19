import { useEffect, useRef } from 'react'
import rough from 'roughjs'
import { useStore } from '../../store'
import { cssColor } from '../../lib/theme'

interface DoodleBoxProps {
  children?: React.ReactNode
  className?: string
  stroke?: string
  fill?: string
  fillStyle?: 'hachure' | 'cross-hatch' | 'solid'
  roughness?: number
  radius?: number
  /** override the theme — for a window/preview without the zustand store */
  theme?: 'paper' | 'dark'
}

/**
 * A container whose border is drawn by Rough.js (the Excalidraw engine), so it looks genuinely
 * hand-sketched. A FIXED seed keeps the sketch stable; the SVG scales (viewBox +
 * preserveAspectRatio="none") while resizing so the lines don't re-roughen / dance every frame —
 * we only redraw crisp once it settles.
 */
export function DoodleBox({
  children,
  className = '',
  stroke = '--ink',
  fill,
  fillStyle = 'hachure',
  roughness = 1.4,
  radius = 12,
  theme: themeProp
}: DoodleBoxProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const seedRef = useRef<number | undefined>(undefined)
  if (seedRef.current === undefined) seedRef.current = Math.floor(Math.random() * 2 ** 31)
  const storeTheme = useStore((s) => s.theme)
  const theme = themeProp ?? storeTheme

  useEffect(() => {
    const host = hostRef.current
    const svg = svgRef.current
    if (!host || !svg) return
    let timer: ReturnType<typeof setTimeout> | undefined

    const draw = (): void => {
      const w = host.clientWidth
      const h = host.clientHeight
      if (w === 0 || h === 0) return
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
      svg.innerHTML = ''
      const rc = rough.svg(svg)
      const node = rc.path(roundedRectPath(2, 2, w - 4, h - 4, radius), {
        stroke: cssColor(stroke),
        strokeWidth: 2,
        roughness,
        fill: fill ? cssColor(fill) : undefined,
        fillStyle,
        fillWeight: 1.5,
        hachureGap: fillStyle === 'cross-hatch' ? 5 : 6,
        seed: seedRef.current
      })
      svg.appendChild(node)
    }

    draw()
    const ro = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(draw, 120)
    })
    ro.observe(host)
    return () => {
      ro.disconnect()
      clearTimeout(timer)
    }
  }, [stroke, fill, fillStyle, roughness, radius, theme])

  return (
    <div ref={hostRef} className={`relative ${className}`}>
      <svg
        ref={svgRef}
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      <div className="relative">{children}</div>
    </div>
  )
}

function roundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const rad = Math.min(r, w / 2, h / 2)
  return [
    `M${x + rad},${y}`,
    `H${x + w - rad}`,
    `A${rad},${rad} 0 0 1 ${x + w},${y + rad}`,
    `V${y + h - rad}`,
    `A${rad},${rad} 0 0 1 ${x + w - rad},${y + h}`,
    `H${x + rad}`,
    `A${rad},${rad} 0 0 1 ${x},${y + h - rad}`,
    `V${y + rad}`,
    `A${rad},${rad} 0 0 1 ${x + rad},${y}`,
    'Z'
  ].join(' ')
}
