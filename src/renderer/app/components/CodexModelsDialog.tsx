import { useEffect, useState } from 'react'
import { DEFAULT_CODEX_MODELS } from '@shared/types'
import { api } from '../lib/bridge'
import { useStore } from '../store'
import { useT } from '../lib/i18n'
import { DialogShell } from './DialogShell'
import { DoodleButton } from './doodle/DoodleButton'

/**
 * User-curated Codex (ChatGPT subscription) model list — there's no public list endpoint, so the
 * models are maintained by hand here. Order matters (the connectivity probe walks top-to-bottom,
 * cheapest first), hence the explicit ↑/↓ reordering. Every mutation persists immediately.
 */
export function CodexModelsDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): JSX.Element {
  const toast = useStore((s) => s.toast)
  const askPrompt = useStore((s) => s.askPrompt)
  const askConfirm = useStore((s) => s.askConfirm)
  const t = useT()
  const [models, setModels] = useState<string[]>([])

  useEffect(() => {
    if (open) void api.query('settings.get', undefined).then((s) => setModels(s.codexModels))
  }, [open])

  // optimistic local list, then sync with what main actually persisted (SettingsDialog's pattern)
  const commit = (next: string[]): void => {
    setModels(next)
    void api
      .command('settings.update', { patch: { codexModels: next } })
      .then((s) => setModels(s.codexModels))
  }

  const add = async (): Promise<void> => {
    const v = await askPrompt(t('cm.addPrompt'))
    if (v === null) return
    const id = v.trim()
    if (!id) return
    if (models.includes(id)) {
      toast('info', t('cm.duplicate'))
      return
    }
    commit([...models, id])
  }

  const edit = async (index: number): Promise<void> => {
    const v = await askPrompt(t('cm.editPrompt'), models[index])
    if (v === null) return
    const id = v.trim()
    if (!id || id === models[index]) return
    if (models.includes(id)) {
      toast('info', t('cm.duplicate'))
      return
    }
    commit(models.map((m, i) => (i === index ? id : m)))
  }

  const remove = async (index: number): Promise<void> => {
    if (models.length === 1) {
      toast('info', t('cm.lastModel'))
      return
    }
    if (!(await askConfirm(t('cm.deleteConfirm', { id: models[index] })))) return
    commit(models.filter((_, i) => i !== index))
  }

  const move = (index: number, dir: -1 | 1): void => {
    const next = [...models]
    const [m] = next.splice(index, 1)
    next.splice(index + dir, 0, m)
    commit(next)
  }

  const reset = async (): Promise<void> => {
    if (!(await askConfirm(t('cm.resetConfirm')))) return
    commit([...DEFAULT_CODEX_MODELS])
  }

  return (
    <DialogShell open={open} onClose={onClose} title={t('cm.title')} width="w-[26rem]">
      <p className="text-xs leading-relaxed opacity-60">{t('cm.hint')}</p>

      <div className="flex flex-col gap-1.5">
        {models.map((m, i) => (
          <div
            key={m}
            className="doodle-edge flex items-center gap-1 rounded-[8px] border-2 border-ink/25 px-3 py-1.5"
          >
            <span className="mono flex-1 truncate text-sm">{m}</span>
            <IconBtn title={t('cm.moveUp')} disabled={i === 0} onClick={() => move(i, -1)}>
              ↑
            </IconBtn>
            <IconBtn title={t('cm.moveDown')} disabled={i === models.length - 1} onClick={() => move(i, 1)}>
              ↓
            </IconBtn>
            <IconBtn title={t('cm.editPrompt')} onClick={() => void edit(i)}>
              ✏️
            </IconBtn>
            <IconBtn title={t('common.delete')} onClick={() => void remove(i)}>
              🗑
            </IconBtn>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pt-1">
        <DoodleButton variant="primary" className="text-sm" onClick={() => void add()}>
          {t('cm.add')}
        </DoodleButton>
        <button
          onClick={() => void reset()}
          className="rounded-[6px] px-2 py-1 text-xs opacity-50 transition hover:underline hover:opacity-80"
        >
          {t('cm.reset')}
        </button>
      </div>
    </DialogShell>
  )
}

function IconBtn({
  title,
  disabled,
  onClick,
  children
}: {
  title: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="shrink-0 rounded-[6px] border-2 border-ink/30 px-1.5 py-0.5 text-xs leading-none transition hover:bg-ink/5 disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}
