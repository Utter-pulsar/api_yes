import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { AppCore } from './context'
import { mt } from './i18n'

/**
 * Manual, fully-automatic self-update via electron-updater against the GitHub Releases feed in
 * electron-builder.yml (`publish: github`). The user presses 检查更新 in the 版本 card; the whole
 * flow runs on its own: check → download (progress broadcast as `update.status`) → quit → install
 * silently → relaunch. Only meaningful in a PACKAGED build; macOS is skipped (unsigned builds
 * can't self-update).
 */
function canUpdate(): boolean {
  if (!app.isPackaged) return false
  if (process.platform === 'darwin') return false
  return true
}

let wired = false
function wireOnce(core: AppCore): void {
  if (wired) return
  wired = true
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => core.broadcast('update.status', { phase: 'checking' }))
  autoUpdater.on('update-not-available', () => core.broadcast('update.status', { phase: 'none' }))
  autoUpdater.on('update-available', (i) =>
    core.broadcast('update.status', { phase: 'downloading', percent: 0, version: i.version })
  )
  autoUpdater.on('download-progress', (p) => {
    const percent = Math.max(0, Math.min(100, Math.round(p.percent)))
    core.broadcast('update.status', { phase: 'downloading', percent })
  })
  autoUpdater.on('update-downloaded', (i) => {
    core.broadcast('update.status', { phase: 'installing', version: i.version })
    setImmediate(() => autoUpdater.quitAndInstall(true, true))
  })
  autoUpdater.on('error', (e) =>
    core.broadcast('update.status', { phase: 'error', message: e?.message ?? String(e) })
  )
}

export function registerUpdater(core: AppCore): void {
  core.commands.register('update.check', () => {
    if (!canUpdate()) {
      core.broadcast('update.status', {
        phase: 'error',
        message: app.isPackaged ? mt('update.unsupported') : mt('update.devMode')
      })
      return
    }
    wireOnce(core)
    core.broadcast('update.status', { phase: 'checking' })
    autoUpdater
      .checkForUpdates()
      .catch((e) =>
        core.broadcast('update.status', { phase: 'error', message: e?.message ?? String(e) })
      )
  })
}
