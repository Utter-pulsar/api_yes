import { forwardRef, type InputHTMLAttributes } from 'react'

/** Shared hand-drawn field style — a wobbly bordered box. Reused by labelled fields everywhere. */
export const fieldCls =
  'doodle-edge w-full rounded-[8px] border-2 border-ink bg-card px-2.5 py-1.5 text-base outline-none focus:border-marker-knot transition-colors placeholder:text-ink/35'

export const DoodleInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function DoodleInput({ className = '', ...rest }, ref) {
    return <input ref={ref} className={`${fieldCls} ${className}`} {...rest} />
  }
)

/** A labelled field: a small caption above an input (or any control passed as children). */
export function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm opacity-70">{label}</span>
      {children}
      {hint && <span className="text-xs opacity-45">{hint}</span>}
    </label>
  )
}
