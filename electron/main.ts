import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  session,
  shell,
  Tray,
} from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import log from 'electron-log/main'
import { DatabaseService } from './services/database'
import { FileIndexer } from './services/indexer'
import { FileWatcher } from './services/file-watcher'
import { IpcHandlers } from './services/ipc-handlers'
import { SettingsStore } from './services/settings'
import { getSystemInfo } from './services/platform'
import { IpcChannel, IpcEvent } from './ipc/channels'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null = null
let tray: Tray | null = null
let db: DatabaseService | null = null
let indexer: FileIndexer | null = null
let fileWatcher: FileWatcher | null = null
let ipcHandlers: IpcHandlers | null = null
let settings: SettingsStore | null = null
let isQuitting = false

log.initialize()
log.errorHandler.startCatching({ showDialog: false })

// Previously both of these were swallowed with a "don't exit" comment, which
// left the app running in an unknown state with nothing recorded anywhere a
// user could find. Log to disk instead; electron-log writes to the standard
// per-platform log directory.
process.on('uncaughtException', (error) => {
  log.error('Uncaught exception:', error)
})
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection:', reason)
})

/**
 * A second instance would open a second better-sqlite3 writer against the same
 * WAL database, register the same global shortcut, and create a second tray.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
  void bootstrap()
}

// ---------------------------------------------------------------- security --

/**
 * Blocks the two ways a renderer can navigate itself somewhere we do not
 * control: `window.open` and in-place navigation. Both would otherwise load
 * arbitrary content with our preload attached.
 */
function hardenWebContents(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    // External links belong in the user's browser, never in an app window.
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    const isDevServer = VITE_DEV_SERVER_URL && url.startsWith(VITE_DEV_SERVER_URL)
    if (!isDevServer && !url.startsWith('file://')) {
      event.preventDefault()
      log.warn('Blocked navigation to', url)
    }
  })

  contents.on('will-attach-webview', (event) => {
    // No part of this app uses <webview>.
    event.preventDefault()
  })
}

/**
 * CSP is delivered as a response header rather than only a <meta> tag so it
 * also covers the dev server. 'unsafe-inline' for styles is required by the
 * styled-jsx/Tailwind runtime injection; scripts get no such exemption.
 */
function applyContentSecurityPolicy(): void {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // The renderer talks to main over IPC; it needs no network access at all.
    // The dev server needs its HMR websocket.
    VITE_DEV_SERVER_URL ? "connect-src 'self' ws: http://localhost:*" : "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    })
  })

  // Nothing in this app requests camera, mic, geolocation, or notifications.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
}

// ------------------------------------------------------------------ window --

/** Window options that differ per platform. See §3 of the redesign plan. */
function platformWindowOptions(): Electron.BrowserWindowConstructorOptions {
  const info = getSystemInfo()

  if (info.isMac) {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 16 },
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
      backgroundColor: '#00000000',
    }
  }

  if (info.isWindows) {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: '#8a8a8a', height: 36 },
      // `transparent: true` conflicts with backgroundMaterial and renders the
      // window black, so it is deliberately not set here.
      ...(info.supportsMica ? { backgroundMaterial: 'mica' as const } : {}),
      backgroundColor: info.supportsMica ? '#00000000' : '#1a1a1a',
    }
  }

  // Linux compositors vary too much for transparency to be safe by default.
  return { frame: true, backgroundColor: '#1a1a1a' }
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    icon: path.join(process.env.VITE_PUBLIC, 'icon.png'),
    ...platformWindowOptions(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // Explicit rather than relying on Electron's defaults, so a future
      // upgrade cannot silently weaken them.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
    },
  })

  hardenWebContents(win.webContents)

  win.once('ready-to-show', () => win?.show())

  // Replaces the renderer's 1s `isMaximized()` IPC poll.
  const emitMaximized = () =>
    win?.webContents.send(IpcEvent.WindowMaximizedChanged, win.isMaximized())
  win.on('maximize', emitMaximized)
  win.on('unmaximize', emitMaximized)

  win.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    win?.hide()
  })

  // The old code also intercepted 'minimize' and turned it into hide(), which
  // broke the standard minimize-to-Dock gesture on macOS. Minimize now means
  // minimize; closing is what sends the app to the tray.

  win.on('closed', () => {
    win = null
  })

  if (VITE_DEV_SERVER_URL) {
    void win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    void win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

function showWindow(): void {
  if (!win) {
    createWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

// -------------------------------------------------------------------- tray --

function createTray(): void {
  const info = getSystemInfo()
  const source = nativeImage.createFromPath(path.join(process.env.VITE_PUBLIC, 'icon.png'))

  // The source icon is ~1000px. Handing that to Tray produces an oversized
  // menu-bar icon; macOS additionally needs a template image so it inverts
  // correctly in light and dark menu bars.
  const trayIcon = source.isEmpty()
    ? nativeImage.createEmpty()
    : source.resize({ width: 16, height: 16 })
  if (info.isMac) trayIcon.setTemplateImage(true)

  tray = new Tray(trayIcon)
  tray.setToolTip('Seekr')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Seekr', click: showWindow },
      {
        label: 'Search…',
        click: () => {
          showWindow()
          win?.webContents.send(IpcEvent.FocusSearch)
        },
      },
      { type: 'separator' },
      {
        label: 'Start Indexing',
        click: () => {
          showWindow()
          win?.webContents.send(IpcEvent.StartIndexingFromTray)
        },
      },
      {
        label: 'Settings…',
        click: () => {
          showWindow()
          win?.webContents.send(IpcEvent.OpenSettings)
        },
      },
      { type: 'separator' },
      {
        label: 'Quit Seekr',
        accelerator: info.isMac ? 'Cmd+Q' : 'Ctrl+Q',
        click: () => {
          isQuitting = true
          app.quit()
        },
      },
    ]),
  )

  // Single click is the Windows and Linux convention; macOS opens the menu.
  if (!info.isMac) tray.on('click', showWindow)
}

// ---------------------------------------------------------------- lifecycle --

function registerWindowHandlers(): void {
  ipcMain.handle(IpcChannel.WindowMinimize, () => win?.minimize())
  ipcMain.handle(IpcChannel.WindowMaximizeToggle, () => {
    if (!win) return
    win.isMaximized() ? win.unmaximize() : win.maximize()
  })
  ipcMain.handle(IpcChannel.WindowHide, () => win?.hide())
  ipcMain.handle(IpcChannel.WindowIsMaximized, () => win?.isMaximized() ?? false)
  ipcMain.handle(IpcChannel.AppQuit, () => {
    isQuitting = true
    app.quit()
  })
}

function registerGlobalShortcut(): void {
  const accelerator = settings?.get().globalHotkey ?? 'CmdOrCtrl+Shift+F'
  const registered = globalShortcut.register(accelerator, () => {
    if (win?.isVisible() && win.isFocused()) {
      win.hide()
    } else {
      showWindow()
    }
  })

  // The old code ignored this return value, so a conflicting shortcut failed
  // silently and the user had no way to find out.
  if (!registered) {
    log.warn(`Global shortcut "${accelerator}" could not be registered (already in use?)`)
  }
}

async function initializeServices(): Promise<void> {
  settings = new SettingsStore()
  db = new DatabaseService()
  await db.initialize()
  indexer = new FileIndexer(db)
  fileWatcher = new FileWatcher(db)
  ipcHandlers = new IpcHandlers(db, indexer, fileWatcher, settings)
}

/** Runs on every exit path, on every platform. */
async function shutdown(): Promise<void> {
  globalShortcut.unregisterAll()
  ipcHandlers?.dispose()
  indexer?.stopIndexing()
  try {
    await fileWatcher?.stopWatching()
  } catch (error) {
    log.warn('Watcher shutdown failed:', error)
  }
  try {
    // Previously guarded behind `platform !== 'darwin'` inside a handler that
    // never fired, so the WAL was never checkpointed on macOS.
    await db?.close()
  } catch (error) {
    log.warn('Database shutdown failed:', error)
  }
  tray?.destroy()
  tray = null
}

async function bootstrap(): Promise<void> {
  await app.whenReady()

  // Required for correct taskbar grouping and notification identity on Windows.
  if (process.platform === 'win32') app.setAppUserModelId('com.k6w.seekr')
  // Lets the xdg-desktop-portal GlobalShortcuts backend identify us on Wayland.
  if (process.platform === 'linux') app.setDesktopName('seekr.desktop')

  applyContentSecurityPolicy()

  try {
    await initializeServices()
  } catch (error) {
    log.error('Failed to initialize services:', error)
  }

  registerWindowHandlers()
  createWindow()
  createTray()
  registerGlobalShortcut()

  /**
   * Packaged-app smoke test (scripts/smoke-packaged.cjs).
   *
   * Proves the app launched AND the native better-sqlite3 binding loaded --
   * the failure mode that asarUnpack exists to prevent, and that a
   * "did a file get produced?" CI check cannot detect.
   */
  if (process.env.SEEKR_SMOKE_TEST === '1') {
    const healthy = db !== null
    process.stdout.write(healthy ? 'SEEKR_SMOKE_OK\n' : 'SEEKR_SMOKE_FAIL: database unavailable\n')
    isQuitting = true
    setTimeout(() => app.exit(healthy ? 0 : 1), 500)
    return
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showWindow()
  })
}

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', (event) => {
  if (!db && !fileWatcher) return
  event.preventDefault()
  void shutdown().finally(() => {
    db = null
    fileWatcher = null
    app.exit(0)
  })
})

// The window closes to the tray, so this only fires once the user really quits.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Defence in depth: even if a window is created outside createWindow().
app.on('web-contents-created', (_event, contents) => hardenWebContents(contents))
