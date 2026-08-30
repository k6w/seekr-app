import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { IpcEvent } from '../ipc/channels'

export interface MenuDeps {
  getMainWindow: () => BrowserWindow | null
  showMainWindow: () => void
  toggleOverlay: () => void
  rebuildIndex: () => void
  openSettings: () => void
  globalHotkey: string
  checkForUpdates: () => void
}

/**
 * The application menu.
 *
 * There was none, so macOS fell back to Electron's default — which names the
 * app "Electron", offers no Seekr-specific commands, and, more importantly,
 * omits a proper Edit menu. Without Edit roles, Cmd+C/V/A do not work in a
 * sandboxed renderer at all, because those shortcuts are delivered by the menu.
 *
 * On Windows and Linux the menu bar is hidden (the window has its own chrome),
 * but it stays registered so the accelerators still fire.
 */
export function buildApplicationMenu(deps: MenuDeps): Menu {
  const isMac = process.platform === 'darwin'

  const appMenu: MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: app.name,
          submenu: [
            { role: 'about' },
            { label: 'Check for Updates…', click: deps.checkForUpdates },
            { type: 'separator' },
            { label: 'Settings…', accelerator: 'Cmd+,', click: deps.openSettings },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
      ]
    : []

  const template: MenuItemConstructorOptions[] = [
    ...appMenu,
    {
      label: 'File',
      submenu: [
        {
          label: 'Quick Search…',
          accelerator: deps.globalHotkey,
          click: deps.toggleOverlay,
        },
        {
          label: 'Focus Search',
          accelerator: 'CmdOrCtrl+K',
          click: () => {
            deps.showMainWindow()
            deps.getMainWindow()?.webContents.send(IpcEvent.FocusSearch)
          },
        },
        { type: 'separator' },
        { label: 'Rebuild Index', accelerator: 'CmdOrCtrl+R', click: deps.rebuildIndex },
        { type: 'separator' },
        ...(isMac
          ? ([{ role: 'close' }] as MenuItemConstructorOptions[])
          : ([
              { label: 'Settings…', accelerator: 'Ctrl+,', click: deps.openSettings },
              { type: 'separator' },
              { role: 'quit' },
            ] as MenuItemConstructorOptions[])),
      ],
    },
    {
      // Roles, not custom handlers: the OS wires these to the focused field,
      // which is the only way clipboard shortcuts work in a sandboxed renderer.
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        // Kept in development only; a production build should not offer
        // devtools from the menu.
        ...(process.env.VITE_DEV_SERVER_URL
          ? ([{ type: 'separator' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[])
          : []),
      ],
    },
    {
      label: 'Window',
      submenu: isMac
        ? [
            { role: 'minimize' },
            { role: 'zoom' },
            { type: 'separator' },
            { role: 'front' },
            { type: 'separator' },
            { label: 'Seekr', click: deps.showMainWindow },
          ]
        : [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'close' }],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Report an Issue',
          click: () => void shell.openExternal('https://github.com/k6w/seekr-app/issues'),
        },
        ...(process.platform === 'darwin'
          ? []
          : ([
              { type: 'separator' },
              { label: 'Check for Updates…', click: deps.checkForUpdates },
            ] as MenuItemConstructorOptions[])),
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)

  return menu
}
