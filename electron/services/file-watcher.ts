import * as chokidar from 'chokidar'
import path from 'node:path'
import fs from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { v4 as uuidv4 } from 'uuid'
import { DatabaseService } from './database'
import { FileItem } from '../../src/types'
import { getFileType } from './file-type'
import { isDemotedPath, shouldSkipDirectory, shouldSkipFile } from './path-policy'

/** Coalescing window. A `git checkout` or `npm install` fires thousands of events. */
const FLUSH_INTERVAL_MS = 250
const MAX_PENDING = 500

interface PendingChange {
  type: 'upsert' | 'remove'
  filePath: string
  rootPath: string
}

export class FileWatcher extends EventEmitter {
  private watchers = new Map<string, chokidar.FSWatcher>()
  private pending: PendingChange[] = []
  private flushTimer: NodeJS.Timeout | null = null

  constructor(private readonly db: DatabaseService) {
    super()
  }

  get isWatching(): boolean {
    return this.watchers.size > 0
  }

  /**
   * Starts watching `paths`, replacing any previous watch set.
   *
   * The old implementation returned early whenever an `isWatching` flag was
   * true, and only ever cleared that flag in stopWatching(). So the second call
   * -- for example after the user re-indexed a different folder -- was a
   * permanent no-op: the new paths were never watched and the stale watchers
   * kept running.
   */
  async startWatching(paths: string[], excludePaths: string[] = []): Promise<void> {
    await this.stopWatching()

    for (const watchPath of paths) {
      try {
        const watcher = chokidar.watch(watchPath, {
          ignored: this.createIgnoreFilter(watchPath, excludePaths),
          persistent: true,
          ignoreInitial: true,
          followSymlinks: false,
          awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
          usePolling: false,
          atomic: true,
        })

        watcher.on('add', (filePath) => this.enqueue('upsert', filePath, watchPath))
        watcher.on('change', (filePath) => this.enqueue('upsert', filePath, watchPath))
        watcher.on('addDir', (dirPath) => this.enqueue('upsert', dirPath, watchPath))
        watcher.on('unlink', (filePath) => this.enqueue('remove', filePath, watchPath))
        watcher.on('unlinkDir', (dirPath) => this.enqueue('remove', dirPath, watchPath))

        watcher.on('error', (error: unknown) => {
          const code =
            typeof error === 'object' && error !== null && 'code' in error
              ? String((error as { code: unknown }).code)
              : ''
          if (code === 'ENOSPC') {
            // Linux inotify watch limit. Previously logged and swallowed, so
            // the user got a silently non-functional watcher with no signal.
            this.emit('watcherLimitReached', watchPath)
          }
          console.warn(`Watcher error for ${watchPath}:`, error)
        })

        watcher.on('ready', () => this.emit('watcherReady', watchPath))

        this.watchers.set(watchPath, watcher)
      } catch (error) {
        console.warn(`Failed to watch ${watchPath}:`, error)
      }
    }
  }

  async stopWatching(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.pending = []

    if (this.watchers.size === 0) return

    await Promise.all(
      Array.from(this.watchers.values()).map((watcher) => watcher.close().catch(() => undefined)),
    )
    this.watchers.clear()
    this.emit('watchingStopped')
  }

  /**
   * Queues a change instead of writing immediately.
   *
   * Each event previously triggered an fs.stat, a database write that prepared
   * two fresh SQL statements, and an IPC broadcast -- with no batching at all.
   */
  private enqueue(type: PendingChange['type'], filePath: string, rootPath: string): void {
    this.pending.push({ type, filePath, rootPath })

    if (this.pending.length >= MAX_PENDING) {
      void this.flush()
      return
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => void this.flush(), FLUSH_INTERVAL_MS)
    }
  }

  private async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.pending.length === 0) return

    const batch = this.pending
    this.pending = []

    // Last write wins per path, so a rapid create-modify-delete collapses.
    const collapsed = new Map<string, PendingChange>()
    for (const change of batch) collapsed.set(change.filePath, change)

    const upserts: FileItem[] = []
    const removals: string[] = []

    for (const change of collapsed.values()) {
      if (change.type === 'remove') {
        removals.push(change.filePath)
        continue
      }
      try {
        upserts.push(await this.createFileItem(change.filePath, change.rootPath))
      } catch {
        // Vanished between the event and the stat. Treat it as a removal.
        removals.push(change.filePath)
      }
    }

    try {
      if (upserts.length > 0) {
        await this.db.insertFiles(upserts)
        for (const item of upserts) this.emit('fileChanged', item)
      }
      for (const filePath of removals) {
        await this.db.deleteFile(filePath)
        this.emit('fileRemoved', filePath)
      }
    } catch (error) {
      console.warn('Failed to apply watcher batch:', error)
    }
  }

  /**
   * Uses the same policy module as the indexer.
   *
   * The old filter built glob strings and then hand-converted them to regexes
   * with two chained replaces: the first expanded a double star to a
   * match-anything token, and the second then rewrote the star inside that
   * token, corrupting what the first had just produced. Dots were never
   * escaped, and a fresh RegExp was compiled for all 13 patterns on every
   * single filesystem event.
   */
  private createIgnoreFilter(
    rootPath: string,
    excludePaths: string[],
  ): (filePath: string) => boolean {
    return (filePath: string) => {
      const name = path.basename(filePath)
      if (shouldSkipFile(name)) return true
      return shouldSkipDirectory(path.dirname(filePath), { rootPath, excludePaths })
    }
  }

  private async createFileItem(filePath: string, rootPath: string): Promise<FileItem> {
    const stats = await fs.stat(filePath)
    const fileName = path.basename(filePath)
    const isDirectory = stats.isDirectory()

    return {
      id: uuidv4(),
      name: fileName,
      path: path.relative(rootPath, path.dirname(filePath)) || '.',
      fullPath: filePath,
      extension: isDirectory ? '' : path.extname(fileName).toLowerCase(),
      size: stats.size,
      dateModified: stats.mtime,
      dateCreated: stats.birthtime,
      isDirectory,
      type: getFileType(fileName, isDirectory),
      demoted: isDemotedPath(filePath),
    }
  }
}
