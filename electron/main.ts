import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, globalShortcut } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { DatabaseService } from './services/database'
import { FileIndexer } from './services/indexer'
import { FileWatcher } from './services/file-watcher'
import { IpcHandlers } from './services/ipc-handlers'

// const require = createRequire(import.meta.url) // Unused
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
let tray: Tray | null = null
let db: DatabaseService
let indexer: FileIndexer
let fileWatcher: FileWatcher
let ipcHandlers: IpcHandlers
let isQuitting = false
let hasTriggeredAutoIndexing = false

// Global error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit the process, just log the error
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process, just log the error
});

function createTray() {
  // Create tray icon
  const iconPath = path.join(process.env.VITE_PUBLIC || '', 'icon.png')
  let trayIcon: Electron.NativeImage

  try {
    trayIcon = nativeImage.createFromPath(iconPath)
    if (trayIcon.isEmpty()) {
      // Create a simple programmatic icon if file doesn't exist
      trayIcon = nativeImage.createFromDataURL('data:image/svg+xml;base64,' +
        Buffer.from(`<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <circle cx="7" cy="7" r="3" stroke="currentColor" stroke-width="1" fill="none"/>
          <path d="m9.5 9.5 2.5 2.5" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
        </svg>`).toString('base64'))
    }
  } catch {
    // Fallback to a simple icon if file doesn't exist
    trayIcon = nativeImage.createFromDataURL('data:image/svg+xml;base64,' +
      Buffer.from(`<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <circle cx="7" cy="7" r="3" stroke="currentColor" stroke-width="1" fill="none"/>
        <path d="m9.5 9.5 2.5 2.5" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
      </svg>`).toString('base64'))
  }

  tray = new Tray(trayIcon)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Seekr',
      click: () => {
        win?.show()
        win?.focus()
      }
    },
    {
      label: 'Search...',
      accelerator: 'CmdOrCtrl+F',
      click: () => {
        win?.show()
        win?.focus()
        win?.webContents.send('focus-search')
      }
    },
    { type: 'separator' },
    {
      label: 'Start Indexing',
      click: () => {
        win?.webContents.send('start-indexing-from-tray')
      }
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        win?.show()
        win?.focus()
        win?.webContents.send('open-settings')
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)
  tray.setToolTip('Seekr - Lightning fast file finder')

  // Double click to show window
  tray.on('double-click', () => {
    win?.show()
    win?.focus()
  })
}

async function initializeServices() {
  try {
    // Initialize database
    db = new DatabaseService()
    await db.initialize()

    // Initialize indexer
    indexer = new FileIndexer(db)

    // Initialize file watcher
    fileWatcher = new FileWatcher(db)

    // Setup IPC handlers
    ipcHandlers = new IpcHandlers(db, indexer, fileWatcher)
    // IPC handlers are automatically registered in the constructor

    console.log('Services initialized successfully')
  } catch (error) {
    console.error('Failed to initialize services:', error)
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false, // Remove default frame for custom controls
    transparent: true, // Enable transparency for glassmorphism
    vibrancy: 'under-window', // macOS vibrancy effect
    backgroundMaterial: 'acrylic', // Windows acrylic effect
    icon: path.join(process.env.VITE_PUBLIC, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false, // Don't show until ready
    skipTaskbar: false,
  })

  // Window event handlers
  win.once('ready-to-show', () => {
    win?.show()

    // Start automatic indexing on first run (only once)
    setTimeout(async () => {
      if (hasTriggeredAutoIndexing) {
        return;
      }

      try {
        const response = await win?.webContents.executeJavaScript(`
          window.fileSearchAPI?.getFileCount().then(r => r.data?.count || 0)
        `)

        if (response === 0) {
          hasTriggeredAutoIndexing = true;
          // Auto-start indexing if no files are indexed
          win?.webContents.send('auto-start-indexing')
        }
      } catch (error) {
        console.log('Auto-indexing check failed:', error)
      }
    }, 2000)
  })

  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      win?.hide()

      // Show notification on first minimize
      if (process.platform === 'win32') {
        win?.webContents.send('show-tray-notification')
      }
    }
  })

  win.on('minimize', (event: Electron.Event) => {
    event.preventDefault()
    win?.hide()
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    // Clean up services
    if (indexer) {
      indexer.stopIndexing()
    }
    if (fileWatcher) {
      await fileWatcher.stopWatching()
    }
    if (db) {
      await db.close()
    }
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// Custom window controls IPC handlers
ipcMain.handle('window-minimize', () => {
  win?.minimize()
})

ipcMain.handle('window-maximize', () => {
  if (win?.isMaximized()) {
    win.unmaximize()
  } else {
    win?.maximize()
  }
})

ipcMain.handle('window-close', () => {
  win?.hide()
})

ipcMain.handle('window-is-maximized', () => {
  return win?.isMaximized() || false
})

ipcMain.handle('app-quit', () => {
  isQuitting = true
  app.quit()
})

// Global shortcut for showing app
app.whenReady().then(async () => {
  await initializeServices()
  createWindow()
  createTray()

  // Register global shortcut
  globalShortcut.register('CmdOrCtrl+Shift+F', () => {
    if (win?.isVisible()) {
      win.hide()
    } else {
      win?.show()
      win?.focus()
    }
  })
})
