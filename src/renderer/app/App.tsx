import { useEffect } from 'react'
import { useStore } from './store'
import { useT } from './lib/i18n'
import { DoodleFilter } from './components/DoodleFilter'
import { TitleBar } from './components/TitleBar'
import { DoodleDialog } from './components/DoodleDialog'
import { Toasts } from './components/Toasts'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Sidebar } from './features/credentials/Sidebar'
import { CredentialDetail } from './features/credentials/CredentialDetail'

export default function App(): JSX.Element {
  const init = useStore((s) => s.init)
  const ready = useStore((s) => s.ready)
  const t = useT()

  useEffect(() => {
    void init()
  }, [init])

  return (
    <div className="flex h-full flex-col">
      <DoodleFilter />
      <TitleBar />

      <main className="relative flex min-h-0 flex-1">
        <ErrorBoundary>
          {!ready ? (
            <div className="flex h-full w-full items-center justify-center font-doodle text-xl opacity-60">
              {t('app.loading')}
            </div>
          ) : (
            <>
              <Sidebar />
              <CredentialDetail />
            </>
          )}
        </ErrorBoundary>
      </main>

      <Toasts />
      <DoodleDialog />
    </div>
  )
}
