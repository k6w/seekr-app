import fs from 'node:fs/promises'
import path from 'node:path'
import { getFileType } from '../services/file-type'
import { isDemotedPath, shouldSkipDirectory, shouldSkipFile } from '../services/path-policy'
import type { StoredFile } from './index-store'

/**
 * Streaming filesystem crawler.
 *
 * Yields entries as it finds them so the caller controls backpressure. The
 * implementation this replaces walked the entire tree into a single in-memory
 * array and only then began inserting: at ~2M files that is 1-2 GB of live JS
 * objects, and a quit mid-crawl persisted nothing at all.
 *
 * Directories are read concurrently. The old crawler awaited one `readdir` and
 * then one `fs.stat` per file, strictly serially, which on any real tree means
 * the process spends nearly all its time waiting on individual syscalls.
 */

const DIRECTORY_CONCURRENCY = 8

export interface CrawlOptions {
  excludePaths?: string[]
  signal?: { aborted: boolean }
  /** Called for directories that could not be read (EACCES/EPERM). */
  onDenied?: (dirPath: string) => void
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : 'UNKNOWN'
}

export async function* crawl(rootPath: string, options: CrawlOptions = {}): AsyncGenerator<StoredFile> {
  const queue: string[] = [rootPath]
  // Guards against symlink loops and bind mounts.
  const visited = new Set<string>()

  while (queue.length > 0) {
    if (options.signal?.aborted) return

    const batch = queue.splice(0, DIRECTORY_CONCURRENCY)
    const results = await Promise.all(
      batch.map((dir) => readDirectory(dir, rootPath, visited, options)),
    )

    for (const result of results) {
      queue.push(...result.directories)
      for (const entry of result.entries) yield entry
    }
  }
}

interface DirectoryResult {
  entries: StoredFile[]
  directories: string[]
}

async function readDirectory(
  currentPath: string,
  rootPath: string,
  visited: Set<string>,
  options: CrawlOptions,
): Promise<DirectoryResult> {
  const empty: DirectoryResult = { entries: [], directories: [] }

  if (shouldSkipDirectory(currentPath, { rootPath, excludePaths: options.excludePaths })) {
    return empty
  }

  let realPath: string
  try {
    realPath = await fs.realpath(currentPath)
  } catch {
    return empty
  }
  if (visited.has(realPath)) return empty
  visited.add(realPath)

  let dirents
  try {
    dirents = await fs.readdir(currentPath, { withFileTypes: true })
  } catch (error) {
    const code = errorCode(error)
    // Surfaced rather than swallowed: on macOS this is what a missing Full
    // Disk Access grant looks like, and hiding it produced a silently partial
    // index with no way for the user to find out.
    if (code === 'EACCES' || code === 'EPERM') options.onDenied?.(currentPath)
    return empty
  }

  const entries: StoredFile[] = []
  const directories: string[] = []

  await Promise.all(
    dirents.map(async (dirent) => {
      if (options.signal?.aborted) return
      const fullPath = path.join(currentPath, dirent.name)

      // Not followed: the target is reached through its own real path anyway,
      // and following them is how a crawler ends up in a cycle.
      if (dirent.isSymbolicLink()) return

      if (dirent.isDirectory()) {
        directories.push(fullPath)
        entries.push(toStored(fullPath, dirent.name, true, 0, 0, 0))
        return
      }

      if (shouldSkipFile(dirent.name)) return

      try {
        const stats = await fs.stat(fullPath)
        entries.push(
          toStored(
            fullPath,
            dirent.name,
            false,
            stats.size,
            stats.mtimeMs,
            stats.birthtimeMs || stats.ctimeMs,
          ),
        )
      } catch (error) {
        const code = errorCode(error)
        if (code === 'EACCES' || code === 'EPERM') options.onDenied?.(fullPath)
      }
    }),
  )

  return { entries, directories }
}

export function toStored(
  fullPath: string,
  name: string,
  isDirectory: boolean,
  size: number,
  mtimeMs: number,
  ctimeMs: number,
): StoredFile {
  return {
    name,
    fullPath,
    dir: path.dirname(fullPath),
    extension: isDirectory ? '' : path.extname(name).toLowerCase(),
    size,
    mtimeMs,
    ctimeMs,
    isDirectory,
    type: getFileType(name, isDirectory),
    // Indexed but rank-penalised. See services/path-policy.ts for why these
    // are demoted rather than excluded.
    demoted: isDemotedPath(fullPath),
  }
}
