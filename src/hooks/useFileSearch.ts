import { useCallback, useEffect, useRef, useState } from 'react'
import type { SearchRow } from '../../electron/ipc/api'
import { useSearchHistory } from './useSearchHistory'
import { useDebouncedCallback } from './useDebounce'

const PAGE_SIZE = 60

export interface SearchState {
  rows: SearchRow[]
  total: number | null
  elapsedMs: number
}

/**
 * Search, backed by the engine process.
 *
 * Three things this replaces:
 *
 *  - A double debounce (300ms here plus 300ms in SearchInput) that made real
 *    keystroke-to-result latency ~600ms.
 *  - An AbortController that aborted nothing, because `ipcRenderer.invoke`
 *    takes no signal. Cancellation now happens in the engine, which abandons
 *    any request older than the newest one on the port.
 *  - Numeric-offset paging, which double-applied the offset and made page 3
 *    onward come back empty. Paging is by opaque keyset cursor.
 */
export function useFileSearch() {
  const [query, setQuery] = useState('')
  const [state, setState] = useState<SearchState>({ rows: [], total: null, elapsedMs: 0 })
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cursorRef = useRef<string | undefined>(undefined)
  const requestRef = useRef(0)
  const { addToHistory } = useSearchHistory()

  const runSearch = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      requestRef.current += 1
      const requestId = requestRef.current

      if (!trimmed) {
        cursorRef.current = undefined
        setState({ rows: [], total: null, elapsedMs: 0 })
        setIsLoading(false)
        setError(null)
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        const page = await window.seekr.search(trimmed, { limit: PAGE_SIZE, wantTotal: true })
        // A newer keystroke landed while this was in flight.
        if (requestId !== requestRef.current) return

        cursorRef.current = page.cursor
        setState({ rows: page.rows, total: page.total ?? page.rows.length, elapsedMs: page.elapsedMs })
        if (page.total !== undefined) addToHistory(trimmed, page.total)
      } catch (err) {
        if (requestId !== requestRef.current) return
        setError(err instanceof Error ? err.message : 'Search failed')
        setState({ rows: [], total: 0, elapsedMs: 0 })
      } finally {
        if (requestId === requestRef.current) setIsLoading(false)
      }
    },
    [addToHistory],
  )

  const [debouncedSearch] = useDebouncedCallback((text: string) => void runSearch(text), 120)

  const search = useCallback(
    (text: string) => {
      setQuery(text)
      debouncedSearch(text)
    },
    [debouncedSearch],
  )

  /** Appends the next page. Replaces the old first/prev/next pager entirely. */
  const loadMore = useCallback(async () => {
    const cursor = cursorRef.current
    if (!cursor || isLoadingMore) return

    const requestId = requestRef.current
    setIsLoadingMore(true)
    try {
      const page = await window.seekr.search(query.trim(), { limit: PAGE_SIZE, cursor })
      if (requestId !== requestRef.current) return

      cursorRef.current = page.cursor
      setState((previous) => ({ ...previous, rows: [...previous.rows, ...page.rows] }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more results')
    } finally {
      setIsLoadingMore(false)
    }
  }, [query, isLoadingMore])

  const clearSearch = useCallback(() => {
    requestRef.current += 1
    cursorRef.current = undefined
    setQuery('')
    setState({ rows: [], total: null, elapsedMs: 0 })
    setError(null)
    setIsLoading(false)
  }, [])

  const openFile = useCallback(async (fullPath: string) => {
    const result = await window.seekr.file.open(fullPath)
    if (!result.ok) setError(result.error)
  }, [])

  const revealFile = useCallback(async (fullPath: string) => {
    const result = await window.seekr.file.reveal(fullPath)
    if (!result.ok) setError(result.error)
  }, [])

  const copyPath = useCallback(async (fullPath: string) => {
    const result = await window.seekr.file.copyPath(fullPath)
    if (!result.ok) setError(result.error)
  }, [])

  const trashFile = useCallback(
    async (fullPath: string) => {
      const result = await window.seekr.file.trash(fullPath)
      if (!result.ok) {
        setError(result.error)
        return
      }
      // Drop it from the visible list immediately; the watcher will catch up.
      setState((previous) => ({
        ...previous,
        rows: previous.rows.filter((row) => row.fullPath !== fullPath),
        total: previous.total === null ? null : Math.max(0, previous.total - 1),
      }))
    },
    [],
  )

  // Results reflect an index that just changed underneath them.
  useEffect(() => {
    return window.seekr.events.onIndexComplete(() => {
      if (query.trim()) void runSearch(query)
    })
  }, [query, runSearch])

  return {
    query,
    setQuery,
    rows: state.rows,
    total: state.total,
    elapsedMs: state.elapsedMs,
    isLoading,
    isLoadingMore,
    hasMore: cursorRef.current !== undefined,
    error,
    search,
    loadMore,
    clearSearch,
    openFile,
    revealFile,
    copyPath,
    trashFile,
  }
}
