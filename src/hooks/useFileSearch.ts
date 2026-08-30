import { useCallback, useEffect, useRef, useState } from 'react'
import { SearchResult, FileItem, SearchFilters, IpcSearchRequest } from '@/types'
import { useSearchHistory } from './useSearchHistory'
import { useSearchCache } from './useSearchCache'
import { useDebouncedCallback } from './useDebounce'

const ITEMS_PER_PAGE = 50

export function useFileSearch() {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<SearchFilters>({})
  const [currentPage, setCurrentPage] = useState(1)

  const { addToHistory } = useSearchHistory()
  const searchCache = useSearchCache({ maxSize: 50, ttl: 10 * 60 * 1000 })

  /**
   * Monotonic request id.
   *
   * Replaces the previous AbortController, which aborted nothing: IPC invoke
   * takes no signal, so the main process ran every dispatched query to
   * completion. Worse, the guard read `abortControllerRef.current`, which by
   * then pointed at the NEWER controller, so it never reported aborted and a
   * slow earlier response could overwrite newer results.
   */
  const latestRequestId = useRef(0)

  /**
   * `searchFilters` is authoritative, not merged over state.
   *
   * The old code did `{ ...filters, ...searchFilters }`, so "Clear all"
   * (which passes `{}`) re-applied the filters it had just cleared, from a
   * stale closure.
   */
  const performSearch = useCallback(
    async (query: string, searchFilters: SearchFilters, page: number) => {
      const trimmed = query.trim()
      if (!trimmed && Object.keys(searchFilters).length === 0) {
        setSearchResults(null)
        return
      }

      latestRequestId.current += 1
      const requestId = latestRequestId.current
      const cacheKey = `${trimmed} ${JSON.stringify(searchFilters)} ${page}`

      const cached = searchCache.get(cacheKey, {})
      if (cached) {
        setSearchResults(cached)
        setIsLoading(false)
        setError(null)
        return
      }

      setIsLoading(true)
      setError(null)

      const request: IpcSearchRequest = {
        query: trimmed,
        filters: searchFilters,
        limit: ITEMS_PER_PAGE,
        offset: (page - 1) * ITEMS_PER_PAGE,
      }

      try {
        const response = await window.seekr.search(request)
        // A newer search started while this was in flight; discard.
        if (requestId !== latestRequestId.current) return

        if (response.ok) {
          setSearchResults(response.data)
          searchCache.set(cacheKey, {}, response.data)
          if (trimmed) addToHistory(trimmed, response.data.totalCount)
        } else {
          setError(response.error)
          setSearchResults(null)
        }
      } catch (err) {
        if (requestId !== latestRequestId.current) return
        setError(err instanceof Error ? err.message : 'Search failed')
        setSearchResults(null)
      } finally {
        if (requestId === latestRequestId.current) setIsLoading(false)
      }
    },
    [searchCache, addToHistory],
  )

  const [debouncedSearch] = useDebouncedCallback(
    (query: string, searchFilters: SearchFilters) => {
      void performSearch(query, searchFilters, 1)
    },
    250,
  )

  const search = useCallback(
    (query: string) => {
      setSearchQuery(query)
      setCurrentPage(1)
      if (query.trim()) debouncedSearch(query, filters)
      else setSearchResults(null)
    },
    [debouncedSearch, filters],
  )

  const updateFilters = useCallback(
    (newFilters: SearchFilters) => {
      setFilters(newFilters)
      setCurrentPage(1)
      void performSearch(searchQuery, newFilters, 1)
    },
    [searchQuery, performSearch],
  )

  const clearSearch = useCallback(() => {
    latestRequestId.current += 1
    setSearchQuery('')
    setSearchResults(null)
    setError(null)
    setIsLoading(false)
    setCurrentPage(1)
  }, [])

  const openFile = useCallback(async (file: FileItem) => {
    const response = await window.seekr.file.open(file.fullPath)
    if (!response.ok) setError(response.error)
  }, [])

  const revealFile = useCallback(async (file: FileItem) => {
    const response = await window.seekr.file.reveal(file.fullPath)
    if (!response.ok) setError(response.error)
  }, [])

  const goToPage = useCallback(
    (page: number) => {
      setCurrentPage(page)
      void performSearch(searchQuery, filters, page)
    },
    [searchQuery, filters, performSearch],
  )

  const totalPages = searchResults ? Math.ceil(searchResults.totalCount / ITEMS_PER_PAGE) : 0
  const hasNextPage = currentPage < totalPages
  const hasPrevPage = currentPage > 1

  const nextPage = useCallback(() => {
    if (hasNextPage) goToPage(currentPage + 1)
  }, [hasNextPage, currentPage, goToPage])

  const prevPage = useCallback(() => {
    if (hasPrevPage) goToPage(currentPage - 1)
  }, [hasPrevPage, currentPage, goToPage])

  // The cache previously outlived the index it described, so results stayed
  // stale for up to 10 minutes after a re-index.
  useEffect(() => {
    const unsubscribe = window.seekr.events.onIndexComplete(() => searchCache.clear())
    return unsubscribe
  }, [searchCache])

  return {
    searchQuery,
    setSearchQuery,
    searchResults,
    isLoading,
    error,
    filters,
    currentPage,
    totalPages,
    itemsPerPage: ITEMS_PER_PAGE,
    hasNextPage,
    hasPrevPage,
    search,
    updateFilters,
    clearSearch,
    openFile,
    revealFile,
    goToPage,
    nextPage,
    prevPage,
  }
}
