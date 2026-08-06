import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../lib/bridge'
import { useStore } from '../store'
import { useT } from '../lib/i18n'
import { DoodleBox } from './doodle/DoodleBox'
import { DoodleButton } from './doodle/DoodleButton'
import { DoodleInput } from './doodle/DoodleInput'

const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'wheel', 'touchstart', 'pointerdown'] as const

export function LockOverlay(): JSX.Element {
  const auth = useStore((s) => s.managementAuth)
  const t = useT()
  const [locked, setLocked] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const timerRef = useRef<number | undefined>(undefined)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!locked) return
    const id = window.setTimeout(() => inputRef.current?.focus(), 80)
    return () => window.clearTimeout(id)
  }, [locked])

  useEffect(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
    if (!auth.enabled || auth.lockTimeoutMs === null) {
      setLocked(false)
      return
    }

    const schedule = (): void => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setLocked(true), auth.lockTimeoutMs ?? 0)
    }
    const onActivity = (): void => {
      if (!locked) schedule()
    }

    schedule()
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, onActivity, { passive: true })
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, onActivity)
    }
  }, [auth.enabled, auth.lockTimeoutMs, locked])

  const unlock = async (): Promise<void> => {
    if (!password.trim()) return
    setBusy(true)
    setError('')
    try {
      const result = await api.command('managementAuth.verify', { password })
      if (result.ok) {
        setPassword('')
        setLocked(false)
      } else {
        setError(t('lock.badPassword'))
        inputRef.current?.select()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AnimatePresence>
      {locked && auth.enabled && (
        <motion.div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-paper/45 font-doodle backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,.25),rgba(255,255,255,.08))] dark:bg-[radial-gradient(circle_at_center,rgba(255,255,255,.08),rgba(0,0,0,.18))]" />
          <motion.div
            className="relative"
            initial={{ scale: 0.86, opacity: 0, y: 14 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 8 }}
            transition={{ type: 'spring', stiffness: 380, damping: 16 }}
          >
            <DoodleBox fill="--card" fillStyle="solid">
              <div className="flex w-80 flex-col gap-3 p-6 text-center">
                <div className="text-3xl">🔒</div>
                <div className="text-2xl font-bold">{t('lock.title')}</div>
                <p className="text-sm leading-relaxed opacity-60">{t('lock.hint')}</p>
                <DoodleInput
                  ref={inputRef}
                  type="password"
                  value={password}
                  placeholder={t('lock.placeholder')}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void unlock()
                  }}
                />
                {error && <span className="text-sm text-marker-coral">⚠ {error}</span>}
                <DoodleButton variant="primary" disabled={busy || !password.trim()} onClick={() => void unlock()}>
                  {busy ? t('lock.unlocking') : t('lock.unlock')}
                </DoodleButton>
              </div>
            </DoodleBox>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
