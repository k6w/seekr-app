import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { EVENT_CHANNELS, INVOKE_CHANNELS, IpcChannel, IpcEvent } from './ipc/channels'
import { EngineClient } from './engine/client'
import { ENGINE_PORT_CHANNEL } from './engine/protocol'
import type { SeekrApi, Unsubscribe } from './ipc/api'

/**
 * The renderer's ONLY bridge to the rest of the app.
 *
 * The previous preload exposed a raw, unfiltered `ipcRenderer` with `invoke`,
 * `send`, `on` and `off` taking arbitrary channel names. Any script running in
 * the renderer -- an XSS in a rendered filename, a compromised dependency, a
 * devtools snippet -- could call any `ipcMain.handle` channel with any
 * arguments, which combined with the unvalidated `shell.openPath` handler
 * meant renderer compromise implied arbitrary program execution.
 *
 * Everything below is allowlisted. The engine MessagePort is held here and
 * never handed to the renderer: a port cannot cross contextBridge, and keeping
 * it on this side means the renderer can only make the calls defined below.
 */

const engine = new EngineClient()

ipcRenderer.on(ENGINE_PORT_CHANNEL, (event) => {
  const [port] = event.ports
  if (port) engine.attach(port)
})

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!INVOKE_CHANNELS.has(channel)) {
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
function subscribe<A extends unknown[]>(channel: string, cb: (...args: A) => void): Unsubscribe {
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
  isEngineReady: () => engine.connected,

  search: (query, options = {}) =>
    engine.search(query, {
      limit: options.limit ?? 50,
      cursor: options.cursor,
      wantTotal: options.wantTotal,
    }),

  index: {
    start: async (paths, excludePaths) => {
      // With no paths, ask main for the platform-correct defaults rather than
      // guessing in the renderer, which has no `process` to branch on.
      let roots = paths
      if (!roots || roots.length === 0) {
        const result = await invoke<{ ok: boolean; data?: string[] }>(IpcChannel.SystemRoots)
        roots = result.ok && result.data ? result.data.slice(0, 1) : []
      }
      if (roots.length === 0) throw new Error('No indexable roots available')

      // Main owns the root allowlist the path guard consults, so it has to
      // learn about the roots before the engine starts finding files in them.
      await invoke(IpcChannel.IndexRootsChanged, roots, excludePaths ?? [])
      await engine.startIndexing(roots, excludePaths ?? [])
    },
    stop: () => engine.stopIndexing(),
    count: () => engine.count(),
    stats: () => engine.stats(),
  },

  file: {
    open: (path) => invoke(IpcChannel.FileOpen, path),
    reveal: (path) => invoke(IpcChannel.FileReveal, path),
    copyPath: (path) => invoke(IpcChannel.FileCopyPath, path),
    trash: (path) => invoke(IpcChannel.FileTrash, path),
    pathForDropped: (file) => {
      try {
        return webUtils.getPathForFile(file) || null
      } catch {
        return null
      }
    },
    startDrag: (path) => {
      void invoke(IpcChannel.FileStartDrag, path)
    },
  },

  system: {
    roots: () => invoke(IpcChannel.SystemRoots),
    info: () => invoke(IpcChannel.SystemInfo),
    openFullDiskAccessSettings: () => invoke(IpcChannel.SystemOpenFdaSettings),
  },

  overlay: {
    resize: (height) => {
      void invoke(IpcChannel.OverlayResize, height)
    },
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
    // Indexing events come from the engine over the port, not from main.
    onIndexProgress: (cb) => engine.on('index:progress', cb as (payload: never) => void),
    onIndexComplete: (cb) => engine.on('index:complete', cb as (payload: never) => void),
    onIndexError: (cb) => engine.on('index:error', cb as (payload: never) => void),
    onWatcherLimit: (cb) => engine.on('watcher:limit', cb as (payload: never) => void),

    onFocusSearch: (cb) => subscribe(IpcEvent.FocusSearch, cb),
    onOpenSettings: (cb) => subscribe(IpcEvent.OpenSettings, cb),
    onStartIndexingFromTray: (cb) => subscribe(IpcEvent.StartIndexingFromTray, cb),
    onOverlayShown: (cb) => subscribe(IpcEvent.OverlayShown, cb),
  },
}

contextBridge.exposeInMainWorld('seekr', api)
