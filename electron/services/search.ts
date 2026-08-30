import { DatabaseService } from './database'
import { SearchFilters, SearchResult } from '../../src/types'
import { mergeFilters, parseQuery } from './query-parser'

/**
 * Thin wrapper over the database query.
 *
 * What this replaces: three divergent code paths (filters-only, fuse.js fuzzy,
 * and SQL LIKE), a fuse.js index rebuilt every 5 minutes from the
 * alphabetically-first 10,000 rows, JS filtering applied after the SQL LIMIT,
 * a hand-rolled scorer that ranked an arbitrary alphabetical slice, a
 * double-applied pagination offset, and a totalCount that reported the page
 * size. All of the filtering, ordering, counting and paging now happens once,
 * in SQL, over the whole match set.
 *
 * fuse.js is gone. It was only reachable when a query contained a wildcard or
 * a non-alphanumeric character, which meant the actual typo case it was
 * advertised for -- "documnet" -> "document" -- never reached it. Real fuzzy
 * matching arrives with the engine rewrite.
 */
export class SearchService {
  constructor(private readonly db: DatabaseService) {}

  async search(
    query: string,
    filters: SearchFilters = {},
    limit = 100,
    offset = 0,
  ): Promise<SearchResult> {
    const startTime = performance.now()

    const parsed = parseQuery(query)
    const combined = mergeFilters(filters, parsed.filters)

    // An empty query with no filters would otherwise return the whole index.
    if (parsed.text === '' && Object.keys(combined).length === 0) {
      return { items: [], totalCount: 0, query, executionTime: 0 }
    }

    const { items, totalCount } = await this.db.searchFiles(parsed.text, combined, limit, offset)

    return {
      items,
      totalCount,
      query,
      executionTime: Math.round(performance.now() - startTime),
    }
  }
}
