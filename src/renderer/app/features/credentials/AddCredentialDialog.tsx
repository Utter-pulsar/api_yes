import { useEffect, useState } from 'react'
import type { OAuthStatus } from '@shared/api/contract'
import { DEFAULT_BASE_URL, type Provider, type TestResult } from '@shared/types'
import { api } from '../../lib/bridge'
import { useStore } from '../../store'
import { useT } from '../../lib/i18n'
import { DialogShell } from '../../components/DialogShell'
import { DoodleButton } from '../../components/doodle/DoodleButton'
import { DoodleInput, Field, fieldCls } from '../../components/doodle/DoodleInput'

type Method = 'oauth' | 'apikey'

function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}): JSX.Element {
  return (
    <div className="doodle-edge flex gap-1 rounded-[10px] border-2 border-ink/40 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-[7px] px-2 py-1 text-sm transition ${
            value === o.value ? 'bg-marker-knot text-[#2B2B2B]' : 'hover:bg-ink/5'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function ResultLine({ r }: { r: TestResult | null }): JSX.Element | null {
  if (!r) return null
  return (
    <span className={`text-sm ${r.ok ? 'text-marker-green' : 'text-marker-coral'}`}>
      {r.ok ? '✓ ' : '⚠ '}
      {r.message}
    </span>
  )
}

export function AddCredentialDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): JSX.Element {
  const select = useStore((s) => s.select)
  const toast = useStore((s) => s.toast)
  const askConfirm = useStore((s) => s.askConfirm)
  const t = useT()

  const [provider, setProvider] = useState<Provider>('openai')
  const [method, setMethod] = useState<Method>('oauth')

  // api-key form
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL.openai)
  const [apiKey, setApiKey] = useState('')
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)

  // oauth flow
  const [session, setSession] = useState<{ id: string; mode: 'loopback' | 'paste'; url: string } | null>(null)
  const [oauthPhase, setOauthPhase] = useState<OAuthStatus['phase'] | null>(null)
  const [oauthMsg, setOauthMsg] = useState('')
  const [pasteCode, setPasteCode] = useState('')

  // reset everything when (re)opened
  useEffect(() => {
    if (open) {
      setProvider('openai')
      setMethod('oauth')
      setName('')
      setBaseUrl(DEFAULT_BASE_URL.openai)
      setApiKey('')
      setTestResult(null)
      setSession(null)
      setOauthPhase(null)
      setOauthMsg('')
      setPasteCode('')
    }
  }, [open])

  // keep baseUrl placeholder in step with provider until user edits
  const switchProvider = (p: Provider): void => {
    setProvider(p)
    setBaseUrl(DEFAULT_BASE_URL[p])
    setTestResult(null)
    void cancelOAuth()
  }
  const switchMethod = (m: Method): void => {
    setMethod(m)
    setTestResult(null)
    void cancelOAuth()
  }

  const maybeEnableSameKeyMode = async (credentialId: string): Promise<void> => {
    const cred = await api.query('credentials.get', { id: credentialId })
    if (!cred?.sameApiKey || cred.sameApiKey.modeEnabled || !cred.sameApiKey.duplicated) return
    if (!(await askConfirm(t('add.sameKeyConfirm', { n: Math.max(1, cred.sameApiKey.groupSize - 1) })))) return
    await api.command('credentials.setSameApiKeyMode', { id: credentialId, enabled: true })
    toast('success', t('detail.sameKeyModeEnabled'))
  }

  const cancelOAuth = async (): Promise<void> => {
    if (session) {
      await api.command('oauth.cancel', { sessionId: session.id })
      setSession(null)
      setOauthPhase(null)
    }
  }

  // listen for oauth progress for the active session
  useEffect(() => {
    if (!session) return
    return api.on('oauth.status', (s) => {
      if (s.sessionId !== session.id) return
      setOauthPhase(s.phase)
      if (s.phase === 'error') setOauthMsg(s.message)
      if (s.phase === 'success') {
        toast('success', t('add.authSuccess'))
        select(s.credentialId)
        onClose()
      }
    })
  }, [session, onClose, select, toast, t])

  const test = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      setTestResult(await api.command('credentials.testDraft', { draft: { provider, name, baseUrl, apiKey } }))
    } finally {
      setTesting(false)
    }
  }

  const saveApiKey = async (): Promise<void> => {
    setSaving(true)
    try {
      const cred = await api.command('credentials.createApiKey', { provider, name, baseUrl, apiKey })
      await maybeEnableSameKeyMode(cred.id)
      toast('success', t('add.added'))
      select(cred.id)
      onClose()
    } catch (e) {
      toast('error', e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const beginOAuth = async (): Promise<void> => {
    setOauthMsg('')
    const begun = await api.command('oauth.begin', { provider, name: name.trim() || undefined })
    setSession({ id: begun.sessionId, mode: begun.mode, url: begun.authUrl })
    setOauthPhase('waiting')
  }

  const submitPasted = async (): Promise<void> => {
    if (!session) return
    const r = await api.command('oauth.submitCode', { sessionId: session.id, code: pasteCode })
    if (!r.ok) {
      setOauthMsg(r.message)
      setOauthPhase('error')
    }
    // success path is handled by the oauth.status listener
  }

  const canTest = !testing && !!baseUrl.trim() && !!apiKey.trim()
  const canSave = !saving && !!apiKey.trim() && !!baseUrl.trim()

  return (
    <DialogShell open={open} onClose={onClose} title={t('add.title')} width="w-[26rem]">
      <Field label={t('add.nameOptional')}>
        <DoodleInput
          value={name}
          placeholder={provider === 'openai' ? t('add.namePlaceholderOpenai') : t('add.namePlaceholderAnthropic')}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm opacity-70">{t('add.provider')}</span>
          <Segmented
            value={provider}
            onChange={switchProvider}
            options={[
              { value: 'openai', label: 'OpenAI' },
              { value: 'anthropic', label: 'Anthropic' }
            ]}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm opacity-70">{t('add.method')}</span>
          <Segmented
            value={method}
            onChange={switchMethod}
            options={[
              { value: 'oauth', label: t('add.methodOauth') },
              { value: 'apikey', label: t('add.methodApikey') }
            ]}
          />
        </div>
      </div>

      {method === 'apikey' ? (
        <div className="flex flex-col gap-3">
          <Field label={t('add.apiBase')} hint={t('add.apiBaseHint')}>
            <DoodleInput
              className="mono text-sm"
              value={baseUrl}
              placeholder={DEFAULT_BASE_URL[provider]}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </Field>
          <Field label={t('add.apiKey')}>
            <DoodleInput
              className="mono text-sm"
              type="password"
              value={apiKey}
              placeholder={provider === 'openai' ? 'sk-…' : 'sk-ant-…'}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Field>
          <div className="flex items-center gap-2">
            <DoodleButton variant="default" disabled={!canTest} onClick={() => void test()}>
              {testing ? t('add.testing') : t('add.test')}
            </DoodleButton>
            <DoodleButton variant="primary" disabled={!canSave} onClick={() => void saveApiKey()}>
              {saving ? t('add.adding') : t('add.add')}
            </DoodleButton>
          </div>
          <ResultLine r={testResult} />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="rounded-[10px] border-2 border-ink/25 p-3 text-sm leading-relaxed opacity-80">
            {provider === 'anthropic' ? t('add.oauthAnthropicDesc') : t('add.oauthOpenaiDesc')}
          </div>

          {!session ? (
            <DoodleButton variant="primary" onClick={() => void beginOAuth()}>
              {t('add.openBrowser')}
            </DoodleButton>
          ) : (
            <div className="flex flex-col gap-2">
              <button
                onClick={() => void api.command('shell.openExternal', { url: session.url })}
                className="truncate text-left text-xs text-marker-blue underline"
                title={session.url}
              >
                {t('add.manualOpen')}
              </button>

              {session.mode === 'paste' && (
                <>
                  <Field label={t('add.pasteLabel')}>
                    <input
                      className={`${fieldCls} mono text-sm`}
                      value={pasteCode}
                      placeholder="code#state"
                      onChange={(e) => setPasteCode(e.target.value)}
                    />
                  </Field>
                  <DoodleButton
                    variant="primary"
                    disabled={!pasteCode.trim() || oauthPhase === 'exchanging'}
                    onClick={() => void submitPasted()}
                  >
                    {oauthPhase === 'exchanging' ? t('add.verifying') : t('add.finish')}
                  </DoodleButton>
                </>
              )}

              {session.mode === 'loopback' && (
                <div className="text-sm opacity-70">
                  {oauthPhase === 'exchanging' ? t('add.verifying') : t('add.loopbackWaiting')}
                </div>
              )}

              <button onClick={() => void cancelOAuth()} className="text-xs opacity-50 underline">
                {t('add.cancelAuth')}
              </button>
            </div>
          )}

          {oauthPhase === 'error' && <span className="text-sm text-marker-coral">⚠ {oauthMsg}</span>}
        </div>
      )}
    </DialogShell>
  )
}
