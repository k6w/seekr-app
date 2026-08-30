import { app, dialog, type BrowserWindow } from 'electron'
import log from 'electron-log/main'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

/**
 * Auto-update.
 *
 * There was no update path at all: `electron-updater` was not a dependency,
 * the builder config had no `publish` block, every build script passed
 * `--publish never`, and releases were uploaded as loose files with no
 * manifest. Anyone on an old version stayed there unless they happened to
 * check the releases page.
 *
 * Download is manual on purpose. This is a search tool people leave running;
 * silently pulling ~130MB in the background on a metered connection is not a
 * decision to make for them.
 */
export function initializeUpdater(getWindow: () => BrowserWindow | null): void {
  // Unsigned local builds cannot be verified, and dev has nothing to update to.
  if (!app.isPackaged) {
    log.info('Updater disabled: not a packaged build')
    return
  }

  autoUpdater.logger = log
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', (error) => {
    // A failed update check must never interrupt the app.
    log.warn('Update check failed:', error?.message ?? error)
  })

  autoUpdater.on('update-available', async (info) => {
    log.info('Update available:', info.version)

    const window = getWindow()
    const { response } = await dialog.showMessageBox(window ?? undefined!, {
      type: 'info',
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: `Seekr ${info.version} is available`,
      detail: `You have ${app.getVersion()}. The update installs the next time you quit.`,
    })

    if (response === 0) await autoUpdater.downloadUpdate()
  })

  autoUpdater.on('update-downloaded', async (info) => {
    const window = getWindow()
    const { response } = await dialog.showMessageBox(window ?? undefined!, {
      type: 'info',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: `Seekr ${info.version} is ready`,
      detail: 'Restart to finish installing, or it will be applied when you next quit.',
    })

    if (response === 0) {
      // The engine holds a database handle; give the normal shutdown path a
      // chance to run before the installer replaces the app bundle.
      setImmediate(() => autoUpdater.quitAndInstall())
    }
  })

  // Delayed so a launch is never slowed by a network round trip.
  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => undefined), 10_000)

  // And once a day for long-running sessions, which is the normal case here.
  setInterval(
    () => void autoUpdater.checkForUpdates().catch(() => undefined),
    24 * 60 * 60 * 1000,
  )
}

/** Manual check, from the menu. Reports "up to date" instead of staying silent. */
export async function checkForUpdatesInteractive(window: BrowserWindow | null): Promise<void> {
  if (!app.isPackaged) {
    await dialog.showMessageBox(window ?? undefined!, {
      type: 'info',
      message: 'Updates are disabled in development builds',
    })
    return
  }

  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result || result.updateInfo.version === app.getVersion()) {
      await dialog.showMessageBox(window ?? undefined!, {
        type: 'info',
        message: 'Seekr is up to date',
        detail: `Version ${app.getVersion()}.`,
      })
    }
  } catch (error) {
    await dialog.showMessageBox(window ?? undefined!, {
      type: 'warning',
      message: 'Could not check for updates',
      detail: error instanceof Error ? error.message : String(error),
    })
  }
}
