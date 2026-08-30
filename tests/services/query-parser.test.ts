import { describe, expect, it } from 'vitest'
import { mergeFilters, parseQuery, periodStart } from '../../electron/services/query-parser'
import { FileType } from '../../src/types'

const NOW = new Date('2026-08-30T15:30:00Z')

describe('parseQuery', () => {
  it('returns the query unchanged when it has no operators', () => {
    expect(parseQuery('quarterly report')).toEqual({ text: 'quarterly report', filters: {} })
  })

  describe('ext:', () => {
    it('parses a single extension and normalizes the leading dot', () => {
      const { text, filters } = parseQuery('report ext:pdf')
      expect(text).toBe('report')
      expect(filters.extensions).toEqual(['.pdf'])
    })

    it('parses a comma-separated list', () => {
      expect(parseQuery('ext:pdf,docx,txt').filters.extensions).toEqual(['.pdf', '.docx', '.txt'])
    })

    it('accepts an extension already written with a dot', () => {
      expect(parseQuery('ext:.png').filters.extensions).toEqual(['.png'])
    })
  })

  describe('type:', () => {
    /**
     * The regression that motivated a single parser: database.ts uppercased
     * the value to 'IMAGE' while the enum stores 'image', so `type:image`
     * matched zero rows on that code path.
     */
    it('maps to the lowercase enum value the database actually stores', () => {
      expect(parseQuery('type:image').filters.fileTypes).toEqual([FileType.IMAGE])
      expect(FileType.IMAGE).toBe('image')
    })

    it.each([
      ['type:doc', FileType.DOCUMENT],
      ['type:img', FileType.IMAGE],
      ['type:video', FileType.VIDEO],
      ['type:music', FileType.AUDIO],
      ['type:folder', FileType.DIRECTORY],
      ['kind:code', FileType.CODE],
    ])('resolves %s', (query, expected) => {
      expect(parseQuery(query).filters.fileTypes).toEqual([expected])
    })

    it('ignores an unknown type and leaves the token out of the text', () => {
      const { text, filters } = parseQuery('notes type:banana')
      expect(filters.fileTypes).toBeUndefined()
      expect(text).toBe('notes')
    })
  })

  describe('size:', () => {
    it('parses a greater-than bound', () => {
      const { filters } = parseQuery('size:>10mb')
      expect(filters.sizeMin).toBe(10 * 1024 ** 2)
      expect(filters.sizeMax).toBeUndefined()
    })

    it('parses a less-than bound', () => {
      expect(parseQuery('size:<1gb').filters.sizeMax).toBe(1024 ** 3)
    })

    it('treats a bare size as a tolerance band, since exact byte matches are useless', () => {
      const { filters } = parseQuery('size:100kb')
      const bytes = 100 * 1024
      expect(filters.sizeMin).toBe(Math.floor(bytes * 0.95))
      expect(filters.sizeMax).toBe(Math.ceil(bytes * 1.05))
    })

    it('defaults to bytes when no unit is given', () => {
      expect(parseQuery('size:>500').filters.sizeMin).toBe(500)
    })
  })

  describe('date:', () => {
    it('parses today as midnight local time', () => {
      const { filters } = parseQuery('date:today', NOW)
      const expected = new Date(NOW)
      expected.setHours(0, 0, 0, 0)
      expect(filters.dateModifiedFrom).toEqual(expected)
    })

    it('bounds yesterday on both ends', () => {
      const { filters } = parseQuery('date:yesterday', NOW)
      expect(filters.dateModifiedFrom).toBeDefined()
      expect(filters.dateModifiedTo).toBeDefined()
      const span =
        (filters.dateModifiedTo as Date).getTime() - (filters.dateModifiedFrom as Date).getTime()
      expect(span).toBe(24 * 60 * 60 * 1000)
    })

    it.each(['modified:week', 'dm:week'])('accepts the %s alias', (query) => {
      expect(parseQuery(query, NOW).filters.dateModifiedFrom).toBeDefined()
    })
  })

  it('strips every operator and collapses the remaining whitespace', () => {
    const { text } = parseQuery('ext:pdf quarterly size:>1mb report type:document date:week')
    expect(text).toBe('quarterly report')
  })

  it('combines multiple operators into one filter set', () => {
    const { filters } = parseQuery('budget ext:xlsx size:>1mb type:document', NOW)
    expect(filters.extensions).toEqual(['.xlsx'])
    expect(filters.fileTypes).toEqual([FileType.DOCUMENT])
    expect(filters.sizeMin).toBe(1024 ** 2)
  })
})

describe('periodStart', () => {
  it('returns null for an unknown period', () => {
    expect(periodStart('fortnight', NOW)).toBeNull()
  })

  it('orders the named periods from most to least recent', () => {
    const today = periodStart('today', NOW) as Date
    const week = periodStart('week', NOW) as Date
    const month = periodStart('month', NOW) as Date
    const year = periodStart('year', NOW) as Date
    expect(today.getTime()).toBeGreaterThan(week.getTime())
    expect(week.getTime()).toBeGreaterThan(month.getTime())
    expect(month.getTime()).toBeGreaterThan(year.getTime())
  })
})

describe('mergeFilters', () => {
  it('lets typed operators win over UI filters', () => {
    const merged = mergeFilters({ fileTypes: [FileType.IMAGE] }, { fileTypes: [FileType.DOCUMENT] })
    expect(merged.fileTypes).toEqual([FileType.DOCUMENT])
  })

  it('keeps UI filters the query does not mention', () => {
    const merged = mergeFilters({ fileTypes: [FileType.IMAGE] }, { sizeMin: 1024 })
    expect(merged.fileTypes).toEqual([FileType.IMAGE])
    expect(merged.sizeMin).toBe(1024)
  })

  /**
   * The old combineFilters did `sizeMax: Math.min(filters.sizeMax || Infinity, ...)`,
   * so sizeMax was always present -- as Infinity -- and never truly absent.
   */
  it('leaves absent bounds undefined rather than Infinity', () => {
    const merged = mergeFilters({}, {})
    expect(merged.sizeMax).toBeUndefined()
    expect(merged.sizeMin).toBeUndefined()
  })

  it('does not mutate its inputs', () => {
    const base = { fileTypes: [FileType.IMAGE] }
    mergeFilters(base, { fileTypes: [FileType.CODE] })
    expect(base.fileTypes).toEqual([FileType.IMAGE])
  })
})
