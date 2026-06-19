import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '../store'
import { useT } from '../lib/i18n'
import { DoodleBox } from './doodle/DoodleBox'
import { ModalScrim } from './ModalScrim'
import { DoodleButton } from './doodle/DoodleButton'
import { fieldCls } from './doodle/DoodleInput'

/** In-app prompt / confirm — Electron has no usable window.prompt and window.confirm looks off. */
export function DoodleDialog(): JSX.Element {
  const dialog = useStore((s) => s.dialog)
  const t = useT()
  const setDialog = (v: null): void => useStore.setState({ dialog: v })
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (dialog) {
      setValue(dialog.defaultValue)
      setTimeout(() => inputRef.current?.select(), 30)
    }
  }, [dialog])

  const close = (result: string | boolean | null): void => {
    dialog?.resolve(result)
    setDialog(null)
  }

  return (
    <AnimatePresence>
      {dialog && (
        <motion.div
          className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <ModalScrim onDismiss={() => close(dialog.kind === 'confirm' ? false : null)} />
          <motion.div
            className="pointer-events-auto relative"
            initial={{ scale: 0.85, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 6 }}
            transition={{ type: 'spring', stiffness: 380, damping: 16 }}
          >
            <DoodleBox fill="--card" fillStyle="solid">
              <div className="flex w-80 flex-col gap-3 p-6 font-doodle">
                <div className="text-lg font-bold leading-snug">{dialog.title}</div>
                {dialog.kind === 'prompt' && (
                  <input
                    ref={inputRef}
                    className={fieldCls}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') close(value)
                      if (e.key === 'Escape') close(null)
                    }}
                  />
                )}
                <div className="mt-1 flex justify-end gap-2">
                  <DoodleButton
                    variant="ghost"
                    onClick={() => close(dialog.kind === 'confirm' ? false : null)}
                  >
                    {t('common.cancel')}
                  </DoodleButton>
                  <DoodleButton
                    variant="primary"
                    onClick={() => close(dialog.kind === 'confirm' ? true : value)}
                  >
                    {t('common.ok')}
                  </DoodleButton>
                </div>
              </div>
            </DoodleBox>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
