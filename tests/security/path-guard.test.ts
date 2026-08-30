import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { PathGuard } from '../../electron/security/path-guard'

const ROOT = path.sep === '\\' ? 'C:\\Users\\test' : '/Users/test'
const inRoot = (...segments: string[]) => path.join(ROOT, ...segments)

/**
 * Builds a guard over a fake filesystem.
 * `indexed` is the set of paths in the index; `links` maps a path to its
 * realpath target. Anything not in either is treated as nonexistent.
 */
function makeGuard(options: {
  roots?: string[]
  indexed?: string[]
  links?: Record<string, string>
} = {}) {
  const roots = options.roots ?? [ROOT]
  const indexed = new Set(options.indexed ?? [])
  const links = options.links ?? {}
  const exists = new Set([...indexed, ...Object.keys(links), ...Object.values(links)])

  return new PathGuard({
    getIndexedRoots: () => roots,
    isIndexed: (p) => indexed.has(p),
    realpath: async (p) => {
      const target = links[p] ?? p
      if (!exists.has(target)) throw new Error('ENOENT')
      return target
    },
  })
}

describe('PathGuard', () => {
  describe('structural validation', () => {
    it.each([
      ['a non-string', 42],
      ['null', null],
      ['undefined', undefined],
      ['an empty string', ''],
      ['an object', { path: inRoot('a.txt') }],
    ])('rejects %s', async (_label, input) => {
      const result = await makeGuard().validate(input)
      expect(result.ok).toBe(false)
    })

    it('rejects a relative path', async () => {
      const result = await makeGuard().validate('notes.txt')
      expect(result).toMatchObject({ ok: false, reason: 'Path must be absolute' })
    })

    // A NUL truncates the string inside the syscall, so the path that is
    // validated and the path that is acted on can differ.
    it('rejects a path containing a null byte', async () => {
      const result = await makeGuard().validate(`${inRoot('safe.txt')}\0/../../evil`)
      expect(result).toMatchObject({ ok: false, reason: 'Path contains a null byte' })
    })
  })

  describe('containment', () => {
    it('rejects everything when no roots are configured', async () => {
      const guard = makeGuard({ roots: [], indexed: [inRoot('a.txt')] })
      const result = await guard.validate(inRoot('a.txt'))
      expect(result).toMatchObject({ ok: false, reason: 'No indexed roots are configured' })
    })

    it('rejects a path outside every indexed root', async () => {
      const outside = path.sep === '\\' ? 'C:\\Windows\\system32\\calc.exe' : '/Applications/Calculator.app'
      const guard = makeGuard({ indexed: [outside] })
      const result = await guard.validate(outside)
      expect(result).toMatchObject({ ok: false, reason: 'Path is outside every indexed root' })
    })

    // `path.normalize` collapses the traversal, so this must be caught by the
    // containment check rather than by string matching on '..'.
    it('rejects a traversal that escapes the root', async () => {
      const escape = inRoot('..', '..', 'etc', 'passwd')
      const guard = makeGuard({ indexed: [path.normalize(escape)] })
      const result = await guard.validate(escape)
      expect(result).toMatchObject({ ok: false, reason: 'Path is outside every indexed root' })
    })

    it('accepts a traversal that stays inside the root', async () => {
      const target = inRoot('Documents', 'notes.txt')
      const viaTraversal = inRoot('Downloads', '..', 'Documents', 'notes.txt')
      const guard = makeGuard({ indexed: [target] })
      const result = await guard.validate(viaTraversal)
      expect(result).toEqual({ ok: true, path: target })
    })
  })

  describe('symlinks', () => {
    it('rejects a symlink inside the root that points outside it', async () => {
      const link = inRoot('innocent.txt')
      const target = path.sep === '\\' ? 'C:\\Windows\\system32\\calc.exe' : '/Applications/Calculator.app'
      const guard = makeGuard({ indexed: [link], links: { [link]: target } })
      const result = await guard.validate(link)
      expect(result).toMatchObject({ ok: false, reason: 'Path resolves outside every indexed root' })
    })

    it('accepts a symlink that resolves to an indexed path inside the root', async () => {
      const link = inRoot('shortcut.txt')
      const target = inRoot('Documents', 'real.txt')
      const guard = makeGuard({ indexed: [target], links: { [link]: target } })
      const result = await guard.validate(link)
      expect(result).toEqual({ ok: true, path: target })
    })
  })

  describe('index membership', () => {
    it('rejects a path inside the root that is not in the index', async () => {
      const ghost = inRoot('never-indexed.txt')
      const guard = makeGuard({ indexed: [], links: { [ghost]: ghost } })
      const result = await guard.validate(ghost)
      expect(result).toMatchObject({ ok: false, reason: 'Path is not present in the index' })
    })

    it('rejects a nonexistent path', async () => {
      const result = await makeGuard().validate(inRoot('gone.txt'))
      expect(result).toMatchObject({ ok: false, reason: 'Path does not exist' })
    })

    it('accepts an indexed path and returns the resolved path', async () => {
      const target = inRoot('Documents', 'report.pdf')
      const guard = makeGuard({ indexed: [target] })
      expect(await guard.validate(target)).toEqual({ ok: true, path: target })
    })
  })

  describe('multiple roots', () => {
    it('accepts a path under any configured root', async () => {
      const second = path.sep === '\\' ? 'D:\\Work' : '/Volumes/Work'
      const target = path.join(second, 'spec.md')
      const guard = makeGuard({ roots: [ROOT, second], indexed: [target] })
      expect(await guard.validate(target)).toEqual({ ok: true, path: target })
    })
  })
})
