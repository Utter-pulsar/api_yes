import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '../store'
import { useT } from '../lib/i18n'

/**
 * The self-update status line + a hand-drawn progress bar, tucked under the home title. Narrates the
 * 检查更新 flow (checking → downloading X% → installing) and briefly flashes 已是最新 / an error
 * before fading. Driven entirely by the store's `updateStatus` (pushed from main).
 */
export function UpdateProgress(): JSX.Element {
  const status = useStore((s) => s.updateStatus)
  const t = useT()
  const [show, setShow] = useState(true)

  useEffect(() => {
    setShow(true)
    if (status.phase === 'none' || status.phase === 'error') {
      const t = setTimeout(() => setShow(false), 5000)
      return () => clearTimeout(t)
    }
    return undefined
  }, [status])

  const visible = show && status.phase !== 'idle'

  const text =
    status.phase === 'checking'
      ? t('update.checkingDots')
      : status.phase === 'downloading'
        ? t('update.downloadBar', { p: status.percent })
        : status.phase === 'installing'
          ? t('update.installing')
          : status.phase === 'none'
            ? t('about.upToDate')
            : status.phase === 'error'
              ? t('about.updateFailed', { m: status.message })
              : ''

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="flex items-center gap-2 font-doodle text-xs opacity-70"
          initial={{ opacity: 0, y: -4, height: 0 }}
          animate={{ opacity: 0.7, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -4, height: 0 }}
          transition={{ duration: 0.2 }}
          title={status.phase === 'error' ? status.message : undefined}
        >
          <span>{text}</span>
          {status.phase === 'downloading' && <DoodleBar percent={status.percent} />}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** A wobbly hand-drawn progress bar: a sketchy outline track with a marker-knot fill. */
function DoodleBar({ percent }: { percent: number }): JSX.Element {
  return (
    <span className="doodle-edge relative block h-2.5 w-28 overflow-hidden rounded-full border-2 border-ink/60">
      <span
        className="block h-full rounded-full bg-marker-knot transition-[width] duration-150"
        style={{ width: `${percent}%` }}
      />
    </span>
  )
}
