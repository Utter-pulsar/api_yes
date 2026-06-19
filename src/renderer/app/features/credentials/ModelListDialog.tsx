import { useEffect, useState } from 'react'
import type { ModelInfo } from '@shared/types'
import { api } from '../../lib/bridge'
import { useStore } from '../../store'
import { useT } from '../../lib/i18n'
import { DialogShell } from '../../components/DialogShell'
import { DoodleButton } from '../../components/doodle/DoodleButton'

/** Lists the upstream models for a credential; each row copies its id on click. */
export function ModelListDialog({
  credentialId,
  open,
  onClose
}: {
  credentialId: string | null
  open: boolean
  onClose: () => void
}): JSX.Element {
  const toast = useStore((s) => s.toast)
  const t = useT()
  const [loading, setLoading] = useState(false)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [message, setMessage] = useState('')
  const [ok, setOk] = useState(true)

  const load = async (): Promise<void> => {
    if (!credentialId) return
    setLoading(true)
    try {
      const r = await api.command('credentials.listModels', { id: credentialId })
      setModels(r.models)
      setMessage(r.message)
      setOk(r.ok)
    } catch (e) {
      setOk(false)
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      setModels([])
      setMessage('')
      setOk(true)
      void load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, credentialId])

  return (
    <DialogShell open={open} onClose={onClose} title={t('models.title')} width="w-[26rem]">
      <div className="flex items-center justify-between">
        <span className={`text-sm ${ok ? 'opacity-60' : 'text-marker-coral'}`}>
          {loading ? t('common.loading') : message}
        </span>
        <DoodleButton variant="ghost" className="text-sm" disabled={loading} onClick={() => void load()}>
          ↻ {t('common.refresh')}
        </DoodleButton>
      </div>

      <div className="flex flex-col gap-1.5">
        {models.map((m) => (
          <button
            key={m.id}
            onClick={() => {
              void api.command('clipboard.write', { text: m.id })
              toast('success', t('models.copied', { id: m.id }))
            }}
            className="doodle-edge flex items-center justify-between gap-2 rounded-[8px] border-2 border-ink/25 px-3 py-1.5 text-left hover:border-ink/60"
            title={t('models.copyHint')}
          >
            <span className="mono truncate text-sm">{m.id}</span>
            {m.label && <span className="shrink-0 text-xs opacity-50">{m.label}</span>}
          </button>
        ))}
        {!loading && models.length === 0 && ok && (
          <div className="py-6 text-center text-sm opacity-50">{t('models.none')}</div>
        )}
      </div>
    </DialogShell>
  )
}
