import { BrowserWindow, screen } from 'electron'
import path from 'node:path'
import { getSystemInfo } from '../services/platform'
import { IpcEvent } from '../ipc/channels'

const WIDTH = 680
const MIN_HEIGHT = 96
const MAX_HEIGHT = 560
/** Just the query strip and hints; it grows as results arrive. */
const HEIGHT = 96
/** Sits above centre, where the eye already is. Spotlight uses roughly this. */
const VERTICAL_ANCHOR = 0.22

export interface OverlayDeps {
  preloadPath: string
  devServerUrl?: string
  rendererDist: string
  onCreated: (window: BrowserWindow) => void
}

/**
 * The hotkey palette window.
 *
 * On macOS this is `type: 'panel'`, which is what lets it appear over
 * full-screened applications and take key input without pulling the whole app
 * forward. Without it, summoning the palette would yank the user out of their
 * current Space.
 */
export function createOverlayWindow(deps: OverlayDeps): BrowserWindow {
  const info = getSystemInfo()

  const window = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    // The rounded card is drawn by the renderer, so the window itself must not
    // paint a background behind it.
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // Floats over full-screened apps and can be key without becoming main.
    ...(info.isMac ? { type: 'panel' as const, vibrancy: 'hud' as const } : {}),
    webPreferences: {
      preload: deps.preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
    },
  })

  // Above normal windows but below system UI like the menu bar.
  window.setAlwaysOnTop(true, 'floating')

  if (info.isMac) {
    // Present on every Space, including over full-screen apps.
    // skipTransformProcessType avoids the dock flicker this otherwise causes.
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    })
  }

  // Closing to the tray is the main window's behaviour; the palette just hides.
  window.on('close', (event) => {
    event.preventDefault()
    window.hide()
  })

  // Dismiss on blur, which is what makes it feel ephemeral rather than modal.
  window.on('blur', () => {
    if (!window.webContents.isDevToolsOpened()) window.hide()
  })

  if (deps.devServerUrl) {
    void window.loadURL(`${deps.devServerUrl}/overlay.html`)
  } else {
    void window.loadFile(path.join(deps.rendererDist, 'overlay.html'))
  }

  window.webContents.on('did-finish-load', () => deps.onCreated(window))

  return window
}

/** Centres the palette horizontally on the display the pointer is on. */
export function positionOverlay(window: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { x, y, width, height } = display.workArea

  // Keep whatever height the content asked for; only x/y move.
  const current = window.getBounds().height || HEIGHT
  window.setBounds({
    x: Math.round(x + (width - WIDTH) / 2),
    y: Math.round(y + height * VERTICAL_ANCHOR),
    width: WIDTH,
    height: current,
  })
}

export function showOverlay(window: BrowserWindow): void {
  positionOverlay(window)
  window.show()
  window.focus()
  // Tells the renderer to clear the previous query and focus the field.
  window.webContents.send(IpcEvent.OverlayShown)
}

/**
 * Sizes the palette to its content.
 *
 * A fixed height leaves a dead gap under a short result list, which makes the
 * window read as a dialog rather than a palette. The renderer measures its own
 * card and reports the height here.
 */
export function resizeOverlay(window: BrowserWindow, contentHeight: number): void {
  if (window.isDestroyed()) return
  const height = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, contentHeight)))
  const bounds = window.getBounds()
  if (bounds.height === height) return
  window.setBounds({ ...bounds, height }, false)
}

export function toggleOverlay(window: BrowserWindow): void {
  if (window.isVisible()) window.hide()
  else showOverlay(window)
}
