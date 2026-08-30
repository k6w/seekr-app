#!/usr/bin/env electron
/**
 * Generates the README screenshots.
 *
 *   pnpm screenshots
 *
 * Runs headlessly in the sense that matters: it captures through
 * `webContents.capturePage()` rather than the screen, so it never steals focus,
 * never sends keystrokes to whatever you are actually doing, and needs no
 * screen-recording permission. Windows are positioned offscreen and shown only
 * because a hidden window does not paint.
 *
 * Everything is seeded into a temporary userData directory, so your real index
 * and settings are untouched.
 */
const { app, BrowserWindow, MessageChannelMain, ipcMain, utilityProcess, nativeTheme } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'docs', 'screenshots')
const SCALE = 2 // Retina, so the images stay crisp when scaled down in the README.

/**
 * Short and neutral, because the path column is on screen in every shot.
 * The OS temp directory renders as /var/folders/h4/m721dpqn0.../T/... which
 * tells the reader nothing and carries a username.
 */
const DEMO_HOME = '/Users/Shared/Seekr Demo'

/** A plausible home directory, so the screenshots show something recognisable. */
const FIXTURE = [
  'Documents/Quarterly Report 2026.pdf',
  'Documents/Quarterly Report 2025.pdf',
  'Documents/Reports/Annual Report.docx',
  'Documents/Reports/Sales Report Q1.xlsx',
  'Documents/Reports/Sales Report Q2.xlsx',
  'Documents/Invoices/invoice-2026-04.pdf',
  'Documents/Invoices/invoice-2026-03.pdf',
  'Documents/Contracts/Lease Agreement.pdf',
  'Documents/Notes/reading list.md',
  'Documents/Notes/meeting notes.md',
  'Downloads/report-template.docx',
  'Downloads/keynote-2026.pdf',
  'Downloads/Screenshot 2026-04-12.png',
  'Projects/seekr/src/index-store.ts',
  'Projects/seekr/src/reporter.ts',
  'Projects/seekr/README.md',
  'Projects/atlas/src/report-builder.ts',
  'Projects/atlas/src/main.ts',
  'Projects/atlas/node_modules/left-pad/index.js',
  'Pictures/Iceland 2026/DSC_0182.jpg',
  'Pictures/Iceland 2026/DSC_0183.jpg',
  'Pictures/Screenshots/report-mockup.png',
  'Music/Playlists/focus.m3u',
  'Movies/timelapse-report.mp4',
]

function buildFixture(root) {
  for (const relative of FIXTURE) {
    const full = path.join(root, relative)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    // Vary the size a little so the size column is not a wall of one number.
    fs.writeFileSync(full, 'x'.repeat(1024 + relative.length * 813))
  }
  return root
}

/** Drives the engine directly, the way main does, so the real pipeline is used. */
function startEngine(databasePath) {
  const child = utilityProcess.fork(path.join(ROOT, 'dist-electron', 'engine.js'), [], {
    serviceName: 'seekr-engine-screenshots',
    stdio: 'ignore',
  })

  return new Promise((resolve) => {
    child.on('message', (message) => {
      if (message?.type === 'ready') resolve(child)
    })
    child.postMessage({ type: 'init', databasePath })
  })
}

function indexFixture(child, fixtureRoot) {
  const { port1, port2 } = new MessageChannelMain()
  child.postMessage({ type: 'attach-port' }, [port1])

  return new Promise((resolve) => {
    port2.on('message', (event) => {
      if (event.data?.event === 'index:complete') {
        port2.close()
        resolve()
      }
    })
    port2.start()
    port2.postMessage({ kind: 'index:start', id: 1, paths: [fixtureRoot], excludePaths: [] })
  })
}

function attachRenderer(child, webContents) {
  const { port1, port2 } = new MessageChannelMain()
  child.postMessage({ type: 'attach-port' }, [port1])
  webContents.postMessage('seekr:engine-port', null, [port2])
}

let overlayWindow = null

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** The subset of main's handlers the renderer touches on mount. */
function registerStubHandlers() {
  ipcMain.handle('seekr:system:info', () => ({
    ok: true,
    data: {
      platform: process.platform,
      isMac: process.platform === 'darwin',
      isWindows: process.platform === 'win32',
      isLinux: process.platform === 'linux',
      supportsMica: false,
      appVersion: app.getVersion(),
    },
  }))
  ipcMain.handle('seekr:window:is-maximized', () => false)
  ipcMain.handle('seekr:overlay:resize', (_event, height) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return
    if (typeof height !== 'number' || !Number.isFinite(height)) return
    const bounds = overlayWindow.getBounds()
    overlayWindow.setBounds({ ...bounds, height: Math.round(height) }, false)
  })
  ipcMain.handle('seekr:system:roots', () => ({ ok: true, data: [DEMO_HOME] }))
}

/**
 * Types into the search field the way React expects.
 *
 * Setting `.value` directly does not notify React; going through the prototype
 * setter and dispatching an input event does.
 */
async function typeQuery(webContents, query) {
  await webContents.executeJavaScript(`
    (() => {
      const input = document.querySelector('input[type="text"]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      ).set;
      setter.call(input, ${JSON.stringify(query)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()
  `)
  // Debounce plus one engine round trip.
  await wait(700)
}

async function capture(window, name) {
  const image = await window.webContents.capturePage()
  const file = path.join(OUT_DIR, `${name}.png`)
  fs.writeFileSync(file, image.toPNG())
  const { width, height } = image.getSize()
  console.log(`  ${name}.png  ${width}x${height}`)
}

async function makeWindow({ width, height, page, theme, overlay = false }) {
  nativeTheme.themeSource = theme

  const window = new BrowserWindow({
    width,
    height,
    // Offscreen: shown so it paints, but never in front of anything.
    x: -width - 200,
    y: 0,
    show: true,
    ...(overlay
      ? { frame: false }
      : process.platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 14 } }
        : { frame: false }),
    transparent: overlay,
    backgroundColor: overlay ? '#00000000' : undefined,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(ROOT, 'dist-electron', 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      zoomFactor: SCALE / 2,
    },
  })

  await window.loadFile(path.join(ROOT, 'dist', page))
  return window
}

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'seekr-shots-'))
  app.setPath('userData', userData)

  fs.rmSync(DEMO_HOME, { recursive: true, force: true })
  const fixtureRoot = buildFixture(DEMO_HOME)
  fs.mkdirSync(OUT_DIR, { recursive: true })

  // The path guard reads this; without it the action buttons would refuse.
  fs.writeFileSync(
    path.join(userData, 'settings.json'),
    JSON.stringify({ indexedPaths: [fixtureRoot], excludedPaths: [], theme: 'dark' }, null, 2),
  )

  registerStubHandlers()

  console.log('Indexing the fixture tree…')
  const engine = await startEngine(path.join(userData, 'seekr-index.db'))
  await indexFixture(engine, fixtureRoot)

  console.log('Capturing:')

  for (const theme of ['dark', 'light']) {
    const window = await makeWindow({ width: 1180, height: 720, page: 'index.html', theme })
    attachRenderer(engine, window.webContents)
    await wait(900)
    await typeQuery(window.webContents, 'report')
    await capture(window, `main-${theme}`)
    window.destroy()
    await wait(400)
  }

  // The palette, on its own, sized the way the app sizes it.
  const overlay = await makeWindow({
    width: 680,
    height: 120,
    page: 'overlay.html',
    theme: 'dark',
    overlay: true,
  })
  overlayWindow = overlay
  attachRenderer(engine, overlay.webContents)
  await wait(900)
  await typeQuery(overlay.webContents, 'invoice')
  // Let the ResizeObserver report and the window settle before capturing.
  await wait(500)
  await capture(overlay, 'overlay')
  overlayWindow = null
  overlay.destroy()
  await wait(400)

  // Settings, opened through the app's own event.
  const settings = await makeWindow({ width: 1180, height: 720, page: 'index.html', theme: 'dark' })
  attachRenderer(engine, settings.webContents)
  await wait(900)
  settings.webContents.send('seekr:evt:open-settings')
  await wait(500)
  await capture(settings, 'settings')
  settings.destroy()

  engine.postMessage({ type: 'shutdown' })
  await wait(400)
  fs.rmSync(userData, { recursive: true, force: true })
  fs.rmSync(DEMO_HOME, { recursive: true, force: true })

  console.log(`\nWritten to ${path.relative(ROOT, OUT_DIR)}/`)
  app.exit(0)
}

// Destroying a window between captures leaves none open, and Electron quits
// on window-all-closed by default -- which ended the run after the first shot.
app.on("window-all-closed", () => {})

app.whenReady().then(() =>
  main().catch((error) => {
    console.error('Screenshot run failed:', error)
    app.exit(1)
  }),
)
