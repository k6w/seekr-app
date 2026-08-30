/**
 * The typed contract between the renderer and the rest of the app.
 *
 * Two transports sit behind this one object:
 *
 *   - **Search and indexing** go over a MessagePort straight to the engine
 *     `utilityProcess`. They never touch the main process, so a crawl or a
 *     large result batch cannot stall the window.
 *   - **Shell verbs, windows and permissions** go to main over IPC, because
 *     those are the things main legitimately owns -- and because every path
 *     must pass the guard before it reaches the OS.
 */
import type { SearchRow } from '../engine/protocol'
import type { IndexProgressPayload, SearchResultPage } from '../engine/client'

export type { SearchRow, SearchResultPage, IndexProgressPayload }

/** Discriminated result. Replaces `IpcResponse<T = any>`, which told callers nothing. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

export interface SystemInfo {
  platform: NodeJS.Platform
  isMac: boolean
  isWindows: boolean
  isLinux: boolean
  /** Windows 11 build 22000+, where mica and rounded corners exist. */
  supportsMica: boolean
  appVersion: string
}

export interface EngineStats {
  fileCount: number
  databaseBytes: number
  indexedRoots: string[]
}

export type Unsubscribe = () => void

export interface SearchOptions {
  limit?: number
  /** Opaque keyset token from the previous page. Never an offset. */
  cursor?: string
  /** Also compute the true total. One extra pass, so opt in. */
  wantTotal?: boolean
}

export interface SeekrApi {
  /** True once the engine port has arrived. */
  isEngineReady(): boolean

  search(query: string, options?: SearchOptions): Promise<SearchResultPage>

  index: {
    start(paths?: string[], excludePaths?: string[]): Promise<void>
    stop(): Promise<void>
    count(): Promise<number>
    stats(): Promise<EngineStats>
  }

  file: {
    /** Opens with the OS default handler. Rejects paths absent from the index. */
    open(path: string): Promise<IpcResult<void>>
    /** Reveals in Finder/Explorer. Rejects paths absent from the index. */
    reveal(path: string): Promise<IpcResult<void>>
    /** Copies the path as text. */
    copyPath(path: string): Promise<IpcResult<void>>
    /** Moves to the OS trash. Rejects paths absent from the index. */
    trash(path: string): Promise<IpcResult<void>>
    /**
     * Real filesystem path for a dropped File. Must be resolved in the preload
     * via webUtils: the renderer only sees a virtual DataTransfer path.
     */
    pathForDropped(file: File): string | null
    /** Starts a native drag so the file can be dropped into another app. */
    startDrag(path: string): void
  }

  system: {
    /** Roots the user can choose to index, platform-correct. */
    roots(): Promise<IpcResult<string[]>>
    info(): Promise<IpcResult<SystemInfo>>
    /** Opens the macOS Full Disk Access settings pane. */
    openFullDiskAccessSettings(): Promise<IpcResult<void>>
  }

  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    hide(): Promise<void>
    isMaximized(): Promise<boolean>
    quit(): Promise<void>
    onMaximizedChanged(cb: (isMaximized: boolean) => void): Unsubscribe
  }

  events: {
    onIndexProgress(cb: (status: IndexProgressPayload) => void): Unsubscribe
    onIndexComplete(cb: (payload: { count: number; deniedPaths: string[] }) => void): Unsubscribe
    onIndexError(cb: (message: string) => void): Unsubscribe
    /** Linux inotify watch limit reached; the watcher is degraded. */
    onWatcherLimit(cb: (root: string) => void): Unsubscribe

    onFocusSearch(cb: () => void): Unsubscribe
    onOpenSettings(cb: () => void): Unsubscribe
    onStartIndexingFromTray(cb: () => void): Unsubscribe
  }
}
