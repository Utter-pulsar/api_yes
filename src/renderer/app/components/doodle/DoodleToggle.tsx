import { motion } from 'framer-motion'

/**
 * An Apple-style on/off switch in the hand-drawn look: a sketchy pill track (wobbled by the
 * #doodle-wobble filter via `doodle-edge`) with a thumb that springs left↔right. Fills marker-green
 * when on, neutral when off.
 */
export function DoodleToggle({
  checked,
  onChange,
  label,
  disabled = false
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`doodle-edge relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-ink transition-colors disabled:opacity-50 ${
        checked ? 'bg-marker-green' : 'bg-ink/15'
      }`}
    >
      <motion.span
        className="block h-5 w-5 rounded-full border-2 border-ink bg-paper"
        initial={false}
        animate={{ x: checked ? 22 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      />
    </button>
  )
}
