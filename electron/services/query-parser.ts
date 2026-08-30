import { FileType, SearchFilters } from '../../src/types'

/**
 * Parses inline search operators out of a query string.
 *
 * There used to be TWO parsers with incompatible semantics: one in search.ts
 * and one in database.ts. The database one mapped `type:image` to the string
 * `'IMAGE'` while the enum stores `'image'`, so on that code path `type:image`
 * matched nothing at all. This is the only parser now.
 */

export interface ParsedQuery {
  /** The query with all operator tokens removed. */
  text: string
  filters: SearchFilters
}

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
  tb: 1024 ** 4,
}

const TYPE_ALIASES: Record<string, FileType> = {
  document: FileType.DOCUMENT,
  doc: FileType.DOCUMENT,
  image: FileType.IMAGE,
  img: FileType.IMAGE,
  picture: FileType.IMAGE,
  video: FileType.VIDEO,
  audio: FileType.AUDIO,
  music: FileType.AUDIO,
  archive: FileType.ARCHIVE,
  zip: FileType.ARCHIVE,
  code: FileType.CODE,
  folder: FileType.DIRECTORY,
  dir: FileType.DIRECTORY,
  directory: FileType.DIRECTORY,
}

/** Start of a named period, relative to `now`. */
export function periodStart(period: string, now: Date): Date | null {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)

  switch (period) {
    case 'today':
      return start
    case 'yesterday':
      start.setDate(start.getDate() - 1)
      return start
    case 'week':
      start.setDate(start.getDate() - 7)
      return start
    case 'month':
      start.setMonth(start.getMonth() - 1)
      return start
    case 'year':
      start.setFullYear(start.getFullYear() - 1)
      return start
    default:
      return null
  }
}

export function parseQuery(query: string, now: Date = new Date()): ParsedQuery {
  const filters: SearchFilters = {}
  let text = query

  const consume = (pattern: RegExp, handler: (match: RegExpExecArray) => void) => {
    text = text.replace(pattern, (...args) => {
      // `replace` hands us (match, ...groups, offset, string); rebuild an
      // exec-like array so handlers can index groups naturally.
      const groups = args.slice(0, -2) as unknown as RegExpExecArray
      handler(groups)
      return ' '
    })
  }

  // ext:pdf  ext:pdf,docx  ext:.png
  consume(/\bext:([\w.,]+)/gi, (match) => {
    const extensions = match[1]
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
      .map((value) => (value.startsWith('.') ? value : `.${value}`))
    if (extensions.length > 0) {
      filters.extensions = [...(filters.extensions ?? []), ...extensions]
    }
  })

  // type:image  kind:folder
  consume(/\b(?:type|kind):(\w+)/gi, (match) => {
    const fileType = TYPE_ALIASES[match[1].toLowerCase()]
    if (fileType) {
      filters.fileTypes = [...(filters.fileTypes ?? []), fileType]
    }
  })

  // size:>10mb  size:<1gb  size:500kb
  consume(/\bsize:([<>]=?)?(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?/gi, (match) => {
    const [, operator, amount, unit] = match
    const bytes = Number(amount) * (SIZE_UNITS[(unit ?? 'b').toLowerCase()] ?? 1)
    if (!Number.isFinite(bytes)) return

    if (operator === '>' || operator === '>=') filters.sizeMin = bytes
    else if (operator === '<' || operator === '<=') filters.sizeMax = bytes
    else {
      // A bare size is a +/-5% band, since exact byte matches are useless.
      filters.sizeMin = Math.floor(bytes * 0.95)
      filters.sizeMax = Math.ceil(bytes * 1.05)
    }
  })

  // date:today  modified:week  dm:month
  consume(/\b(?:date|modified|dm):(\w+)/gi, (match) => {
    const start = periodStart(match[1].toLowerCase(), now)
    if (!start) return
    filters.dateModifiedFrom = start
    if (match[1].toLowerCase() === 'yesterday') {
      const end = new Date(start)
      end.setDate(end.getDate() + 1)
      filters.dateModifiedTo = end
    }
  })

  return { text: text.replace(/\s+/g, ' ').trim(), filters }
}

/**
 * Merges parsed operators over explicit UI filters.
 *
 * Operators win, because the user typed them most recently. Note this returns
 * a fresh object -- the old `combineFilters` set `sizeMax: Math.min(x, Infinity)`,
 * so `sizeMax` was never actually absent.
 */
export function mergeFilters(base: SearchFilters, parsed: SearchFilters): SearchFilters {
  const merged: SearchFilters = { ...base }

  if (parsed.extensions?.length) merged.extensions = parsed.extensions
  if (parsed.fileTypes?.length) merged.fileTypes = parsed.fileTypes
  if (parsed.sizeMin !== undefined) merged.sizeMin = parsed.sizeMin
  if (parsed.sizeMax !== undefined) merged.sizeMax = parsed.sizeMax
  if (parsed.dateModifiedFrom !== undefined) merged.dateModifiedFrom = parsed.dateModifiedFrom
  if (parsed.dateModifiedTo !== undefined) merged.dateModifiedTo = parsed.dateModifiedTo

  return merged
}
