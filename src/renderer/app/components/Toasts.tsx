import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '../store'
import { DoodleBox } from './doodle/DoodleBox'

const tint: Record<'info' | 'success' | 'error', string> = {
  info: '--card',
  success: '#EAF8E1',
  error: '#FDE7E4'
}

/** Stacked hand-drawn toasts, top-right. Driven by the store's `toasts`. */
export function Toasts(): JSX.Element {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed right-4 top-12 z-[95] flex w-72 flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className="pointer-events-auto"
            initial={{ opacity: 0, x: 40, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 420, damping: 26 }}
            onClick={() => dismiss(t.id)}
          >
            <DoodleBox fill={tint[t.kind]} fillStyle="solid" radius={10}>
              <div className="px-3 py-2 font-doodle text-sm leading-snug text-[#2B2B2B]">
                {t.kind === 'success' ? '✓ ' : t.kind === 'error' ? '⚠ ' : ''}
                {t.message}
              </div>
            </DoodleBox>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
