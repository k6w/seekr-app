/**
 * The search engine. Runs in a `utilityProcess`, never on the main thread.
 *
 * Everything that touches the filesystem or the database lives here: crawling,
 * watching, indexing and querying. Previously all of it ran on the main
 * process, so a full-disk crawl froze the window, the tray and the global
 * hotkey for its entire duration.
 *
 * Renderers get a direct `MessagePortMain` to this process, so search traffic never
 * hops through main at all.
 */
import path from 'node:path'
import type { MessagePortMain } from 'electron'
import * as chokidar from 'chokidar'
import { IndexStore, type StoredFile } from './index-store'
import { crawl, toStored } from './crawler'
import {
  type EngineRequest,
  type EngineResponse,
  type SearchRequest,
} from './protocol'
import { shouldSkipDirectory, shouldSkipFile } from '../services/path-policy'

const INSERT_BATCH = 2_000
const WATCH_FLUSH_MS = 250

interface IndexingState {
  isIndexing: boolean
  filesProcessed: number
  currentPath?: string
  progress: number
  deniedPaths: string[]
}

class Engine {
  private store: IndexStore
  private ports: Set<MessagePortMain> = new Set()

  private abortSignal = { aborted: false }
  private state: IndexingState = {
    isIndexing: false,
    filesProcessed: 0,
    progress: 0,
    deniedPaths: [],
  }

  /** Newest request id per port; anything older is abandoned mid-flight. */
  private newestRequest = new WeakMap<MessagePortMain, number>()

  private watchers = new Map<string, chokidar.FSWatcher>()
  private pendingChanges = new Map<string, { type: 'upsert' | 'remove'; root: string }>()
  private flushTimer: NodeJS.Timeout | null = null

  constructor(databasePath: string) {
    this.store = new IndexStore(databasePath)
  }

  addPort(port: MessagePortMain): void {
    this.ports.add(port)
    port.on('message', (event: { data: EngineRequest }) => {
      void this.handle(port, event.data)
    })
    port.start()
  }

  private send(port: MessagePortMain, message: EngineResponse): void {
    try {
      port.postMessage(message)
    } catch {
      // Port closed while we were replying; drop it.
      this.ports.delete(port)
    }
  }

  private broadcast(message: EngineResponse): void {
    for (const port of this.ports) this.send(port, message)
  }

  private async handle(port: MessagePortMain, request: EngineRequest): Promise<void> {
    try {
      switch (request.kind) {
        case 'search':
          this.newestRequest.set(port, request.id)
          return this.search(port, request)

        case 'cancel':
          // Bumping the newest id is enough: the search loop checks it between
          // pages and abandons anything that is no longer current.
          this.newestRequest.set(port, request.target + 1)
          return this.send(port, { kind: 'ok', id: request.id })

        case 'index:start':
          void this.startIndexing(request.paths, request.excludePaths ?? [])
          return this.send(port, { kind: 'ok', id: request.id })

        case 'index:stop':
          this.abortSignal.aborted = true
          await this.stopWatching()
          this.state.isIndexing = false
          return this.send(port, { kind: 'ok', id: request.id })

        case 'index:status':
          return this.send(port, { kind: 'index:status', id: request.id, ...this.state })

        case 'index:count':
          return this.send(port, { kind: 'index:count', id: request.id, count: this.store.count() })

        case 'engine:stats':
          return this.send(port, {
            kind: 'engine:stats',
            id: request.id,
            fileCount: this.store.count(),
            databaseBytes: this.store.databaseBytes(),
            indexedRoots: [...this.watchers.keys()],
          })
      }
    } catch (error) {
      this.send(port, {
        kind: 'error',
        id: request.id,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Rows are sent as soon as they are ready; the true total follows on the
   * final message. That is what lets the list paint in a few milliseconds
   * while the count arrives slightly later, instead of waiting for both.
   */
  private search(port: MessagePortMain, request: SearchRequest): void {
    const started = performance.now()
    const outcome = this.store.search(request.query, {
      limit: request.limit,
      cursor: request.cursor,
    })

    // A newer keystroke landed while this query ran.
    if (this.newestRequest.get(port) !== request.id) return

    this.send(port, {
      kind: 'search:page',
      id: request.id,
      rows: outcome.rows,
      cursor: outcome.cursor,
      total: request.wantTotal ? this.store.total(request.query) : undefined,
      elapsedMs: Math.round(performance.now() - started),
      done: true,
    })
  }

  private async startIndexing(paths: string[], excludePaths: string[]): Promise<void> {
    if (this.state.isIndexing) return

    this.abortSignal = { aborted: false }
    this.state = { isIndexing: true, filesProcessed: 0, progress: 0, deniedPaths: [] }
    this.emitProgress()

    try {
      this.store.clear()
      this.store.beginBulkLoad()

      for (const root of paths) {
        if (this.abortSignal.aborted) break
        await this.indexRoot(root, excludePaths)
      }

      this.store.endBulkLoad()
      this.state.isIndexing = false
      this.state.progress = 100
      this.emitProgress()
      this.broadcast({
        kind: 'event',
        id: 0,
        event: 'index:complete',
        payload: { count: this.store.count(), deniedPaths: this.state.deniedPaths },
      })

      await this.startWatching(paths, excludePaths)
    } catch (error) {
      this.state.isIndexing = false
      this.broadcast({
        kind: 'event',
        id: 0,
        event: 'index:error',
        payload: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async indexRoot(root: string, excludePaths: string[]): Promise<void> {
    let batch: StoredFile[] = []

    const flush = () => {
      if (batch.length === 0) return
      this.store.insertMany(batch)
      this.state.filesProcessed += batch.length
      batch = []
      // Total is unknown during a streaming crawl, so approach 95%
      // asymptotically rather than inventing a percentage.
      this.state.progress = Math.min(95, 95 * (1 - Math.exp(-this.state.filesProcessed / 250_000)))
      this.emitProgress()
    }

    for await (const entry of crawl(root, {
      excludePaths,
      signal: this.abortSignal,
      onDenied: (denied) => {
        if (this.state.deniedPaths.length < 50) this.state.deniedPaths.push(denied)
      },
    })) {
      batch.push(entry)
      this.state.currentPath = entry.fullPath
      if (batch.length >= INSERT_BATCH) {
        flush()
        // Yield so incoming search requests are still answered during a crawl.
        await new Promise((resolve) => setImmediate(resolve))
      }
    }

    flush()
  }

  private emitProgress(): void {
    this.broadcast({ kind: 'event', id: 0, event: 'index:progress', payload: { ...this.state } })
  }

  // ------------------------------------------------------------- watching --

  private async startWatching(paths: string[], excludePaths: string[]): Promise<void> {
    await this.stopWatching()

    for (const root of paths) {
      try {
        const watcher = chokidar.watch(root, {
          ignored: (candidate: string) =>
            shouldSkipFile(path.basename(candidate)) ||
            shouldSkipDirectory(path.dirname(candidate), { rootPath: root, excludePaths }),
          ignoreInitial: true,
          followSymlinks: false,
          awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
        })

        const queue = (type: 'upsert' | 'remove') => (candidate: string) => {
          this.pendingChanges.set(candidate, { type, root })
          if (!this.flushTimer) {
            this.flushTimer = setTimeout(() => void this.flushChanges(), WATCH_FLUSH_MS)
          }
        }

        watcher.on('add', queue('upsert'))
        watcher.on('change', queue('upsert'))
        watcher.on('addDir', queue('upsert'))
        watcher.on('unlink', queue('remove'))
        watcher.on('unlinkDir', queue('remove'))

        watcher.on('error', (error: unknown) => {
          const code =
            typeof error === 'object' && error !== null && 'code' in error
              ? String((error as { code: unknown }).code)
              : ''
          // Linux inotify watch exhaustion. Previously logged and swallowed,
          // leaving a silently non-functional watcher.
          if (code === 'ENOSPC') {
            this.broadcast({ kind: 'event', id: 0, event: 'watcher:limit', payload: root })
          }
        })

        watcher.on('ready', () =>
          this.broadcast({ kind: 'event', id: 0, event: 'watcher:ready', payload: root }),
        )

        this.watchers.set(root, watcher)
      } catch {
        // A root that cannot be watched still stays indexed.
      }
    }
  }

  /** Coalesced writes: a `git checkout` fires thousands of events at once. */
  private async flushChanges(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.pendingChanges.size === 0) return

    const changes = [...this.pendingChanges.entries()]
    this.pendingChanges.clear()

    const upserts: StoredFile[] = []
    const { stat } = await import('node:fs/promises')

    for (const [fullPath, change] of changes) {
      if (change.type === 'remove') {
        this.store.deleteByPath(fullPath)
        continue
      }
      try {
        const stats = await stat(fullPath)
        upserts.push(
          toStored(
            fullPath,
            path.basename(fullPath),
            stats.isDirectory(),
            stats.size,
            stats.mtimeMs,
            stats.birthtimeMs || stats.ctimeMs,
          ),
        )
      } catch {
        // Gone between the event and the stat.
        this.store.deleteByPath(fullPath)
      }
    }

    if (upserts.length > 0) this.store.insertMany(upserts)
  }

  private async stopWatching(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.pendingChanges.clear()
    await Promise.all([...this.watchers.values()].map((w) => w.close().catch(() => undefined)))
    this.watchers.clear()
  }

  async shutdown(): Promise<void> {
    this.abortSignal.aborted = true
    await this.stopWatching()
    this.store.close()
  }
}

// ------------------------------------------------------------- bootstrap --

let engine: Engine | null = null

process.parentPort?.on('message', (event) => {
  const [port] = event.ports

  if (event.data?.type === 'init') {
    engine = new Engine(event.data.databasePath)
    // Tell main we are ready before any port is attached, so it can surface a
    // startup failure instead of hanging.
    process.parentPort.postMessage({ type: 'ready' })
    return
  }

  if (event.data?.type === 'attach-port' && port && engine) {
    engine.addPort(port)
    return
  }

  if (event.data?.type === 'shutdown' && engine) {
    void engine.shutdown().finally(() => process.exit(0))
  }
})
