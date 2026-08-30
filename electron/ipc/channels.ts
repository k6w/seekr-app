/**
 * Single source of truth for every IPC channel name.
 *
 * Main, preload, and the renderer all import from here. Nothing else may
 * invent a channel string: the preload allowlist is derived from these
 * objects, so a channel that is not listed here cannot be reached from the
 * renderer at all.
 */

/** Request/response channels. Renderer -> main via `ipcRenderer.invoke`. */
export const IpcChannel = {
  Search: 'seekr:search',
  IndexStart: 'seekr:index:start',
  IndexStop: 'seekr:index:stop',
  IndexProgress: 'seekr:index:progress',
  IndexCount: 'seekr:index:count',

  FileOpen: 'seekr:file:open',
  FileReveal: 'seekr:file:reveal',

  SystemDrives: 'seekr:system:drives',
  SystemInfo: 'seekr:system:info',

  WindowMinimize: 'seekr:window:minimize',
  WindowMaximizeToggle: 'seekr:window:maximize-toggle',
  WindowHide: 'seekr:window:hide',
  WindowIsMaximized: 'seekr:window:is-maximized',
  AppQuit: 'seekr:app:quit',
} as const

/** Push channels. Main -> renderer via `webContents.send`. */
export const IpcEvent = {
  IndexProgress: 'seekr:evt:index-progress',
  IndexComplete: 'seekr:evt:index-complete',
  IndexError: 'seekr:evt:index-error',

  FileAdded: 'seekr:evt:file-added',
  FileChanged: 'seekr:evt:file-changed',
  FileRemoved: 'seekr:evt:file-removed',
  WatcherReady: 'seekr:evt:watcher-ready',
  WatcherStopped: 'seekr:evt:watcher-stopped',

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
