import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { APP_NAME } from '@shared/constants'
import { Store } from './services/store'
import { createAppCore } from './services/context'
import { registerCredentialService } from './services/credential-service'
import { registerProxyService } from './services/proxy-service'
import { registerOAuthService } from './services/oauth-service'
import { registerUpdater } from './services/updater'
import { ProxyServer } from './services/proxy-server'
import { WindowManager } from './windows/window-manager'
import { registerIpc } from './ipc/register-ipc'

// single instance — a desktop gateway should never run twice (the proxy port would clash)
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let store: Store | null = null
let proxyServer: ProxyServer | null = null

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.utterpulsar.apiyes')
  app.setName(APP_NAME)
  // dev gets its OWN data folder so hacking never clobbers an installed copy's store
  if (!app.isPackaged) {
    const devData = join(app.getPath('appData'), `${APP_NAME}-dev`)
    mkdirSync(devData, { recursive: true })
    app.setPath('userData', devData)
  }

  store = Store.open()
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: store.data.settings.launchAtLogin })
  }
  const core = createAppCore(store)

  // services register their query/command handlers
  registerCredentialService(core)
  registerOAuthService(core)
  registerUpdater(core)

  // windows must exist before events are emitted so broadcast can deliver them
  const windows = new WindowManager(core)
  core.broadcast = windows.broadcast.bind(windows)

  proxyServer = new ProxyServer(core)
  registerProxyService(core, proxyServer)

  registerIpc(core)

  windows.createMainWindow()

  if (store.data.settings.proxyAutoStart) void proxyServer.start()

  app.on('browser-window-created', (_e, win) => optimizer.watchWindowShortcuts(win))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) windows.createMainWindow()
    else windows.showMain()
  })

  app.on('second-instance', () => windows.showMain())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !store?.data.settings.runInBackground) app.quit()
})

app.on('before-quit', () => {
  void proxyServer?.stop()
  store?.flush()
})
