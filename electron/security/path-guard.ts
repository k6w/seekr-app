import path from 'node:path'
import fs from 'node:fs/promises'

/**
 * Validates filesystem paths arriving from the renderer before they are handed
 * to `shell.openPath`, `shell.showItemInFolder`, or `shell.trashItem`.
 *
 * Why this exists: `shell.openPath` asks the OS to launch a path with its
 * default handler. For a `.app`, `.exe`, `.command`, `.bat` or `.scpt` that is
 * program execution. The previous handlers passed the renderer's string
 * straight through with no checks at all, so any renderer-side compromise
 * became arbitrary code execution.
 *
 * The index is the allowlist. A path the user can act on is a path seekr
 * actually found while crawling a root the user configured -- nothing else.
 */

export type PathGuardResult =
  | { ok: true; path: string }
  | { ok: false; reason: string }

export interface PathGuardDeps {
  /** Absolute roots the user has configured for indexing. */
  getIndexedRoots: () => readonly string[]
  /** True if this exact path is a row in the index. */
  isIndexed: (absolutePath: string) => boolean | Promise<boolean>
  /** Injected for tests. Defaults to `fs.realpath`. */
  realpath?: (p: string) => Promise<string>
}

/** Path separators differ, and Windows comparisons are case-insensitive. */
function isWithin(child: string, parent: string): boolean {
  const rel = path.relative(parent, child)
  if (rel === '') return true
  if (rel.startsWith('..')) return false
  return !path.isAbsolute(rel)
}

function normalizeForCompare(p: string): string {
  // Windows and macOS default filesystems are case-insensitive. Comparing
  // case-sensitively there would let `/USERS/x` slip past a `/Users/x` root.
  return process.platform === 'linux' ? p : p.toLowerCase()
}

export class PathGuard {
  constructor(private readonly deps: PathGuardDeps) {}

  /**
   * Returns the real, resolved path when the input is safe to act on.
   *
   * Checks, in order:
   *  1. structural  -- a non-empty absolute string with no NUL byte
   *  2. containment -- resolves under a configured root
   *  3. symlinks    -- the realpath still resolves under a configured root,
   *                    so a symlink inside an indexed root cannot point out of it
   *  4. index       -- the path (or its real target) is actually in the index
   */
  async validate(input: unknown): Promise<PathGuardResult> {
    if (typeof input !== 'string' || input.length === 0) {
      return { ok: false, reason: 'Path must be a non-empty string' }
    }
    // A NUL byte truncates the string in the underlying syscall, so a value
    // like "/safe/file.txt\0/../../evil" can validate as one path and act as another.
    if (input.includes('\0')) {
      return { ok: false, reason: 'Path contains a null byte' }
    }
    if (!path.isAbsolute(input)) {
      return { ok: false, reason: 'Path must be absolute' }
    }

    const normalized = path.normalize(input)
    const roots = this.deps.getIndexedRoots()
    if (roots.length === 0) {
      return { ok: false, reason: 'No indexed roots are configured' }
    }

    const withinAnyRoot = (candidate: string) =>
      roots.some((root) =>
        isWithin(normalizeForCompare(candidate), normalizeForCompare(path.normalize(root))),
      )

    if (!withinAnyRoot(normalized)) {
      return { ok: false, reason: 'Path is outside every indexed root' }
    }

    // Resolve symlinks and re-check. Without this, an attacker who can create a
    // symlink inside an indexed root could point it at /Applications/Anything.app.
    const resolve = this.deps.realpath ?? ((p: string) => fs.realpath(p))
    let real: string
    try {
      real = await resolve(normalized)
    } catch {
      return { ok: false, reason: 'Path does not exist' }
    }

    if (!withinAnyRoot(real)) {
      return { ok: false, reason: 'Path resolves outside every indexed root' }
    }

    const indexed = (await this.deps.isIndexed(normalized)) || (await this.deps.isIndexed(real))
    if (!indexed) {
      return { ok: false, reason: 'Path is not present in the index' }
    }

    return { ok: true, path: real }
  }
}
