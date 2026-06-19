import { useEffect, useRef, useState } from 'react'
import type { TestResult } from '@shared/types'
import { useStore } from '../../store'
import { useT } from '../../lib/i18n'
import { useDoodleScrollbar } from '../../lib/useDoodleScrollbar'
import { api } from '../../lib/bridge'
import { DoodleButton } from '../../components/doodle/DoodleButton'
import { DoodleToggle } from '../../components/doodle/DoodleToggle'
import { ProviderBadge, KindBadge, StatusDot } from './badges'
import { ModelListDialog } from './ModelListDialog'
import { EditCredentialDialog } from './EditCredentialDialog'
import { ProxyList } from '../proxy/ProxyList'
import logoUrl from '@assets/logo.png'

export function CredentialDetail(): JSX.Element {
  const selectedId = useStore((s) => s.selectedId)
  const credential = useStore((s) => (selectedId ? s.credentialById(selectedId) : undefined))
  const toast = useStore((s) => s.toast)
  const askConfirm = useStore((s) => s.askConfirm)
  const lang = useStore((s) => s.lang)
  const t = useT()
  const bodyRef = useRef<HTMLDivElement>(null)
  useDoodleScrollbar(bodyRef, 'y')

  const [models, setModels] = useState(false)
  const [editing, setEditing] = useState(false)
  const [testing, setTesting] = useState(false)
  // test-result display: success shows green then auto-hides; failure stays red until next test
  const [testRes, setTestRes] = useState<TestResult | null>(null)
  const [testVisible, setTestVisible] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // on switching credential, seed from its last test: show a prior FAILURE (red), hide a success
  useEffect(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    const lt = credential?.lastTest
    if (lt && !lt.ok) {
      setTestRes(lt)
      setTestVisible(true)
    } else {
      setTestRes(null)
      setTestVisible(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  if (!credential) {
    return (
      <section className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center font-doodle opacity-50">
          <img src={logoUrl} alt="" className="h-20 w-20 opacity-70" draggable={false} />
          <div className="text-lg">{t('detail.emptyPick')}</div>
        </div>
      </section>
    )
  }

  const expiresLabel = credential.expiresAt
    ? credential.expiresAt > Date.now()
      ? t('detail.tokenValid', {
          t: new Date(credential.expiresAt).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US')
        })
      : t('detail.tokenExpired')
    : null

  const test = async (): Promise<void> => {
    setTesting(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    try {
      const r = await api.command('credentials.test', { id: credential.id })
      setTestRes(r)
      setTestVisible(true)
      // success: flash green then fade after a few seconds; failure: keep red until next test
      if (r.ok) hideTimer.current = setTimeout(() => setTestVisible(false), 6000)
    } catch (e) {
      setTestRes({ ok: false, at: Date.now(), message: e instanceof Error ? e.message : String(e) })
      setTestVisible(true)
    } finally {
      setTesting(false)
    }
  }
  const remove = async (): Promise<void> => {
    if (!(await askConfirm(t('detail.deleteConfirm', { n: credential.name })))) return
    await api.command('credentials.delete', { id: credential.id })
    toast('success', t('detail.deleted'))
  }

  return (
    <section className="relative flex min-h-0 flex-1 flex-col">
      <div ref={bodyRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
        {/* header */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <StatusDot ok={credential.lastTest?.ok} />
            <h1 className="font-doodle text-2xl font-bold">{credential.name}</h1>
            <ProviderBadge provider={credential.provider} />
            <KindBadge kind={credential.kind} />
            <div className="ml-auto flex items-center gap-2">
              <span className="text-sm opacity-60">{credential.enabled ? t('detail.enabled') : t('detail.disabled')}</span>
              <DoodleToggle
                label={t('detail.enableLabel')}
                checked={credential.enabled}
                onChange={(v) =>
                  void api.command('credentials.update', { id: credential.id, patch: { enabled: v } })
                }
              />
            </div>
          </div>

          {!credential.enabled && (
            <div className="doodle-edge rounded-[8px] border-2 border-marker-coral bg-marker-coral/10 px-3 py-1.5 text-sm text-marker-coral">
              {t('detail.disabledBanner')}
            </div>
          )}

          <div className="flex flex-col gap-0.5 text-sm opacity-70">
            <div>
              {t('detail.apiBase')}<span className="mono">{credential.baseUrl}</span>
            </div>
            {credential.kind === 'apikey' && credential.keyPreview && (
              <div>
                {t('detail.key')}<span className="mono">{credential.keyPreview}</span>
              </div>
            )}
            {credential.account?.email && <div>{t('detail.account', { e: credential.account.email })}</div>}
            {credential.account?.plan && <div>{t('detail.plan', { p: credential.account.plan })}</div>}
            {expiresLabel && <div>{expiresLabel}</div>}
            {testVisible && testRes && (
              <div className={testRes.ok ? 'text-marker-green' : 'text-marker-coral'}>
                {testRes.ok ? '✓ ' : '⚠ '}
                {testRes.message}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <DoodleButton variant="primary" disabled={testing} onClick={() => void test()}>
              {testing ? t('detail.testing') : t('detail.testConn')}
            </DoodleButton>
            <DoodleButton variant="default" onClick={() => setModels(true)}>
              {t('detail.models')}
            </DoodleButton>
            <DoodleButton variant="default" onClick={() => setEditing(true)}>
              {t('detail.edit')}
            </DoodleButton>
            <DoodleButton variant="danger" onClick={() => void remove()}>
              {t('detail.delete')}
            </DoodleButton>
          </div>
        </div>

        <div className="doodle-edge border-t-2 border-ink/30" />

        <ProxyList credential={credential} />
      </div>

      <ModelListDialog credentialId={credential.id} open={models} onClose={() => setModels(false)} />
      <EditCredentialDialog credential={credential} open={editing} onClose={() => setEditing(false)} />
    </section>
  )
}
