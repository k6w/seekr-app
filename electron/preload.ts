import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { EVENT_CHANNELS, INVOKE_CHANNELS, IpcChannel, IpcEvent } from './ipc/channels'
import type { SeekrApi, Unsubscribe } from './ipc/api'

/**
 * The renderer's ONLY bridge to the main process.
 *
 * The previous preload exposed a raw, unfiltered `ipcRenderer` with `invoke`,
 * `send`, `on` and `off` taking arbitrary channel names. Any script running in
 * the renderer -- an XSS in a rendered filename, a compromised dependency, a
 * devtools snippet -- could call any `ipcMain.handle` channel with any
 * arguments, which combined with the unvalidated `shell.openPath` handler meant
 * renderer compromise implied arbitrary program execution.
 *
 * Everything below is allowlisted: `invoke` and `subscribe` reject any channel
 * that is not declared in ./ipc/channels.
 */

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!INVOKE_CHANNELS.has(channel)) {
    // A programming error, not user input -- fail loudly rather than forwarding.
    return Promise.reject(new Error(`Blocked IPC invoke on unlisted channel: ${channel}`))
  }
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

/**
 * Subscribes to a main->renderer event and returns an unsubscribe function.
 *
 * Deliberately no `removeAllListeners`: the old API let the renderer pass any
 * channel name and strip the app's own listeners. Callers now own exactly the
 * handler they registered, which is also what React effect cleanups need.
 */
function subscribe<A extends unknown[]>(
  channel: string,
  cb: (...args: A) => void,
): Unsubscribe {
  if (!EVENT_CHANNELS.has(channel)) {
    throw new Error(`Blocked IPC subscription on unlisted channel: ${channel}`)
  }
  const listener = (_event: IpcRendererEvent, ...args: unknown[]) => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: SeekrApi = {
  search: (request) => invoke(IpcChannel.Search, request),

  index: {
    start: (request) => invoke(IpcChannel.IndexStart, request),
    stop: () => invoke(IpcChannel.IndexStop),
    progress: () => invoke(IpcChannel.IndexProgress),
    count: () => invoke(IpcChannel.IndexCount),
  },

  file: {
    open: (path) => invoke(IpcChannel.FileOpen, path),
    reveal: (path) => invoke(IpcChannel.FileReveal, path),
    pathForDropped: (file) => {
      try {
        return webUtils.getPathForFile(file) || null
      } catch {
        return null
      }
    },
  },

  system: {
    drives: () => invoke(IpcChannel.SystemDrives),
    info: () => invoke(IpcChannel.SystemInfo),
  },

  window: {
    minimize: () => invoke(IpcChannel.WindowMinimize),
    toggleMaximize: () => invoke(IpcChannel.WindowMaximizeToggle),
    hide: () => invoke(IpcChannel.WindowHide),
    isMaximized: () => invoke(IpcChannel.WindowIsMaximized),
    quit: () => invoke(IpcChannel.AppQuit),
    onMaximizedChanged: (cb) => subscribe(IpcEvent.WindowMaximizedChanged, cb),
  },

  events: {
    onIndexProgress: (cb) => subscribe(IpcEvent.IndexProgress, cb),
    onIndexComplete: (cb) => subscribe(IpcEvent.IndexComplete, cb),
    onIndexError: (cb) => subscribe(IpcEvent.IndexError, cb),

    onFileAdded: (cb) => subscribe(IpcEvent.FileAdded, cb),
    onFileChanged: (cb) => subscribe(IpcEvent.FileChanged, cb),
    onFileRemoved: (cb) => subscribe(IpcEvent.FileRemoved, cb),
    onWatcherReady: (cb) => subscribe(IpcEvent.WatcherReady, cb),
    onWatcherStopped: (cb) => subscribe(IpcEvent.WatcherStopped, cb),

    onFocusSearch: (cb) => subscribe(IpcEvent.FocusSearch, cb),
    onOpenSettings: (cb) => subscribe(IpcEvent.OpenSettings, cb),
    onStartIndexingFromTray: (cb) => subscribe(IpcEvent.StartIndexingFromTray, cb),
  },
}

contextBridge.exposeInMainWorld('seekr', api)
