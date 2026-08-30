import { describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  depthFromRoot,
  isDemotedPath,
  pathSegments,
  shouldSkipDirectory,
  shouldSkipFile,
} from '../../electron/services/path-policy'

const ROOT = path.sep === '\\' ? 'C:\\Users\\test' : '/Users/test'
const p = (...segments: string[]) => path.join(ROOT, ...segments)

describe('shouldSkipDirectory', () => {
  /**
   * The regression this module exists for. The old matcher used
   * `normalizedPath.includes(exclusion)` against a list containing 'out',
   * 'temp', 'cache', 'build', 'dist' and 'target', so every one of these was
   * silently dropped from the index.
   */
  describe('does not substring-match legitimate directories', () => {
    it.each([
      ['checkout', 'contains "out"'],
      ['Layouts', 'contains "out"'],
      ['routes', 'contains "out"'],
      ['about', 'contains "out"'],
      ['templates', 'contains "temp"'],
      ['attempt-2', 'contains "temp"'],
      ['District-plans', 'contains "dist"'],
      ['Cached-reports', 'contains "cache"'],
      ['Targets', 'contains "target"'],
      ['rebuilding', 'contains "build"'],
      ['Blogs', 'contains "logs"'],
      ['Outlook-export', 'contains "out"'],
    ])('indexes %s (%s)', (dirName) => {
      expect(shouldSkipDirectory(p('Documents', dirName), { rootPath: ROOT })).toBe(false)
    })
  })

  it('skips OS-internal directories by exact segment', () => {
    for (const name of ['$RECYCLE.BIN', 'System Volume Information', '.Trashes', '.fseventsd']) {
      expect(shouldSkipDirectory(p(name), { rootPath: ROOT })).toBe(true)
    }
  })

  it('does not skip build-artifact directories -- they are demoted, not excluded', () => {
    for (const name of ['node_modules', 'dist', 'build', 'target', '.git']) {
      expect(shouldSkipDirectory(p('Projects', 'app', name), { rootPath: ROOT })).toBe(false)
    }
  })

  describe('user exclusions', () => {
    it('excludes a bare name by exact segment match', () => {
      const options = { rootPath: ROOT, excludePaths: ['Private'] }
      expect(shouldSkipDirectory(p('Private'), options)).toBe(true)
      expect(shouldSkipDirectory(p('Documents', 'Private'), options)).toBe(true)
      // Must not catch a directory that merely contains the word.
      expect(shouldSkipDirectory(p('PrivateNotes'), options)).toBe(false)
      expect(shouldSkipDirectory(p('MyPrivate'), options)).toBe(false)
    })

    it('excludes an absolute path and its subtree only', () => {
      const options = { rootPath: ROOT, excludePaths: [p('Documents', 'Secret')] }
      expect(shouldSkipDirectory(p('Documents', 'Secret'), options)).toBe(true)
      expect(shouldSkipDirectory(p('Documents', 'Secret', 'deep'), options)).toBe(true)
      expect(shouldSkipDirectory(p('Documents', 'SecretPlans'), options)).toBe(false)
      expect(shouldSkipDirectory(p('Documents'), options)).toBe(false)
    })

    it('ignores blank exclusions', () => {
      const options = { rootPath: ROOT, excludePaths: ['', '   '] }
      expect(shouldSkipDirectory(p('Documents'), options)).toBe(false)
    })
  })

  describe('depth', () => {
    // The old cap counted segments from the FILESYSTEM root, so /Users/name
    // consumed 3 of a budget of 20 before reaching any of the user's files.
    it('measures depth from the scan root, not the filesystem root', () => {
      const deep = p(...Array.from({ length: 10 }, (_, i) => `level${i}`))
      expect(depthFromRoot(deep, ROOT)).toBe(10)
      expect(shouldSkipDirectory(deep, { rootPath: ROOT, maxDepth: 40 })).toBe(false)
    })

    it('skips beyond maxDepth, which bounds symlink cycles', () => {
      const deep = p(...Array.from({ length: 12 }, (_, i) => `level${i}`))
      expect(shouldSkipDirectory(deep, { rootPath: ROOT, maxDepth: 10 })).toBe(true)
    })
  })
})

describe('isDemotedPath', () => {
  it('demotes paths under build-artifact directories', () => {
    expect(isDemotedPath(p('Projects', 'app', 'node_modules', 'react', 'index.js'))).toBe(true)
    expect(isDemotedPath(p('Projects', 'app', '.git', 'config'))).toBe(true)
    expect(isDemotedPath(p('Projects', 'app', '__pycache__', 'm.pyc'))).toBe(true)
  })

  it('does not demote on a substring match', () => {
    expect(isDemotedPath(p('Documents', 'checkout', 'notes.md'))).toBe(false)
    expect(isDemotedPath(p('Documents', 'distribution-list.csv'))).toBe(false)
  })

  it('leaves ordinary user files alone', () => {
    expect(isDemotedPath(p('Documents', 'report.pdf'))).toBe(false)
  })
})

describe('shouldSkipFile', () => {
  it('skips filesystem noise', () => {
    expect(shouldSkipFile('.DS_Store')).toBe(true)
    expect(shouldSkipFile('Thumbs.db')).toBe(true)
  })

  // The old crawler skipped every entry starting with '.' or '$', so nothing in
  // ~/.config and no dotfile was ever findable, non-configurably.
  it('indexes dotfiles', () => {
    for (const name of ['.zshrc', '.env.example', '.gitignore', '.bashrc']) {
      expect(shouldSkipFile(name)).toBe(false)
    }
  })
})

describe('pathSegments', () => {
  it('lowercases and drops empty segments', () => {
    expect(pathSegments(p('Documents', 'Report.PDF'))).toContain('documents')
    expect(pathSegments(p('Documents', 'Report.PDF'))).toContain('report.pdf')
    expect(pathSegments(p('Documents'))).not.toContain('')
  })
})
