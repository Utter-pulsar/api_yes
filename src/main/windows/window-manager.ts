import { join } from 'node:path'
import { BrowserWindow, Menu, Tray, app, nativeImage, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { APP_AUTHOR, APP_NAME } from '@shared/constants'
import type { EventMap } from '@shared/api/contract'
import { IPC } from '@shared/api/channels'
import type { AppCore } from '../services/context'
import { mt, setMainLang } from '../services/i18n'

const PRELOAD = join(__dirname, '../preload/index.js')

function loadEntry(win: BrowserWindow): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/app/index.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/app/index.html'))
  }
}

/**
 * Owns the single main window, the run-in-background tray, and the window-chrome /
 * app-metadata query/command handlers. The window is frameless on Win/Linux (renderer
 * draws its own min/max/close) and 'hidden'-titlebar on macOS (native traffic lights).
 */
export class WindowManager {
  private main: BrowserWindow | null = null
  private tray: Tray | null = null
  private readonly core: AppCore
  private quitting = false

  constructor(core: AppCore) {
    this.core = core

    app.on('before-quit', () => {
      this.quitting = true
    })

    core.queries.register('app.info', () => ({
      name: APP_NAME,
      version: app.getVersion(),
      author: APP_AUTHOR
    }))

    core.commands.register('window.minimize', () => this.main?.minimize())
    core.commands.register('window.toggleMaximize', () => {
      const w = this.main
      if (!w || w.isDestroyed()) return
      if (w.isMaximized()) w.unmaximize()
      else w.maximize()
    })
    core.commands.register('window.close', () => this.main?.close())
    core.queries.register('window.isMaximized', () => this.main?.isMaximized() ?? false)

    core.commands.register('shell.openExternal', ({ url }) => void shell.openExternal(url))

    // ---- settings: read + write (write applies tray / login-item side effects) ----
    core.queries.register('settings.get', () => ({ ...core.store.data.settings }))
    core.commands.register('settings.update', ({ patch }) => {
      const prevLang = core.store.data.settings.lang
      core.store.mutate((db) => {
        db.settings = { ...db.settings, ...patch }
      })
      if (patch.launchAtLogin !== undefined && app.isPackaged) {
        app.setLoginItemSettings({ openAtLogin: patch.launchAtLogin })
      }
      if (patch.runInBackground !== undefined) this.syncTray()
      // mirror the renderer's language switch into the main process, then relabel the tray
      if (patch.lang !== undefined && patch.lang !== prevLang) {
        setMainLang(patch.lang)
        this.refreshTrayMenu()
      }
      // let other services (e.g. the proxy server) react to host/port changes
      core.events.emit('settings.changed', { ...core.store.data.settings })
      return { ...core.store.data.settings }
    })
  }

  createMainWindow(): void {
    if (this.main && !this.main.isDestroyed()) {
      this.showMain()
      return
    }
    this.main = new BrowserWindow({
      width: 1120,
      height: 740,
      minWidth: 880,
      minHeight: 580,
      title: APP_NAME,
      backgroundColor: '#FBF7EF',
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      ...(is.dev ? { icon: join(process.cwd(), 'build', 'icon.png') } : {}),
      show: false,
      webPreferences: { preload: PRELOAD, sandbox: false }
    })
    const reveal = (): void => {
      if (this.main && !this.main.isDestroyed() && !this.main.isVisible()) this.main.show()
    }
    this.main.on('ready-to-show', reveal)
    this.main.webContents.on('did-finish-load', reveal)
    this.main.webContents.on('did-fail-load', (_e, code, desc, url) =>
      console.log(`[main] did-fail-load code=${code} "${desc}" url=${url}`)
    )
    setTimeout(reveal, 2500)
    this.main.on('session-end', () => {
      this.quitting = true
      this.core.store.flush()
    })
    this.main.on('close', (e) => {
      if (!this.quitting && this.core.store.data.settings.runInBackground) {
        e.preventDefault()
        this.main?.hide()
        if (process.platform === 'darwin') app.dock?.hide()
      }
    })
    this.main.on('closed', () => {
      this.main = null
      if (!this.quitting) app.quit()
    })
    const emitMaximized = (): void =>
      this.core.events.emit('window.maximized', this.main?.isMaximized() ?? false)
    this.main.on('maximize', emitMaximized)
    this.main.on('unmaximize', emitMaximized)
    if (is.dev) {
      this.main.webContents.on('console-message', (_e, level, message, line, source) => {
        if (level >= 2) console.log(`[renderer] ${message} (${source}:${line})`)
      })
    }
    loadEntry(this.main)
    this.syncTray()
  }

  broadcast<K extends keyof EventMap>(name: K, payload: EventMap[K]): void {
    if (this.main && !this.main.isDestroyed()) {
      this.main.webContents.send(IPC.EVENT, { name, payload })
    }
  }

  getMain(): BrowserWindow | null {
    return this.main
  }

  showMain(): void {
    if (this.main && !this.main.isDestroyed()) {
      if (this.main.isMinimized()) this.main.restore()
      this.main.show()
      this.main.focus()
    } else {
      this.createMainWindow()
    }
    if (process.platform === 'darwin') app.dock?.show()
  }

  private syncTray(): void {
    const enabled = this.core.store.data.settings.runInBackground
    if (enabled && !this.tray) this.createTray()
    else if (!enabled && this.tray) {
      this.tray.destroy()
      this.tray = null
    }
  }

  private createTray(): void {
    const iconPath = is.dev
      ? join(process.cwd(), 'assets', 'logo.png')
      : join(process.resourcesPath, 'assets', 'logo.png')
    const image = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    if (image.isEmpty()) console.warn(`[tray] icon failed to load from ${iconPath}`)
    const tray = new Tray(image)
    tray.setToolTip(APP_NAME)
    this.tray = tray
    this.refreshTrayMenu()
    tray.on('click', () => this.showMain())
  }

  /** (Re)apply the tray context menu with labels in the current language. No-op if no tray. */
  private refreshTrayMenu(): void {
    if (!this.tray) return
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: mt('tray.show', { app: APP_NAME }), click: () => this.showMain() },
        { type: 'separator' },
        { label: mt('tray.quit'), click: () => app.quit() }
      ])
    )
  }
}
