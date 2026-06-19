import { useEffect, useState } from 'react'
import type { CredentialView, TestResult } from '@shared/types'
import { api } from '../../lib/bridge'
import { useStore } from '../../store'
import { useT } from '../../lib/i18n'
import { DialogShell } from '../../components/DialogShell'
import { DoodleButton } from '../../components/doodle/DoodleButton'
import { DoodleInput, Field } from '../../components/doodle/DoodleInput'

/** Edit a credential's name (both kinds) + API地址/Key (API-key kind only). */
export function EditCredentialDialog({
  credential,
  open,
  onClose
}: {
  credential: CredentialView | null
  open: boolean
  onClose: () => void
}): JSX.Element {
  const toast = useStore((s) => s.toast)
  const tr = useT()
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [test, setTest] = useState<TestResult | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (open && credential) {
      setName(credential.name)
      setBaseUrl(credential.baseUrl)
      setApiKey('')
      setTest(null)
    }
  }, [open, credential])

  if (!credential) return <DialogShell open={false} onClose={onClose} title={tr('edit.title')}>{null}</DialogShell>
  const isApiKey = credential.kind === 'apikey'

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await api.command('credentials.update', {
        id: credential.id,
        patch: {
          name,
          ...(isApiKey ? { baseUrl } : {}),
          ...(isApiKey && apiKey.trim() ? { apiKey } : {})
        }
      })
      toast('success', tr('edit.saved'))
      onClose()
    } catch (e) {
      toast('error', e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTest(null)
    try {
      // test the draft values (so you can verify before saving)
      setTest(
        await api.command('credentials.testDraft', {
          draft: { provider: credential.provider, name, baseUrl, apiKey: apiKey || '••unchanged••' }
        })
      )
    } finally {
      setTesting(false)
    }
  }

  return (
    <DialogShell open={open} onClose={onClose} title={tr('edit.title')} width="w-[26rem]">
      <Field label={tr('edit.name')}>
        <DoodleInput value={name} onChange={(e) => setName(e.target.value)} />
      </Field>

      {isApiKey && (
        <>
          <Field label={tr('edit.apiBase')}>
            <DoodleInput className="mono text-sm" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </Field>
          <Field label={tr('edit.apiKey')} hint={tr('edit.keyHint', { p: credential.keyPreview ?? '••••' })}>
            <DoodleInput
              className="mono text-sm"
              type="password"
              value={apiKey}
              placeholder={tr('edit.keyPlaceholder')}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Field>
          {apiKey.trim() && (
            <div>
              <DoodleButton variant="default" disabled={testing} onClick={() => void runTest()}>
                {testing ? tr('add.testing') : tr('edit.testNewKey')}
              </DoodleButton>
              {test && (
                <span className={`ml-2 text-sm ${test.ok ? 'text-marker-green' : 'text-marker-coral'}`}>
                  {test.ok ? '✓ ' : '⚠ '}
                  {test.message}
                </span>
              )}
            </div>
          )}
        </>
      )}

      <div className="mt-1 flex justify-end gap-2">
        <DoodleButton variant="ghost" onClick={onClose}>
          {tr('common.cancel')}
        </DoodleButton>
        <DoodleButton variant="primary" disabled={saving} onClick={() => void save()}>
          {saving ? tr('common.saving') : tr('common.save')}
        </DoodleButton>
      </div>
    </DialogShell>
  )
}
