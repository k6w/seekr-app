/**
 * Single source of truth for every IPC channel name.
 *
 * Main, preload and the renderer all import from here. Nothing else may invent
 * a channel string: the preload's allowlist is derived from these objects, so
 * a channel not listed here cannot be reached from the renderer at all.
 *
 * Search and indexing are deliberately absent -- they travel over the engine
 * MessagePort, not through main.
 */

/** Request/response channels. Renderer -> main via `ipcRenderer.invoke`. */
export const IpcChannel = {
  FileOpen: 'seekr:file:open',
  FileReveal: 'seekr:file:reveal',
  FileCopyPath: 'seekr:file:copy-path',
  FileTrash: 'seekr:file:trash',
  FileStartDrag: 'seekr:file:start-drag',

  SystemRoots: 'seekr:system:roots',
  SystemInfo: 'seekr:system:info',
  SystemOpenFdaSettings: 'seekr:system:open-fda-settings',

  IndexRootsChanged: 'seekr:index:roots-changed',

  WindowMinimize: 'seekr:window:minimize',
  WindowMaximizeToggle: 'seekr:window:maximize-toggle',
  WindowHide: 'seekr:window:hide',
  WindowIsMaximized: 'seekr:window:is-maximized',
  AppQuit: 'seekr:app:quit',
} as const

/** Push channels. Main -> renderer via `webContents.send`. */
export const IpcEvent = {
  WindowMaximizedChanged: 'seekr:evt:window-maximized-changed',
  FocusSearch: 'seekr:evt:focus-search',
  OpenSettings: 'seekr:evt:open-settings',
  StartIndexingFromTray: 'seekr:evt:start-indexing-from-tray',
} as const

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel]
export type IpcEventName = (typeof IpcEvent)[keyof typeof IpcEvent]

/** Frozen allowlists. The preload checks membership before forwarding. */
export const INVOKE_CHANNELS: ReadonlySet<string> = new Set(Object.values(IpcChannel))
export const EVENT_CHANNELS: ReadonlySet<string> = new Set(Object.values(IpcEvent))
