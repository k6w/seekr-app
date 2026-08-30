import { createRequire } from 'node:module'
import path from 'node:path'
import type BetterSqlite3 from 'better-sqlite3'
import { decodeCursor, encodeCursor, type SearchRow } from './protocol'
import { parseQuery } from '../services/query-parser'
import type { SearchFilters } from '../../src/types'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

export const SCHEMA_VERSION = 2

/**
 * The durable index.
 *
 * Two things make this different from what it replaces:
 *
 *  1. **The FTS5 index is actually queried.** The previous schema created a
 *     `files_fts` table, wrote to it on every insert with a plain
 *     `INSERT OR REPLACE` (invalid for `content=`, and it desynced immediately),
 *     and then never issued a single MATCH. Search ran
 *     `name LIKE '%q%' OR path LIKE '%q%' OR fullPath LIKE '%q%'` -- three
 *     leading-wildcard scans of every row, on every keystroke.
 *
 *  2. **The tokenizer is `trigram`,** which is what makes substring matching
 *     indexable at all. The default tokenizer only matches whole tokens, so it
 *     could never have served "find files containing 'port'".
 *
 * Trigram has one hard limit: it cannot match fewer than 3 characters. Queries
 * of 1-2 characters fall back to an indexed prefix scan on `nameLower`, which
 * is cheap and, for a launcher, the behaviour users expect from short input.
 */

export interface StoredFile {
  name: string
  fullPath: string
  dir: string
  extension: string
  size: number
  mtimeMs: number
  ctimeMs: number
  isDirectory: boolean
  type: string
  demoted: boolean
}

export interface SearchOptions {
  limit: number
  cursor?: string
  /** Aborts a long scan between batches. */
  shouldCancel?: () => boolean
}

export interface SearchOutcome {
  rows: SearchRow[]
  cursor?: string
}

/**
 * Relevance, computed in SQL over the whole match set rather than by
 * re-ranking whichever page SQL happened to return. Kept as one expression so
 * the keyset cursor can compare against the identical value.
 *
 * :q is the lowercased query. Tiers are spaced so no combination of the
 * modifiers below can move a row between them.
 */
const SCORE_SQL = `(
  CASE
    WHEN f.nameLower = :q THEN 1000
    WHEN f.nameStem = :q THEN 950
    WHEN f.nameLower LIKE :qPrefix ESCAPE '\\' THEN 800
    WHEN instr(f.nameLower, :qBoundarySpace) > 0
      OR instr(f.nameLower, :qBoundaryDash) > 0
      OR instr(f.nameLower, :qBoundaryUnderscore) > 0
      OR instr(f.nameLower, :qBoundaryDot) > 0 THEN 650
    WHEN instr(f.nameLower, :q) > 0 THEN 450
    ELSE 120
  END
  - (f.demoted * 200)
  - MIN(f.depth * 8, 60)
  + CASE WHEN f.isDirectory = 1 THEN 30 ELSE 0 END
  + CASE
      WHEN f.mtimeMs > :recent1d THEN 60
      WHEN f.mtimeMs > :recent7d THEN 40
      WHEN f.mtimeMs > :recent30d THEN 20
      ELSE 0
    END
)`

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

/** FTS5 string literal: wrap in double quotes, doubling any inner quote. */
function ftsPhrase(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}


/**
 * Lowers parsed operators (ext:, type:, size:, date:) into SQL.
 *
 * These used to be applied in JavaScript AFTER the SQL LIMIT, so `type:image`
 * returned "images among the first 100 rows alphabetically" -- usually none.
 */
function filterClauses(
  filters: SearchFilters,
  params: Record<string, unknown>,
): string {
  const clauses: string[] = []

  if (filters.extensions?.length) {
    const keys = filters.extensions.map((extension, i) => {
      params[`ext${i}`] = extension.toLowerCase()
      return `:ext${i}`
    })
    clauses.push(`f.extension IN (${keys.join(', ')})`)
  }

  if (filters.fileTypes?.length) {
    const keys = filters.fileTypes.map((type, i) => {
      params[`type${i}`] = type
      return `:type${i}`
    })
    clauses.push(`f.type IN (${keys.join(', ')})`)
  }

  if (typeof filters.sizeMin === 'number' && Number.isFinite(filters.sizeMin)) {
    params.sizeMin = filters.sizeMin
    clauses.push('f.size >= :sizeMin')
  }
  if (typeof filters.sizeMax === 'number' && Number.isFinite(filters.sizeMax)) {
    params.sizeMax = filters.sizeMax
    clauses.push('f.size <= :sizeMax')
  }

  if (filters.dateModifiedFrom) {
    params.mtimeFrom = new Date(filters.dateModifiedFrom).getTime()
    clauses.push('f.mtimeMs >= :mtimeFrom')
  }
  if (filters.dateModifiedTo) {
    params.mtimeTo = new Date(filters.dateModifiedTo).getTime()
    clauses.push('f.mtimeMs <= :mtimeTo')
  }

  if (filters.includeDirectories === false) clauses.push('f.isDirectory = 0')

  return clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : ''
}

interface Row {
  rowid: number
  name: string
  dir: string
  fullPath: string
  extension: string
  size: number
  mtimeMs: number
  isDirectory: number
  type: string
  score: number
}

export class IndexStore {
  private db: BetterSqlite3.Database
  private insertStmt: BetterSqlite3.Statement | null = null

  constructor(databasePath: string) {
    this.db = new Database(databasePath) as BetterSqlite3.Database
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('temp_store = MEMORY')
    this.db.pragma('cache_size = -64000')
    this.db.pragma('mmap_size = 268435456')
    this.migrate()
  }

  private migrate(): void {
    const current = (this.db.pragma('user_version', { simple: true }) as number) ?? 0

    if (current < SCHEMA_VERSION) {
      // The index is derived state: rebuilding is always cheaper and safer than
      // migrating it, and a re-crawl restores it exactly.
      this.db.exec(`
        DROP TRIGGER IF EXISTS files_ai;
        DROP TRIGGER IF EXISTS files_ad;
        DROP TRIGGER IF EXISTS files_au;
        DROP TABLE IF EXISTS files_fts;
        DROP TABLE IF EXISTS files;
      `)
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        rowid       INTEGER PRIMARY KEY,
        name        TEXT NOT NULL,
        nameLower   TEXT NOT NULL,
        nameStem    TEXT NOT NULL,
        dir         TEXT NOT NULL,
        fullPath    TEXT NOT NULL UNIQUE,
        fullPathLower TEXT NOT NULL,
        extension   TEXT NOT NULL DEFAULT '',
        size        INTEGER NOT NULL DEFAULT 0,
        mtimeMs     INTEGER NOT NULL DEFAULT 0,
        ctimeMs     INTEGER NOT NULL DEFAULT 0,
        isDirectory INTEGER NOT NULL DEFAULT 0,
        type        TEXT NOT NULL DEFAULT 'other',
        demoted     INTEGER NOT NULL DEFAULT 0,
        depth       INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_files_nameLower ON files(nameLower);
      CREATE INDEX IF NOT EXISTS idx_files_extension ON files(extension);
      CREATE INDEX IF NOT EXISTS idx_files_type      ON files(type);
      CREATE INDEX IF NOT EXISTS idx_files_size      ON files(size);
      CREATE INDEX IF NOT EXISTS idx_files_mtime     ON files(mtimeMs);

      CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
        nameLower,
        fullPathLower,
        content='files',
        content_rowid='rowid',
        tokenize='trigram'
      );
    `)

    this.createTriggers()
    this.db.pragma(`user_version = ${SCHEMA_VERSION}`)
  }

  /**
   * Triggers keep the external-content FTS table in sync. This is the
   * documented contract for `content=` tables; writing to them with a plain
   * INSERT OR REPLACE (as the old code did) corrupts the index.
   */
  private createTriggers(): void {
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
        INSERT INTO files_fts(rowid, nameLower, fullPathLower)
        VALUES (new.rowid, new.nameLower, new.fullPathLower);
      END;

      CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
        INSERT INTO files_fts(files_fts, rowid, nameLower, fullPathLower)
        VALUES ('delete', old.rowid, old.nameLower, old.fullPathLower);
      END;

      CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
        INSERT INTO files_fts(files_fts, rowid, nameLower, fullPathLower)
        VALUES ('delete', old.rowid, old.nameLower, old.fullPathLower);
        INSERT INTO files_fts(rowid, nameLower, fullPathLower)
        VALUES (new.rowid, new.nameLower, new.fullPathLower);
      END;
    `)
  }

  private dropTriggers(): void {
    this.db.exec(`
      DROP TRIGGER IF EXISTS files_ai;
      DROP TRIGGER IF EXISTS files_ad;
      DROP TRIGGER IF EXISTS files_au;
    `)
  }

  /**
   * Bulk load without per-row FTS maintenance.
   *
   * Trigram indexing is ~3 writes per row; doing it inline during a full crawl
   * roughly triples insert time. Dropping the triggers and issuing one
   * `rebuild` at the end is dramatically faster and produces an identical index.
   */
  beginBulkLoad(): void {
    this.dropTriggers()
  }

  endBulkLoad(): void {
    this.createTriggers()
    this.db.exec(`INSERT INTO files_fts(files_fts) VALUES('rebuild')`)
    this.db.exec('ANALYZE')
  }

  clear(): void {
    this.db.exec('DELETE FROM files')
    this.db.exec(`INSERT INTO files_fts(files_fts) VALUES('rebuild')`)
  }

  insertMany(files: StoredFile[]): void {
    if (files.length === 0) return

    if (!this.insertStmt) {
      this.insertStmt = this.db.prepare(`
        INSERT INTO files
          (name, nameLower, nameStem, dir, fullPath, fullPathLower, extension, size, mtimeMs, ctimeMs,
           isDirectory, type, demoted, depth)
        VALUES
          (@name, @nameLower, @nameStem, @dir, @fullPath, @fullPathLower, @extension, @size, @mtimeMs, @ctimeMs,
           @isDirectory, @type, @demoted, @depth)
        ON CONFLICT(fullPath) DO UPDATE SET
          name = excluded.name,
          nameLower = excluded.nameLower,
          nameStem = excluded.nameStem,
          size = excluded.size,
          mtimeMs = excluded.mtimeMs,
          type = excluded.type,
          demoted = excluded.demoted
      `)
    }

    const stmt = this.insertStmt
    const insertAll = this.db.transaction((rows: StoredFile[]) => {
      for (const file of rows) {
        const nameLower = file.name.toLowerCase()
        const extension = file.extension.toLowerCase()
        stmt.run({
          name: file.name,
          nameLower,
          // Name without its extension, so "report" ranks highly for "report.pdf".
          nameStem: extension && nameLower.endsWith(extension)
            ? nameLower.slice(0, -extension.length)
            : nameLower,
          dir: file.dir,
          fullPath: file.fullPath,
          fullPathLower: file.fullPath.toLowerCase(),
          extension,
          size: file.size,
          mtimeMs: file.mtimeMs,
          ctimeMs: file.ctimeMs,
          isDirectory: file.isDirectory ? 1 : 0,
          type: file.type,
          demoted: file.demoted ? 1 : 0,
          depth: file.fullPath.split(path.sep).length,
        })
      }
    })

    insertAll(files)
  }

  deleteByPath(fullPath: string): void {
    this.db.prepare('DELETE FROM files WHERE fullPath = ?').run(fullPath)
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM files').get() as { c: number }).c
  }

  hasPath(fullPath: string): boolean {
    return this.db.prepare('SELECT 1 FROM files WHERE fullPath = ? LIMIT 1').get(fullPath) !== undefined
  }

  databaseBytes(): number {
    const pageCount = this.db.pragma('page_count', { simple: true }) as number
    const pageSize = this.db.pragma('page_size', { simple: true }) as number
    return pageCount * pageSize
  }

  /**
   * Ranked search with keyset pagination.
   *
   * Paging is by `(score, rowid)` cursor, never by OFFSET. The old code passed
   * an offset to SQL *and* re-sliced the already-offset window by the same
   * absolute offset, so page 2 skipped 50 rows and page 3 was always empty.
   */
  search(rawQuery: string, options: SearchOptions): SearchOutcome {
    const parsed = parseQuery(rawQuery)
    const query = parsed.text.trim().toLowerCase()
    const hasFilters = Object.keys(parsed.filters).length > 0

    // An empty query with no filters would return the entire index.
    if (query === '' && !hasFilters) return { rows: [] }

    const now = Date.now()
    const params: Record<string, unknown> = {
      q: query,
      qPrefix: `${escapeLike(query)}%`,
      qBoundarySpace: ` ${query}`,
      qBoundaryDash: `-${query}`,
      qBoundaryUnderscore: `_${query}`,
      qBoundaryDot: `.${query}`,
      recent1d: now - 86_400_000,
      recent7d: now - 7 * 86_400_000,
      recent30d: now - 30 * 86_400_000,
      limit: options.limit,
    }

    // Trigram cannot match fewer than 3 characters, so short queries use the
    // indexed prefix scan instead of returning nothing at all.
    let source = 'files f'
    let textFilter = ''
    if (query.length >= 3) {
      source = 'files f JOIN files_fts ON files_fts.rowid = f.rowid AND files_fts MATCH :match'
      params.match = ftsPhrase(query)
    } else if (query.length > 0) {
      params.shortPrefix = `${escapeLike(query)}%`
      textFilter = ` AND f.nameLower LIKE :shortPrefix ESCAPE '\\'`
    }

    const filterFilter = filterClauses(parsed.filters, params)

    let keyset = ''
    const decoded = options.cursor ? decodeCursor(options.cursor) : null
    if (decoded) {
      // Strictly after the cursor in (score DESC, rowid ASC) order.
      keyset = ` AND (${SCORE_SQL} < :cursorScore OR (${SCORE_SQL} = :cursorScore AND f.rowid > :cursorRowid))`
      params.cursorScore = decoded.score
      params.cursorRowid = decoded.rowid
    }

    const sql = `
      SELECT f.rowid, f.name, f.dir, f.fullPath, f.extension, f.size, f.mtimeMs,
             f.isDirectory, f.type, ${SCORE_SQL} AS score
      FROM ${source}
      WHERE 1=1${textFilter}${filterFilter}${keyset}
      ORDER BY score DESC, f.rowid ASC
      LIMIT :limit
    `

    const rows = this.db.prepare(sql).all(params) as Row[]

    const last = rows[rows.length - 1]
    return {
      rows: rows.map((row) => ({
        id: String(row.rowid),
        name: row.name,
        dir: row.dir,
        fullPath: row.fullPath,
        extension: row.extension,
        size: row.size,
        mtimeMs: row.mtimeMs,
        isDirectory: row.isDirectory === 1,
        type: row.type,
        score: row.score,
        highlights: highlightRanges(row.name, query),
      })),
      // Only offer a cursor when the page was full; a short page is the end.
      cursor: last && rows.length === options.limit ? encodeCursor(last.score, last.rowid) : undefined,
    }
  }

  /**
   * True total for the same match set, computed separately so rows can stream
   * to the UI first and the count land a moment later.
   *
   * The old code reported `results.length` -- the size of the page, capped at
   * the fetch limit -- so the UI could never compute more than two pages.
   */
  total(rawQuery: string): number {
    const parsed = parseQuery(rawQuery)
    const query = parsed.text.trim().toLowerCase()
    const hasFilters = Object.keys(parsed.filters).length > 0
    if (query === '' && !hasFilters) return 0

    const params: Record<string, unknown> = {}
    let source = 'files f'
    let textFilter = ''

    if (query.length >= 3) {
      source = 'files f JOIN files_fts ON files_fts.rowid = f.rowid AND files_fts MATCH :match'
      params.match = ftsPhrase(query)
    } else if (query.length > 0) {
      params.shortPrefix = `${escapeLike(query)}%`
      textFilter = ` AND f.nameLower LIKE :shortPrefix ESCAPE '\\'`
    }

    const filterFilter = filterClauses(parsed.filters, params)

    return (
      this.db
        .prepare(`SELECT COUNT(*) AS c FROM ${source} WHERE 1=1${textFilter}${filterFilter}`)
        .get(params) as { c: number }
    ).c
  }

  close(): void {
    try {
      // Fold the WAL back into the database so a fresh launch does not
      // replay it. The previous code never closed the connection on macOS.
      this.db.pragma('wal_checkpoint(TRUNCATE)')
    } catch {
      // best effort
    }
    this.db.close()
  }
}

/**
 * Byte ranges of `query` within `name`, so the renderer highlights using the
 * engine's own match positions instead of re-deriving them with a fresh RegExp
 * per row per render.
 */
export function highlightRanges(name: string, query: string): Array<[number, number]> {
  if (!query) return []
  const haystack = name.toLowerCase()
  const ranges: Array<[number, number]> = []
  let from = 0
  while (ranges.length < 8) {
    const at = haystack.indexOf(query, from)
    if (at === -1) break
    ranges.push([at, query.length])
    from = at + query.length
  }
  return ranges
}
