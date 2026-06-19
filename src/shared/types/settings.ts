import { DEFAULT_PROXY_PORT } from '../constants'

/** UI language. Mirrored from the renderer so the main process can localize its own messages. */
export type Lang = 'zh' | 'en'

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
}

export const DEFAULT_SETTINGS: AppSettings = {
  proxyPort: DEFAULT_PROXY_PORT,
  proxyAutoStart: true,
  runInBackground: false,
  launchAtLogin: false,
  lang: 'zh'
}
