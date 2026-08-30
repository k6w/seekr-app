import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { crawl } from '../../electron/engine/crawler'
import { IndexStore, type StoredFile } from '../../electron/engine/index-store'

/**
 * End-to-end over a real directory tree: crawl -> index -> search.
 *
 * The unit tests cover the store in isolation; this asserts the pieces agree
 * about what a file is, which is exactly where the old code diverged -- the
 * indexer never wrote directory rows while the watcher did, so `type:folder`
 * matched nothing and `includeDirectories` was dead.
 */

let root: string
let store: IndexStore

const FIXTURE = {
  'Documents/quarterly-report.pdf': 'pdf',
  'Documents/annual-summary.docx': 'docx',
  'Documents/.hidden-notes.md': 'dotfile content',
  'Downloads/transport-schedule.txt': 'txt',
  'Projects/app/src/index.ts': 'code',
  'Projects/app/node_modules/left-pad/index.js': 'dependency',
  'Projects/app/dist/bundle.js': 'build output',
  // Directory names the old substring matcher silently excluded from the index.
  'Projects/checkout/README.md': 'contains "out"',
  'Projects/Layouts/grid.css': 'contains "out"',
  'Projects/templates/base.html': 'contains "temp"',
  'Media/holiday.jpg': 'image',
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'seekr-e2e-'))

  for (const [relative, contents] of Object.entries(FIXTURE)) {
    const full = path.join(root, relative)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, contents)
  }

  store = new IndexStore(path.join(root, 'index.db'))
  store.beginBulkLoad()

  const batch: StoredFile[] = []
  for await (const entry of crawl(root, {})) batch.push(entry)
  store.insertMany(batch)
  store.endBulkLoad()
})

afterAll(() => {
  store.close()
  fs.rmSync(root, { recursive: true, force: true })
})

const found = (query: string) =>
  store.search(query, { limit: 100 }).rows.map((row) => row.name)

describe('crawl -> index -> search', () => {
  it('indexes files from the real filesystem', () => {
    expect(found('quarterly')).toContain('quarterly-report.pdf')
    expect(found('holiday')).toContain('holiday.jpg')
  })

  it('indexes directories, so folders are findable', () => {
    const rows = store.search('Downloads', { limit: 10 }).rows
    expect(rows.some((row) => row.isDirectory && row.name === 'Downloads')).toBe(true)
  })

  it('indexes dotfiles', () => {
    // The old crawler skipped every entry starting with '.' or '$',
    // non-configurably, so nothing in ~/.config was ever findable.
    expect(found('hidden-notes')).toContain('.hidden-notes.md')
  })

  /**
   * The regression that motivated path-policy.ts. `shouldExcludePath` tested
   * `normalizedPath.includes(exclusion)` against a list containing 'out',
   * 'temp', 'dist' and 'build', so every one of these directories was silently
   * dropped from the index.
   */
  describe('directories that merely contain an excluded word', () => {
    it.each([
      ['README.md', 'checkout'],
      ['grid.css', 'Layouts'],
      ['base.html', 'templates'],
    ])('indexes %s under %s', (fileName) => {
      expect(found(fileName.split('.')[0])).toContain(fileName)
    })
  })

  describe('build artefacts', () => {
    it('indexes them rather than excluding them', () => {
      expect(found('left-pad')).toContain('index.js')
      expect(found('bundle')).toContain('bundle.js')
    })

    it('ranks them below equivalent matches outside them', () => {
      const rows = store.search('index', { limit: 20 }).rows
      const source = rows.findIndex((row) => row.fullPath.includes(`${path.sep}src${path.sep}`))
      const dependency = rows.findIndex((row) => row.fullPath.includes('node_modules'))
      expect(source).toBeGreaterThanOrEqual(0)
      expect(dependency).toBeGreaterThanOrEqual(0)
      expect(source).toBeLessThan(dependency)
    })
  })

  describe('operators', () => {
    it('filters by extension', () => {
      const rows = store.search('ext:pdf', { limit: 20 }).rows
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every((row) => row.extension === '.pdf')).toBe(true)
    })

    it('filters by type', () => {
      const rows = store.search('type:image', { limit: 20 }).rows
      expect(rows.map((row) => row.name)).toContain('holiday.jpg')
      expect(rows.every((row) => row.type === 'image')).toBe(true)
    })

    it('combines an operator with text', () => {
      const rows = store.search('report ext:pdf', { limit: 20 }).rows
      expect(rows.map((row) => row.name)).toEqual(['quarterly-report.pdf'])
    })

    it('reports a total consistent with the filtered set', () => {
      expect(store.total('ext:pdf')).toBe(store.search('ext:pdf', { limit: 100 }).rows.length)
    })
  })

  it('matches against path components, not only file names', () => {
    const rows = store.search('Projects', { limit: 100 }).rows
    expect(rows.length).toBeGreaterThan(1)
  })

  it('reports a total equal to the number of rows actually returned', () => {
    const rows = store.search('index', { limit: 100 }).rows
    expect(store.total('index')).toBe(rows.length)
  })
})
