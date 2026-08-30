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
import { IpcHandlers } from './services/ipc-handlers'
import { SettingsStore } from './services/settings'
import { IndexReader } from './services/index-reader'
import { getSystemInfo } from './services/platform'
import { EngineHost } from './engine/host'
import { ENGINE_PORT_CHANNEL } from './engine/protocol'
import { IpcChannel, IpcEvent } from './ipc/channels'
import { createOverlayWindow, resizeOverlay, toggleOverlay } from './windows/overlay'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null = null
let overlay: BrowserWindow | null = null
let tray: Tray | null = null
let settings: SettingsStore | null = null
let ipcHandlers: IpcHandlers | null = null
let engineHost: EngineHost | null = null
let indexReader: IndexReader | null = null
let isQuitting = false

log.initialize()
log.errorHandler.startCatching({ showDialog: false })

// Previously both were swallowed with a "don't exit" comment, leaving the app
// running in an unknown state with nothing recorded anywhere a user could find.
process.on('uncaughtException', (error) => log.error('Uncaught exception:', error))
process.on('unhandledRejection', (reason) => log.error('Unhandled rejection:', reason))

/**
 * A second instance would open a second writer against the same WAL database,
 * register the same global shortcut, and create a second tray.
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

  // No part of this app uses <webview>.
  contents.on('will-attach-webview', (event) => event.preventDefault())

  /**
   * Renderer console and load failures, into the app log.
   *
   * Without this, a renderer that throws on boot shows the user a blank window
   * and leaves no trace anywhere they can reach -- devtools are not available
   * in a packaged build.
   */
  contents.on('console-message', (event) => {
    const line = `[renderer] ${event.message} (${event.sourceId}:${event.lineNumber})`
    if (event.level === 'error') log.error(line)
    else if (event.level === 'warning') log.warn(line)
    else log.info(line)
  })

  contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    log.error(`Renderer failed to load ${validatedURL}: ${errorDescription} (${errorCode})`)
  })

  contents.on('render-process-gone', (_event, details) => {
    log.error('Renderer process gone:', details.reason, details.exitCode)
  })

  contents.on('preload-error', (_event, preloadPath, error) => {
    log.error(`Preload failed at ${preloadPath}:`, error)
  })
}

/**
 * Delivered as a response header as well as a meta tag, so the dev server is
 * covered too. Styles need 'unsafe-inline' for Tailwind's runtime injection;
 * scripts get no such exemption.
 */
function applyContentSecurityPolicy(): void {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // The renderer reaches the engine over a MessagePort and main over IPC, so
    // it needs no network access. The dev server needs its HMR websocket.
    VITE_DEV_SERVER_URL ? "connect-src 'self' ws: http://localhost:*" : "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] },
    })
  })

  // Nothing here needs camera, mic, geolocation or notifications.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
}

// ------------------------------------------------------------------ window --

/** Window options that differ per platform. */
function platformWindowOptions(): Electron.BrowserWindowConstructorOptions {
  const info = getSystemInfo()

  if (info.isMac) {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 14 },
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
      // window black, so it is deliberately not set.
      ...(info.supportsMica ? { backgroundMaterial: 'mica' as const } : {}),
      backgroundColor: info.supportsMica ? '#00000000' : '#141414',
    }
  }

  // Linux compositors vary too much for transparency to be safe by default.
  return { frame: true, backgroundColor: '#141414' }
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
      // Explicit rather than relying on defaults, so an upgrade cannot
      // silently weaken them.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
    },
  })

  hardenWebContents(win.webContents)

  win.once('ready-to-show', () => win?.show())

  // Give this renderer its own direct channel to the engine, so search traffic
  // never passes through the main process.
  win.webContents.on('did-finish-load', () => {
    if (win) attachEngine(win)
  })

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

  // 'minimize' is deliberately not intercepted. The old code turned it into
  // hide(), which broke the standard minimize-to-Dock gesture on macOS.

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

function attachEngine(window: BrowserWindow): void {
  if (!engineHost?.attachRenderer(window.webContents, ENGINE_PORT_CHANNEL)) {
    log.error('Engine is not running; this renderer has no search capability')
  }
}

function createOverlay(): void {
  overlay = createOverlayWindow({
    preloadPath: path.join(__dirname, 'preload.cjs'),
    devServerUrl: VITE_DEV_SERVER_URL,
    rendererDist: RENDERER_DIST,
    // The palette gets its own port to the engine, so summoning it never
    // competes with the main window for the main process.
    onCreated: (window) => {
      hardenWebContents(window.webContents)
      attachEngine(window)
    },
  })
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
        label: 'Rebuild Index',
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
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle(IpcChannel.WindowHide, () => win?.hide())
  ipcMain.handle(IpcChannel.WindowIsMaximized, () => win?.isMaximized() ?? false)
  ipcMain.handle(IpcChannel.OverlayResize, (_event, height: unknown) => {
    if (overlay && typeof height === 'number' && Number.isFinite(height)) {
      resizeOverlay(overlay, height)
    }
  })
  ipcMain.handle(IpcChannel.AppQuit, () => {
    isQuitting = true
    app.quit()
  })
}

function registerGlobalShortcut(): void {
  const accelerator = settings?.get().globalHotkey ?? 'CmdOrCtrl+Shift+F'
  // The hotkey summons the palette, not the browsing window. That is the
  // whole point of having two surfaces: the fast one is what the muscle
  // memory reaches for.
  const registered = globalShortcut.register(accelerator, () => {
    if (overlay) toggleOverlay(overlay)
    else showWindow()
  })

  // The old code ignored this return value, so a conflicting shortcut failed
  // silently and the user had no way to find out.
  if (!registered) {
    log.warn(`Global shortcut "${accelerator}" could not be registered (already in use?)`)
  }
}

/** Runs on every exit path, on every platform. */
async function shutdown(): Promise<void> {
  globalShortcut.unregisterAll()
  ipcHandlers?.dispose()
  indexReader?.close()
  await engineHost?.stop()
  overlay?.destroy()
  overlay = null
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

  const databasePath = path.join(app.getPath('userData'), 'seekr-index.db')

  settings = new SettingsStore()
  indexReader = new IndexReader(databasePath)
  engineHost = new EngineHost(databasePath)
  engineHost.start()

  ipcHandlers = new IpcHandlers(settings, (fullPath) => indexReader!.has(fullPath))

  const engineReady = await engineHost.whenReady()
  if (!engineReady) log.error('Engine failed to start within the timeout')

  registerWindowHandlers()
  createWindow()
  createOverlay()
  createTray()
  registerGlobalShortcut()

  /**
   * Packaged-app smoke test (scripts/smoke-packaged.cjs).
   *
   * Proves the app launched AND the engine process came up with its native
   * binding loaded -- the failure asarUnpack exists to prevent, which a
   * "was a file produced?" CI check cannot detect.
   */
  if (process.env.SEEKR_SMOKE_TEST === '1') {
    // Round-trip a real request so this proves the protocol works, not merely
    // that a process was spawned.
    const count = engineReady ? await engineHost.selfTest() : null
    const healthy = count !== null
    process.stdout.write(
      healthy
        ? `SEEKR_SMOKE_OK indexed=${count}\n`
        : 'SEEKR_SMOKE_FAIL: engine did not answer\n',
    )
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
  if (!engineHost && !indexReader) return
  event.preventDefault()
  void shutdown().finally(() => {
    engineHost = null
    indexReader = null
    app.exit(0)
  })
})

// The window closes to the tray, so this only fires once the user really quits.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Defence in depth, for any window created outside createWindow().
app.on('web-contents-created', (_event, contents) => hardenWebContents(contents))
