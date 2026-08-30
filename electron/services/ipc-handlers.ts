import { BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { DatabaseService } from './database'
import { FileIndexer } from './indexer'
import { FileWatcher } from './file-watcher'
import { SearchService } from './search'
import { SettingsStore } from './settings'
import { getSelectableRoots, getSystemInfo } from './platform'
import { PathGuard } from '../security/path-guard'
import { IpcChannel, IpcEvent } from '../ipc/channels'
import type { IpcResult } from '../ipc/api'
import type { IpcIndexRequest, IpcSearchRequest } from '../../src/types'

const ok = <T>(data: T): IpcResult<T> => ({ ok: true, data })
const fail = (error: unknown): IpcResult<never> => ({
  ok: false,
  error: error instanceof Error ? error.message : 'Unknown error',
})

export class IpcHandlers {
  private readonly searchService: SearchService
  private readonly pathGuard: PathGuard
  private readonly disposers: Array<() => void> = []

  constructor(
    private readonly db: DatabaseService,
    private readonly indexer: FileIndexer,
    private readonly fileWatcher: FileWatcher,
    private readonly settings: SettingsStore,
  ) {
    this.searchService = new SearchService(db)
    this.pathGuard = new PathGuard({
      getIndexedRoots: () => this.settings.get().indexedPaths,
      isIndexed: (p) => this.db.hasPath(p),
    })
    this.registerHandlers()
    this.forwardEvents()
  }

  /**
   * Rejects invokes whose sender is not the main frame of one of our own
   * windows. Without this, any subframe the app ever loads inherits the full
   * API surface just by being in the same renderer.
   */
  private isTrustedSender(event: IpcMainInvokeEvent): boolean {
    if (BrowserWindow.fromWebContents(event.sender) === null) return false
    const frame = event.senderFrame
    // `senderFrame` is null if the frame was destroyed mid-call.
    return frame === null || frame.parent === null
  }

  private handle<T, Args extends unknown[]>(
    channel: string,
    fn: (event: IpcMainInvokeEvent, ...args: Args) => Promise<IpcResult<T>> | IpcResult<T>,
  ): void {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!this.isTrustedSender(event)) {
        return fail(new Error('Rejected IPC from an untrusted frame'))
      }
      try {
        return await fn(event, ...(args as Args))
      } catch (error) {
        console.error(`IPC handler failed on ${channel}:`, error)
        return fail(error)
      }
    })
  }

  private registerHandlers(): void {
    this.handle(IpcChannel.Search, async (_e, request: IpcSearchRequest) => {
      const { query, filters, limit = 100, offset = 0 } = request ?? {}
      return ok(await this.searchService.search(query ?? '', filters ?? {}, limit, offset))
    })

    this.handle(IpcChannel.IndexStart, async (_e, request: IpcIndexRequest) => {
      if (this.indexer.isCurrentlyIndexing()) {
        return fail(new Error('Indexing already in progress'))
      }

      const paths = (request?.paths ?? []).filter(
        (p): p is string => typeof p === 'string' && p.trim().length > 0,
      )
      if (paths.length === 0) return fail(new Error('No valid paths provided for indexing'))

      const excludePaths = Array.isArray(request?.excludePaths) ? request.excludePaths : []

      // Persist BEFORE indexing starts. These roots are the allowlist PathGuard
      // consults, so they must be durable even if indexing is interrupted.
      this.settings.update({ indexedPaths: paths, excludedPaths: excludePaths })

      this.indexer.startIndexing(paths, excludePaths).catch((error) => {
        console.error('Indexing error:', error)
        this.broadcast(IpcEvent.IndexError, error instanceof Error ? error.message : String(error))
      })

      try {
        await this.fileWatcher.startWatching(paths, excludePaths)
      } catch (watchError) {
        // A failed watcher degrades freshness but must not fail the index run.
        console.warn('File watching failed to start:', watchError)
      }

      return ok(undefined)
    })

    this.handle(IpcChannel.IndexStop, async () => {
      this.indexer.stopIndexing()
      await this.fileWatcher.stopWatching()
      return ok(undefined)
    })

    this.handle(IpcChannel.IndexProgress, () => ok(this.indexer.getProgress()))

    this.handle(IpcChannel.IndexCount, async () => ok(await this.db.getFileCount()))

    // Both file actions hand a path to the OS shell, so both go through the
    // guard. See electron/security/path-guard.ts for why.
    this.handle(IpcChannel.FileOpen, async (_e, filePath: unknown) => {
      const verdict = await this.pathGuard.validate(filePath)
      if (!verdict.ok) return fail(new Error(verdict.reason))

      const message = await shell.openPath(verdict.path)
      // openPath resolves with a non-empty string on failure rather than rejecting.
      return message ? fail(new Error(message)) : ok(undefined)
    })

    this.handle(IpcChannel.FileReveal, async (_e, filePath: unknown) => {
      const verdict = await this.pathGuard.validate(filePath)
      if (!verdict.ok) return fail(new Error(verdict.reason))

      shell.showItemInFolder(verdict.path)
      return ok(undefined)
    })

    this.handle(IpcChannel.SystemDrives, async () => ok(await getSelectableRoots()))

    this.handle(IpcChannel.SystemInfo, () => ok(getSystemInfo()))
  }

  private broadcast(channel: string, ...args: unknown[]): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue
      window.webContents.send(channel, ...args)
    }
  }

  /** Bridges indexer/watcher EventEmitter output onto renderer channels. */
  private forwardEvents(): void {
    const relay = (
      source: FileIndexer | FileWatcher,
      sourceEvent: string,
      channel: string,
      map: (...args: never[]) => unknown[] = (...args: unknown[]) => args,
    ) => {
      const listener = (...args: unknown[]) => this.broadcast(channel, ...map(...(args as never[])))
      source.on(sourceEvent, listener)
      this.disposers.push(() => source.off(sourceEvent, listener))
    }

    relay(this.indexer, 'progress', IpcEvent.IndexProgress)
    relay(this.indexer, 'complete', IpcEvent.IndexComplete)
    relay(this.indexer, 'error', IpcEvent.IndexError, (error: Error) => [error?.message ?? String(error)])

    relay(this.fileWatcher, 'fileAdded', IpcEvent.FileAdded)
    relay(this.fileWatcher, 'fileChanged', IpcEvent.FileChanged)
    relay(this.fileWatcher, 'fileRemoved', IpcEvent.FileRemoved)
    // Directories are files with isDirectory set; the renderer does not need
    // separate channels for them.
    relay(this.fileWatcher, 'directoryAdded', IpcEvent.FileAdded)
    relay(this.fileWatcher, 'directoryRemoved', IpcEvent.FileRemoved)
    relay(this.fileWatcher, 'watcherReady', IpcEvent.WatcherReady)
    relay(this.fileWatcher, 'watchingStopped', IpcEvent.WatcherStopped)
  }

  /** Removes every handler and listener. Called on app shutdown. */
  dispose(): void {
    for (const channel of Object.values(IpcChannel)) {
      ipcMain.removeHandler(channel)
    }
    for (const off of this.disposers.splice(0)) off()
  }
}
