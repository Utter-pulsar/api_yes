import type { ButtonHTMLAttributes } from 'react'

type Variant = 'default' | 'primary' | 'ghost' | 'danger'

interface DoodleButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

const variants: Record<Variant, string> = {
  default: 'bg-card text-ink border-ink hover:bg-marker-yellow/40',
  // marker bg stays a light accent in BOTH themes → fixed dark text/border for contrast
  primary: 'bg-marker-knot text-[#2B2B2B] border-[#2B2B2B] hover:brightness-105',
  ghost: 'bg-transparent text-ink border-transparent hover:bg-ink/5',
  danger: 'bg-card text-marker-coral border-marker-coral hover:bg-marker-coral/15'
}

export function DoodleButton({
  variant = 'default',
  className = '',
  children,
  ...rest
}: DoodleButtonProps): JSX.Element {
  return (
    <button
      {...rest}
      className={`doodle-edge inline-flex items-center justify-center gap-1 rounded-[10px] border-2 px-3 py-1.5 font-doodle text-base transition active:translate-y-px disabled:opacity-50 ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  )
}
