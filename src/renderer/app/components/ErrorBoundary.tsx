import { Component, type ErrorInfo, type ReactNode } from 'react'
import { translate, type Lang } from '../lib/i18n'

const curLang = (): Lang => (localStorage.getItem('api-yes-lang') === 'en' ? 'en' : 'zh')

interface State {
  error: Error | null
}

/**
 * Catches render-time crashes so a bug shows a friendly hand-drawn message (with the error +
 * a reload button) instead of silently blanking the whole window.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[renderer] render crash:', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    const lang = curLang()
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 font-doodle">
        <div className="text-2xl font-bold">{translate(lang, 'error.title')}</div>
        <div className="max-w-lg whitespace-pre-wrap rounded-[10px] border-2 border-marker-coral bg-card/70 p-4 text-sm text-marker-coral">
          {this.state.error.message}
        </div>
        <button
          onClick={() => location.reload()}
          className="rounded-[8px] border-2 border-ink px-5 py-1.5 text-base hover:bg-marker-yellow/40"
        >
          {translate(lang, 'error.reload')}
        </button>
      </div>
    )
  }
}
