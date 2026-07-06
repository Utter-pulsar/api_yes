import { DEFAULT_PROXY_PORT } from '../constants'

/** UI language. Mirrored from the renderer so the main process can localize its own messages. */
export type Lang = 'zh' | 'en'

/**
 * Seed for `AppSettings.codexModels` — models that work with a ChatGPT subscription via the Codex
 * backend. There's no public list endpoint, so the list is user-curated (hamburger menu → Codex
 * models); this is only the default. Order matters: cheapest-first for the connectivity probe.
 */
export const DEFAULT_CODEX_MODELS = ['gpt-5.4-mini', 'gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex']

export interface AppSettings {
  /** local reverse-proxy server port */
  proxyPort: number
  /** start the proxy server automatically on launch */
  proxyAutoStart: boolean
  /** keep running (window → tray) after close */
  runInBackground: boolean
  /** register the app to launch at OS login */
  launchAtLogin: boolean
  /** UI language; the source of truth lives in the renderer (localStorage) and is mirrored here */
  lang: Lang
  /** user-curated Codex (ChatGPT subscription) model list, cheapest-first; never edited in place */
  codexModels: string[]
}

export const DEFAULT_SETTINGS: AppSettings = {
  proxyPort: DEFAULT_PROXY_PORT,
  proxyAutoStart: true,
  runInBackground: false,
  launchAtLogin: false,
  lang: 'zh',
  codexModels: [...DEFAULT_CODEX_MODELS]
}
