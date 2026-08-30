import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { IndexStore, highlightRanges, type StoredFile } from '../../electron/engine/index-store'

let store: IndexStore
let dbPath: string

function file(fullPath: string, overrides: Partial<StoredFile> = {}): StoredFile {
  const name = path.basename(fullPath)
  const extension = path.extname(name).toLowerCase()
  return {
    name,
    fullPath,
    dir: path.dirname(fullPath),
    extension,
    size: 1024,
    mtimeMs: Date.now() - 365 * 86_400_000,
    ctimeMs: Date.now() - 365 * 86_400_000,
    isDirectory: false,
    type: 'document',
    demoted: false,
    ...overrides,
  }
}

beforeEach(() => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'seekr-test-')), 'index.db')
  store = new IndexStore(dbPath)
})

afterEach(() => {
  store.close()
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
})

const names = (rows: { name: string }[]) => rows.map((r) => r.name)

describe('IndexStore', () => {
  describe('trigram matching', () => {
    beforeEach(() => {
      store.insertMany([
        file('/home/u/quarterly-report.pdf'),
        file('/home/u/annual-summary.docx'),
        file('/home/u/transport-log.txt'),
      ])
    })

    /**
     * The point of the trigram tokenizer. The default FTS5 tokenizer only
     * matches whole tokens, and the code this replaces never issued a MATCH at
     * all -- it ran three leading-wildcard LIKEs over every row per keystroke.
     */
    it('matches a substring in the middle of a name', () => {
      expect(names(store.search('port', { limit: 10 }).rows).sort()).toEqual([
        'quarterly-report.pdf',
        'transport-log.txt',
      ])
    })

    it('matches against the full path, not just the name', () => {
      store.insertMany([file('/home/u/Invoices/2026/jan.txt')])
      expect(names(store.search('invoices', { limit: 10 }).rows)).toContain('jan.txt')
    })

    it('is case-insensitive', () => {
      expect(store.search('REPORT', { limit: 10 }).rows.length).toBe(1)
      expect(store.search('rEpOrT', { limit: 10 }).rows.length).toBe(1)
    })

    it('returns nothing for a query that matches nothing', () => {
      expect(store.search('zzzznotpresent', { limit: 10 }).rows).toEqual([])
    })
  })

  /**
   * Trigram indexes cannot match fewer than three characters, so without a
   * fallback the first two keystrokes of every search would return nothing.
   */
  describe('short queries', () => {
    beforeEach(() => {
      store.insertMany([file('/home/u/readme.md'), file('/home/u/recipe.txt'), file('/home/u/notes.md')])
    })

    it.each([['r'], ['re']])('falls back to a prefix scan for %s', (query) => {
      const found = names(store.search(query, { limit: 10 }).rows).sort()
      expect(found).toEqual(['readme.md', 'recipe.txt'])
    })

    it('counts short queries correctly too', () => {
      expect(store.total('re')).toBe(2)
    })
  })

  describe('ranking', () => {
    it('orders exact, stem, prefix, boundary, then substring', () => {
      store.insertMany([
        file('/a/xxreportxx.txt'), // substring
        file('/a/my-report.txt'), // word boundary
        file('/a/report-final.txt'), // prefix
        file('/a/report.txt'), // exact on the stem
        file('/a/report'), // exact full name
      ])

      expect(names(store.search('report', { limit: 10 }).rows)).toEqual([
        'report',
        'report.txt',
        'report-final.txt',
        'my-report.txt',
        'xxreportxx.txt',
      ])
    })

    it('sinks demoted rows below equivalent matches', () => {
      store.insertMany([
        file('/a/node_modules/report.txt', { demoted: true }),
        file('/a/src/report.txt', { demoted: false }),
      ])
      const rows = store.search('report', { limit: 10 }).rows
      expect(rows[0].fullPath).toBe('/a/src/report.txt')
      expect(rows[1].fullPath).toBe('/a/node_modules/report.txt')
    })

    it('boosts recently modified files', () => {
      store.insertMany([
        file('/a/old-report.txt', { mtimeMs: Date.now() - 400 * 86_400_000 }),
        file('/a/new-report.txt', { mtimeMs: Date.now() - 1000 }),
      ])
      expect(store.search('report', { limit: 10 }).rows[0].name).toBe('new-report.txt')
    })
  })

  /**
   * The regression this design exists for. The previous implementation passed
   * an offset to SQL and then re-sliced the already-offset window by the same
   * absolute offset, so page 2 silently skipped 50 rows and page 3 onward came
   * back empty.
   */
  describe('keyset pagination', () => {
    beforeEach(() => {
      store.insertMany(
        Array.from({ length: 250 }, (_, i) =>
          file(`/a/report-${String(i).padStart(3, '0')}.txt`),
        ),
      )
    })

    it('walks the entire result set with no gaps and no repeats', () => {
      const seen: string[] = []
      let cursor: string | undefined
      let pages = 0

      do {
        const page = store.search('report', { limit: 50, cursor })
        seen.push(...page.rows.map((r) => r.fullPath))
        cursor = page.cursor
        pages++
        expect(pages).toBeLessThan(20) // guard against a cursor that never advances
      } while (cursor)

      expect(seen.length).toBe(250)
      expect(new Set(seen).size).toBe(250)
      expect(pages).toBe(6) // 5 full pages of 50, then a short final page
    })

    it('returns a non-empty page 3', () => {
      const p1 = store.search('report', { limit: 50 })
      const p2 = store.search('report', { limit: 50, cursor: p1.cursor })
      const p3 = store.search('report', { limit: 50, cursor: p2.cursor })
      expect(p3.rows.length).toBe(50)
    })

    it('does not overlap between consecutive pages', () => {
      const p1 = store.search('report', { limit: 50 })
      const p2 = store.search('report', { limit: 50, cursor: p1.cursor })
      const first = new Set(p1.rows.map((r) => r.fullPath))
      expect(p2.rows.some((r) => first.has(r.fullPath))).toBe(false)
    })

    it('stops offering a cursor once the set is exhausted', () => {
      expect(store.search('report', { limit: 500 }).cursor).toBeUndefined()
    })
  })

  describe('total', () => {
    /**
     * `totalCount` used to report the size of the page, capped at the fetch
     * limit, so the UI could never compute more than two pages.
     */
    it('is the true match count, not the page size', () => {
      store.insertMany(Array.from({ length: 130 }, (_, i) => file(`/a/report-${i}.txt`)))
      expect(store.search('report', { limit: 10 }).rows.length).toBe(10)
      expect(store.total('report')).toBe(130)
    })

    it('is zero for an empty query', () => {
      expect(store.total('')).toBe(0)
    })
  })

  describe('incremental updates', () => {
    it('makes an inserted file findable immediately', () => {
      store.insertMany([file('/a/fresh-notes.txt')])
      expect(store.search('fresh', { limit: 5 }).rows.length).toBe(1)
    })

    it('removes a deleted file from the index', () => {
      store.insertMany([file('/a/temporary.txt')])
      expect(store.search('temporary', { limit: 5 }).rows.length).toBe(1)
      store.deleteByPath('/a/temporary.txt')
      expect(store.search('temporary', { limit: 5 }).rows.length).toBe(0)
    })

    it('upserts on a repeated path instead of duplicating it', () => {
      store.insertMany([file('/a/doc.txt', { size: 100 })])
      store.insertMany([file('/a/doc.txt', { size: 999 })])
      const rows = store.search('doc', { limit: 5 }).rows
      expect(rows.length).toBe(1)
      expect(rows[0].size).toBe(999)
    })

    it('keeps the FTS index consistent through a bulk load', () => {
      store.beginBulkLoad()
      store.insertMany(Array.from({ length: 100 }, (_, i) => file(`/bulk/item-${i}.txt`)))
      store.endBulkLoad()
      expect(store.total('item')).toBe(100)
    })

    it('clear() empties both the table and the FTS index', () => {
      store.insertMany([file('/a/gone.txt')])
      store.clear()
      expect(store.count()).toBe(0)
      expect(store.search('gone', { limit: 5 }).rows).toEqual([])
    })
  })

  describe('special characters', () => {
    it('treats LIKE wildcards in a short query as literals', () => {
      store.insertMany([file('/a/a%b.txt'), file('/a/axb.txt')])
      // '%' must not act as a wildcard and match axb.txt.
      expect(names(store.search('a%', { limit: 10 }).rows)).toEqual(['a%b.txt'])
    })

    it('handles a query containing double quotes without breaking FTS syntax', () => {
      store.insertMany([file('/a/say "hello" now.txt')])
      expect(store.search('"hello"', { limit: 5 }).rows.length).toBe(1)
    })

    it('indexes unicode names', () => {
      store.insertMany([file('/a/résumé-2026.pdf'), file('/a/日本語ファイル.txt')])
      expect(store.search('résumé', { limit: 5 }).rows.length).toBe(1)
      expect(store.search('日本語', { limit: 5 }).rows.length).toBe(1)
    })
  })

  describe('hasPath', () => {
    it('is true only for indexed paths', () => {
      store.insertMany([file('/a/known.txt')])
      expect(store.hasPath('/a/known.txt')).toBe(true)
      expect(store.hasPath('/a/unknown.txt')).toBe(false)
    })
  })
})

describe('highlightRanges', () => {
  it('returns every occurrence', () => {
    expect(highlightRanges('report-report.txt', 'report')).toEqual([
      [0, 6],
      [7, 6],
    ])
  })

  it('is case-insensitive but indexes into the original string', () => {
    expect(highlightRanges('MyReport.txt', 'report')).toEqual([[2, 6]])
  })

  it('returns nothing for an empty query', () => {
    expect(highlightRanges('anything', '')).toEqual([])
  })
})
