/**
 * The typed contract between the renderer and the main process.
 *
 * `SeekrApi` is the exact shape exposed on `window.seekr` by the preload.
 * Both sides import it, so a handler and its caller cannot drift.
 */
import type {
  FileItem,
  IndexingProgress,
  IpcIndexRequest,
  IpcSearchRequest,
  SearchResult,
} from '../../src/types'

/**
 * Discriminated result. Replaces the old `IpcResponse<T = any>`, where every
 * call site had to cast and `success` told you nothing about `data`.
 */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

export interface SystemInfo {
  platform: NodeJS.Platform
  isMac: boolean
  isWindows: boolean
  isLinux: boolean
  /** Windows 11 build 22000+, where mica and rounded corners are available. */
  supportsMica: boolean
  appVersion: string
}

/** Unsubscribe handle returned by every event subscription. */
export type Unsubscribe = () => void

export interface SeekrApi {
  search(request: IpcSearchRequest): Promise<IpcResult<SearchResult>>

  index: {
    start(request: IpcIndexRequest): Promise<IpcResult<void>>
    stop(): Promise<IpcResult<void>>
    progress(): Promise<IpcResult<IndexingProgress>>
    count(): Promise<IpcResult<number>>
  }

  file: {
    /** Opens with the OS default handler. Rejects paths not present in the index. */
    open(path: string): Promise<IpcResult<void>>
    /** Reveals in Finder/Explorer. Rejects paths not present in the index. */
    reveal(path: string): Promise<IpcResult<void>>

    /**
     * Real filesystem path for a dropped File.
     *
     * Must be resolved in the preload via `webUtils.getPathForFile`: the
     * renderer only sees a virtual DataTransfer path (`/FolderName`), which
     * is what the drop handler used to pass to the indexer -- so dropping a
     * folder always tried to index a path that does not exist.
     */
    pathForDropped(file: File): string | null
  }

  system: {
    drives(): Promise<IpcResult<string[]>>
    info(): Promise<IpcResult<SystemInfo>>
  }

  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    hide(): Promise<void>
    isMaximized(): Promise<boolean>
    quit(): Promise<void>
    /** Event-driven; replaces the old 1s `isMaximized` IPC poll. */
    onMaximizedChanged(cb: (isMaximized: boolean) => void): Unsubscribe
  }

  events: {
    onIndexProgress(cb: (progress: IndexingProgress) => void): Unsubscribe
    onIndexComplete(cb: () => void): Unsubscribe
    onIndexError(cb: (error: string) => void): Unsubscribe

    onFileAdded(cb: (file: FileItem) => void): Unsubscribe
    onFileChanged(cb: (file: FileItem) => void): Unsubscribe
    onFileRemoved(cb: (path: string) => void): Unsubscribe
    onWatcherReady(cb: () => void): Unsubscribe
    onWatcherStopped(cb: () => void): Unsubscribe

    onFocusSearch(cb: () => void): Unsubscribe
    onOpenSettings(cb: () => void): Unsubscribe
    onStartIndexingFromTray(cb: () => void): Unsubscribe
  }
}
