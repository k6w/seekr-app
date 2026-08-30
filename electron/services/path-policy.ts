import path from 'node:path'

/**
 * Decides which directories are skipped, which are indexed-but-demoted, and
 * how deep a crawl may go.
 *
 * The previous implementation (`indexer.ts` `shouldExcludePath`) matched with
 * `normalizedPath.includes(exclusion)` against a list containing `'out'`,
 * `'temp'`, `'cache'`, `'build'`, `'dist'` and `'target'`. Because that is a
 * substring test over the WHOLE path, it silently deleted from the index every
 * path containing those letters anywhere:
 *
 *   ~/Projects/checkout/     -> contains "out"
 *   ~/Documents/Layouts/     -> contains "out"
 *   ~/src/routes/            -> contains "out"
 *   ~/templates/             -> contains "temp"
 *   ~/attempt-2/             -> contains "temp"
 *   ~/District-plans/        -> contains "dist"
 *
 * Two rules replace it:
 *
 *  1. Match on whole path SEGMENTS, never substrings.
 *  2. Prefer demotion over exclusion. `node_modules` is noise in results but a
 *     user who literally types "node_modules" should still find it. Exclusion
 *     is irreversible from the UI; a rank penalty is not.
 */

/**
 * Never indexed: volatile, cyclic, or OS-internal. Nothing a user searches for
 * lives here, and some of it (/proc, .fseventsd) actively breaks a crawler.
 */
export const HARD_SKIP_SEGMENTS: ReadonlySet<string> = new Set([
  '$recycle.bin',
  'system volume information',
  '.trash',
  '.trashes',
  '.spotlight-v100',
  '.fseventsd',
  '.documentrevisions-v100',
  '.temporaryitems',
  '.mobilebackups',
  'lost+found',
  '/proc',
  '/sys',
  '/dev',
])

/**
 * Indexed, but rank-penalized. These are real files the user may genuinely
 * want; they just should not crowd out everything else.
 */
export const DEMOTED_SEGMENTS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.cache',
  '.npm',
  '.yarn',
  '.pnpm-store',
  '.gradle',
  '.m2',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.tox',
  'target',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.parcel-cache',
  'vendor',
  'caches',
  'derivedddata',
  'deriveddata',
])

/** Absolute path -> lowercased, separator-split segments. */
export function pathSegments(absolutePath: string): string[] {
  return path
    .normalize(absolutePath)
    .toLowerCase()
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0)
}

/** Depth relative to the scan root, not the filesystem root. */
export function depthFromRoot(absolutePath: string, rootPath: string): number {
  const relative = path.relative(rootPath, absolutePath)
  if (relative === '') return 0
  if (relative.startsWith('..')) return Number.POSITIVE_INFINITY
  return relative.split(/[\\/]+/).filter(Boolean).length
}

export interface SkipOptions {
  /** User-configured exclusions. Matched as segments or as a path prefix. */
  excludePaths?: readonly string[]
  /** Scan root, so depth is measured from where the crawl actually started. */
  rootPath: string
  /** Guards against symlink cycles. Counted from the root, default 40. */
  maxDepth?: number
}

export function shouldSkipDirectory(absolutePath: string, options: SkipOptions): boolean {
  const segments = pathSegments(absolutePath)

  for (const segment of segments) {
    if (HARD_SKIP_SEGMENTS.has(segment)) return true
  }

  // Absolute hard-skips like /proc only apply at the filesystem root.
  const normalized = path.normalize(absolutePath).toLowerCase()
  for (const skip of HARD_SKIP_SEGMENTS) {
    if (skip.startsWith('/') && (normalized === skip || normalized.startsWith(`${skip}/`))) {
      return true
    }
  }

  for (const exclusion of options.excludePaths ?? []) {
    const value = exclusion.trim()
    if (value.length === 0) continue

    if (path.isAbsolute(value)) {
      // A full path excludes that subtree, and only that subtree.
      const excluded = path.normalize(value).toLowerCase()
      // Compare against both separators: an exclusion may have been stored on
      // one platform and evaluated on another.
      if (
        normalized === excluded ||
        normalized.startsWith(`${excluded}/`) ||
        normalized.startsWith(`${excluded}\\`)
      ) {
        return true
      }
    } else if (segments.includes(value.toLowerCase())) {
      // A bare name excludes any directory with that exact name.
      return true
    }
  }

  // Counted from the scan root: '/Users/name/...' used to burn 3 of the old
  // budget of 20 before reaching any of the user's own files.
  const maxDepth = options.maxDepth ?? 40
  return depthFromRoot(absolutePath, options.rootPath) > maxDepth
}

/** True when a path sits under a demoted directory. Rank penalty, not a skip. */
export function isDemotedPath(absolutePath: string): boolean {
  return pathSegments(absolutePath).some((segment) => DEMOTED_SEGMENTS.has(segment))
}

/**
 * Files that are genuinely unreadable or meaningless to index.
 * Hidden dotfiles are NOT included: the old crawler skipped every entry
 * starting with '.' or '$', so `.zshrc`, `.env.example` and everything in
 * `~/.config` were unfindable, with no way to turn that off.
 */
export function shouldSkipFile(fileName: string): boolean {
  if (process.platform === 'win32') {
    const volatile = ['pagefile.sys', 'hiberfil.sys', 'swapfile.sys', 'dumpstack.log.tmp']
    if (volatile.includes(fileName.toLowerCase())) return true
  }
  return fileName === '.DS_Store' || fileName === 'Thumbs.db'
}
