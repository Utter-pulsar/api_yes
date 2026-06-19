import type { CredentialKind, Provider } from '@shared/types'
import { useT } from '../../lib/i18n'

const providerStyle: Record<Provider, string> = {
  openai: 'bg-marker-sky/30 border-marker-sky text-[#0b6b62]',
  anthropic: 'bg-marker-knot/20 border-marker-knot text-[#b3431f]'
}
const providerLabel: Record<Provider, string> = { openai: 'OpenAI', anthropic: 'Anthropic' }

export function ProviderBadge({ provider }: { provider: Provider }): JSX.Element {
  return (
    <span
      className={`doodle-chip doodle-edge border-2 px-2 py-0 text-xs font-bold ${providerStyle[provider]}`}
    >
      {providerLabel[provider]}
    </span>
  )
}

export function KindBadge({ kind }: { kind: CredentialKind }): JSX.Element {
  const t = useT()
  const isOauth = kind === 'oauth'
  return (
    <span
      className={`doodle-chip doodle-edge border-2 px-2 py-0 text-xs ${
        isOauth ? 'border-marker-violet bg-marker-violet/15' : 'border-ink/40 bg-ink/5'
      }`}
    >
      {isOauth ? t('badge.oauth') : t('badge.apikey')}
    </span>
  )
}

/** A small status dot: green = ok, coral = failed, grey = untested/unknown. */
export function StatusDot({ ok }: { ok?: boolean }): JSX.Element {
  const color = ok === true ? 'bg-marker-green' : ok === false ? 'bg-marker-coral' : 'bg-ink/25'
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />
}
