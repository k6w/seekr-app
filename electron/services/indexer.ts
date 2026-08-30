import fs from 'node:fs/promises'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { v4 as uuidv4 } from 'uuid'
import { FileItem, IndexingProgress } from '../../src/types'
import { DatabaseService } from './database'
import { getFileType } from './file-type'
import { isDemotedPath, shouldSkipDirectory, shouldSkipFile } from './path-policy'

const BATCH_SIZE = 1_000

/** Errors that just mean "we may not look here". Not worth logging per entry. */
const QUIET_ERRORS = new Set(['EACCES', 'EPERM', 'EBUSY', 'ENOENT', 'ELOOP', 'ENOTDIR'])

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : 'UNKNOWN'
}

export class FileIndexer extends EventEmitter {
  private isIndexing = false
  private shouldStop = false
  private currentProgress: IndexingProgress = {
    isIndexing: false,
    filesProcessed: 0,
    progress: 0,
  }

  /** Paths that returned EACCES/EPERM, surfaced so macOS TCC denials are visible. */
  private deniedPaths: string[] = []

  constructor(private readonly db: DatabaseService) {
    super()
  }

  async startIndexing(paths: string[], excludePaths: string[] = []): Promise<void> {
    if (this.isIndexing) throw new Error('Indexing already in progress')

    this.isIndexing = true
    this.shouldStop = false
    this.deniedPaths = []
    this.currentProgress = { isIndexing: true, filesProcessed: 0, progress: 0 }
    this.emit('progress', this.currentProgress)

    try {
      await this.db.clearAll()

      for (const rootPath of paths) {
        if (this.shouldStop) break
        try {
          await this.indexPath(rootPath, excludePaths)
        } catch (error) {
          // One unreadable root must not abort the others.
          console.error(`Failed to index ${rootPath}:`, error)
        }
      }

      this.currentProgress.isIndexing = false
      this.currentProgress.progress = 100
      this.emit('progress', this.currentProgress)
      this.emit('complete', { deniedPaths: this.deniedPaths })
    } catch (error) {
      this.currentProgress.isIndexing = false
      this.emit('error', error)
    } finally {
      this.isIndexing = false
    }
  }

  /**
   * Crawls one root, writing to the database as it goes.
   *
   * The previous implementation walked the ENTIRE tree into one in-memory
   * `FileItem[]` and only then began inserting. At ~2M files that array is
   * 1-2 GB of live JS objects held on the main process heap, and a crash or
   * quit mid-crawl persisted exactly nothing. Now rows are flushed every
   * BATCH_SIZE entries, so peak memory is bounded by the batch, not by the
   * size of the disk, and progress survives interruption.
   */
  private async indexPath(rootPath: string, excludePaths: string[]): Promise<void> {
    let batch: FileItem[] = []
    let written = 0

    const flush = async () => {
      if (batch.length === 0) return
      const pending = batch
      batch = []
      try {
        await this.db.insertFiles(pending)
        written += pending.length
        this.currentProgress.filesProcessed = written
        // Total is unknown during a streaming crawl, so report a slow
        // asymptotic approach to 95% rather than a fake percentage.
        this.currentProgress.progress = Math.min(95, 95 * (1 - Math.exp(-written / 250_000)))
        this.emit('progress', this.currentProgress)
      } catch (error) {
        console.error('Batch insert failed:', error)
      }
      // Yield so the main process stays responsive between batches.
      await new Promise((resolve) => setImmediate(resolve))
    }

    for await (const item of this.walk(rootPath, rootPath, excludePaths)) {
      if (this.shouldStop) break
      batch.push(item)
      if (batch.length >= BATCH_SIZE) await flush()
    }

    await flush()
  }

  /**
   * Iterative, breadth-first walk yielding one FileItem per entry.
   *
   * Iterative rather than recursive so a deep tree cannot blow the stack, and
   * a generator so the caller controls backpressure instead of the walker
   * buffering everything.
   */
  private async *walk(
    rootPath: string,
    _originalRoot: string,
    excludePaths: string[],
  ): AsyncGenerator<FileItem> {
    const queue: string[] = [rootPath]
    // Guards against symlink and bind-mount cycles.
    const visited = new Set<string>()

    while (queue.length > 0) {
      if (this.shouldStop) return
      const currentPath = queue.shift() as string

      if (shouldSkipDirectory(currentPath, { rootPath, excludePaths })) continue

      let realPath: string
      try {
        realPath = await fs.realpath(currentPath)
      } catch {
        continue
      }
      if (visited.has(realPath)) continue
      visited.add(realPath)

      let entries
      try {
        entries = await fs.readdir(currentPath, { withFileTypes: true })
      } catch (error) {
        const code = errorCode(error)
        if (code === 'EACCES' || code === 'EPERM') {
          // Surfaced rather than swallowed: on macOS this is exactly what a
          // missing Full Disk Access grant looks like, and the old code hid it.
          this.deniedPaths.push(currentPath)
        } else if (!QUIET_ERRORS.has(code)) {
          console.warn(`Cannot read ${currentPath}: ${code}`)
        }
        continue
      }

      for (const entry of entries) {
        if (this.shouldStop) return
        const fullPath = path.join(currentPath, entry.name)

        if (entry.isSymbolicLink()) continue
        if (!entry.isDirectory() && shouldSkipFile(entry.name)) continue

        if (entry.isDirectory()) {
          queue.push(fullPath)
          // Directories are now indexed too. Previously only files were, so
          // `type:folder` matched nothing and `includeDirectories` was dead --
          // while file-watcher.ts DID insert them, so the two writers
          // disagreed about what the schema meant.
          yield this.toFileItem(fullPath, entry.name, rootPath, true, 0, new Date(), new Date())
          continue
        }

        try {
          const stats = await fs.stat(fullPath)
          yield this.toFileItem(
            fullPath,
            entry.name,
            rootPath,
            false,
            stats.size,
            stats.mtime,
            stats.birthtime ?? stats.ctime,
          )
        } catch (error) {
          const code = errorCode(error)
          if (code === 'EACCES' || code === 'EPERM') this.deniedPaths.push(fullPath)
          else if (!QUIET_ERRORS.has(code)) console.warn(`Skipping ${fullPath}: ${code}`)
        }
      }
    }
  }

  private toFileItem(
    fullPath: string,
    name: string,
    rootPath: string,
    isDirectory: boolean,
    size: number,
    dateModified: Date,
    dateCreated: Date,
  ): FileItem {
    const relative = path.relative(rootPath, path.dirname(fullPath))
    return {
      id: uuidv4(),
      name,
      path: relative || '.',
      fullPath,
      extension: isDirectory ? '' : path.extname(name).toLowerCase(),
      size,
      dateModified,
      dateCreated,
      isDirectory,
      type: getFileType(name, isDirectory),
      // Indexed but rank-penalized (node_modules, .git, build output).
      // See path-policy.ts for why this is a demotion and not an exclusion.
      demoted: isDemotedPath(fullPath),
    }
  }

  stopIndexing(): void {
    this.shouldStop = true
  }

  getProgress(): IndexingProgress {
    return { ...this.currentProgress }
  }

  isCurrentlyIndexing(): boolean {
    return this.isIndexing
  }

  /** Paths that could not be read. On macOS, usually a missing FDA grant. */
  getDeniedPaths(): readonly string[] {
    return this.deniedPaths
  }
}
