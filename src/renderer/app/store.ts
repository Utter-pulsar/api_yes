import { create } from 'zustand'
import type { CredentialView, Id, ProxyEndpoint, ProxyServerStatus } from '@shared/types'
import type { UpdateStatus } from '@shared/api/contract'
import { api } from './lib/bridge'

export type Theme = 'paper' | 'dark'
const THEME_KEY = 'api-yes-theme'
const readTheme = (): Theme => (localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'paper')
const applyTheme = (t: Theme): void => {
  document.documentElement.classList.toggle('dark', t === 'dark')
}
applyTheme(readTheme())

export type Lang = 'zh' | 'en'
const LANG_KEY = 'api-yes-lang'
const readLang = (): Lang => (localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'zh')

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  message: string
}

interface AppState {
  ready: boolean
  credentials: CredentialView[]
  proxies: ProxyEndpoint[]
  proxyStatus: ProxyServerStatus

  theme: Theme
  toggleTheme: () => void

  lang: Lang
  setLang: (lang: Lang) => void

  /** credential open in the detail pane */
  selectedId: Id | null
  select: (id: Id | null) => void

  /** transient toasts (top-right) */
  toasts: Toast[]
  toast: (kind: Toast['kind'], message: string) => void
  dismissToast: (id: number) => void

  /** in-app prompt/confirm (Electron's native dialogs look off) */
  dialog: {
    kind: 'prompt' | 'confirm'
    title: string
    defaultValue: string
    resolve: (value: string | boolean | null) => void
  } | null
  askPrompt: (title: string, defaultValue?: string) => Promise<string | null>
  askConfirm: (title: string) => Promise<boolean>

  updateStatus: UpdateStatus
  checkForUpdate: () => void

  init: () => Promise<void>
  reloadCredentials: () => Promise<void>
  reloadProxies: () => Promise<void>

  // selectors — return STABLE references only (find→element ref). NEVER add a selector that
  // returns a fresh array/object: zustand v5's useSyncExternalStore would loop forever. Derive
  // filtered/sorted lists in the component with useMemo over the raw `proxies`/`credentials`.
  credentialById: (id: Id) => CredentialView | undefined
}

let toastSeq = 1

export const useStore = create<AppState>((set, get) => ({
  ready: false,
  credentials: [],
  proxies: [],
  proxyStatus: { running: false, host: '127.0.0.1', port: 8788 },

  theme: readTheme(),
  toggleTheme: () => {
    const next: Theme = get().theme === 'dark' ? 'paper' : 'dark'
    localStorage.setItem(THEME_KEY, next)
    applyTheme(next)
    set({ theme: next })
  },

  lang: readLang(),
  setLang: (lang) => {
    localStorage.setItem(LANG_KEY, lang)
    set({ lang })
    // mirror into persisted settings so the main process can localize its own messages
    void api.command('settings.update', { patch: { lang } })
  },

  selectedId: null,
  select: (id) => set({ selectedId: id }),

  toasts: [],
  toast: (kind, message) => {
    const id = toastSeq++
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }))
    setTimeout(() => get().dismissToast(id), 3600)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  dialog: null,
  askPrompt: (title, defaultValue = '') =>
    new Promise<string | null>((resolve) =>
      set({
        dialog: { kind: 'prompt', title, defaultValue, resolve: (v) => resolve(v as string | null) }
      })
    ),
  askConfirm: (title) =>
    new Promise<boolean>((resolve) =>
      set({ dialog: { kind: 'confirm', title, defaultValue: '', resolve: (v) => resolve(!!v) } })
    ),

  updateStatus: { phase: 'idle' },
  checkForUpdate: () => {
    set({ updateStatus: { phase: 'checking' } })
    void api.command('update.check', undefined)
  },

  init: async () => {
    const [credentials, proxies, proxyStatus] = await Promise.all([
      api.query('credentials.list', undefined),
      api.query('proxies.list', {}),
      api.query('proxy.status', undefined)
    ])
    // keep a stable selection: first credential by default
    const selectedId = get().selectedId ?? credentials[0]?.id ?? null
    set({ credentials, proxies, proxyStatus, selectedId, ready: true })

    // the renderer (localStorage) is the source of truth for language — push it into persisted
    // settings on startup so the main process localizes its messages to match what the user sees
    void api.command('settings.update', { patch: { lang: get().lang } })

    api.on('credentials.changed', (credentials) => {
      set((s) => {
        const stillThere = credentials.some((c) => c.id === s.selectedId)
        return {
          credentials,
          selectedId: stillThere ? s.selectedId : (credentials[0]?.id ?? null)
        }
      })
    })
    api.on('proxies.changed', (proxies) => set({ proxies }))
    api.on('proxy.usage', ({ proxyId, usage }) =>
      set((s) => ({
        proxies: s.proxies.map((p) => (p.id === proxyId ? { ...p, usage } : p))
      }))
    )
    api.on('proxy.status', (proxyStatus) => set({ proxyStatus }))
    api.on('update.status', (status) => set({ updateStatus: status }))
    api.on('toast', ({ kind, message }) => get().toast(kind, message))
  },

  reloadCredentials: async () => {
    set({ credentials: await api.query('credentials.list', undefined) })
  },
  reloadProxies: async () => {
    set({ proxies: await api.query('proxies.list', {}) })
  },

  credentialById: (id) => get().credentials.find((c) => c.id === id)
}))
