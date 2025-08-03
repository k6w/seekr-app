import { useState, useCallback, useRef } from 'react';
import { SearchResult, FileItem, SearchFilters, IpcSearchRequest } from '@/types';
import { useSearchHistory } from './useSearchHistory';
import { useSearchCache } from './useSearchCache';
import { useDebouncedCallback } from './useDebounce';

export function useFileSearch() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(50); // Items per page
  const { addToHistory } = useSearchHistory();
  const searchCache = useSearchCache({ maxSize: 50, ttl: 10 * 60 * 1000 }); // 10 minutes
  const abortControllerRef = useRef<AbortController | null>(null);

  const performSearch = useCallback(async (query: string, searchFilters: SearchFilters = {}, page: number = 1) => {
    if (!query.trim() && Object.keys(searchFilters).length === 0) {
      setSearchResults(null);
      return;
    }

    // Cancel previous search if still running
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const combinedFilters = { ...filters, ...searchFilters };
    const offset = (page - 1) * itemsPerPage;

    // Check cache first (include page in cache key)
    const cacheKey = `${query.trim()}_${JSON.stringify(combinedFilters)}_${page}`;
    const cachedResult = searchCache.get(cacheKey, {});
    if (cachedResult) {
      setSearchResults(cachedResult);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    // Create new abort controller for this search
    abortControllerRef.current = new AbortController();

    try {
      const request: IpcSearchRequest = {
        query: query.trim(),
        filters: combinedFilters,
        limit: itemsPerPage,
        offset: offset
      };

      const response = await window.fileSearchAPI.searchFiles(request);

      // Check if this search was aborted
      if (abortControllerRef.current?.signal.aborted) {
        return;
      }

      if (response.success) {
        setSearchResults(response.data);

        // Cache the result with page info
        const cacheKey = `${query.trim()}_${JSON.stringify(combinedFilters)}_${page}`;
        searchCache.set(cacheKey, {}, response.data);

        // Add to search history with result count
        if (query.trim()) {
          addToHistory(query.trim(), response.data.totalCount);
        }
      } else {
        setError(response.error || 'Search failed');
        setSearchResults(null);
      }
    } catch (err) {
      if (abortControllerRef.current?.signal.aborted) {
        return; // Ignore aborted requests
      }
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      setSearchResults(null);
    } finally {
      if (!abortControllerRef.current?.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [filters, searchCache, addToHistory, itemsPerPage]);

  // Debounced search to avoid too many API calls - only for new searches
  const [debouncedSearch] = useDebouncedCallback((query: string, searchFilters: SearchFilters) => {
    performSearch(query, searchFilters, 1); // Always start from page 1 for new searches
  }, 300);

  const search = useCallback((query: string) => {
    setSearchQuery(query);
    setCurrentPage(1); // Reset to first page on new search
    if (query.trim()) {
      debouncedSearch(query, filters);
    } else {
      setSearchResults(null);
    }
  }, [debouncedSearch, filters]);

  const updateFilters = useCallback((newFilters: SearchFilters) => {
    setFilters(newFilters);
    setCurrentPage(1); // Reset to first page when filters change
    if (searchQuery.trim()) {
      // Use immediate search for filter changes, not debounced
      performSearch(searchQuery, newFilters, 1);
    }
  }, [searchQuery, performSearch]);

  const clearSearch = useCallback(() => {
    // Cancel any ongoing search
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setSearchQuery('');
    setSearchResults(null);
    setError(null);
    setIsLoading(false);
    setCurrentPage(1);
  }, []);

  const openFile = useCallback(async (file: FileItem) => {
    try {
      const response = await window.fileSearchAPI.openFile(file.fullPath);
      if (!response.success) {
        setError(response.error || 'Failed to open file');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open file');
    }
  }, []);

  const revealFile = useCallback(async (file: FileItem) => {
    try {
      const response = await window.fileSearchAPI.openFileLocation(file.fullPath);
      if (!response.success) {
        setError(response.error || 'Failed to reveal file');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reveal file');
    }
  }, []);

  // Pagination functions
  const goToPage = useCallback((page: number) => {
    setCurrentPage(page);
    performSearch(searchQuery, filters, page);
  }, [searchQuery, filters, performSearch]);

  const nextPage = useCallback(() => {
    if (searchResults && currentPage < Math.ceil(searchResults.totalCount / itemsPerPage)) {
      goToPage(currentPage + 1);
    }
  }, [currentPage, searchResults, itemsPerPage, goToPage]);

  const prevPage = useCallback(() => {
    if (currentPage > 1) {
      goToPage(currentPage - 1);
    }
  }, [currentPage, goToPage]);

  // Calculate pagination info
  const totalPages = searchResults ? Math.ceil(searchResults.totalCount / itemsPerPage) : 0;
  const hasNextPage = currentPage < totalPages;
  const hasPrevPage = currentPage > 1;

  return {
    searchQuery,
    setSearchQuery,
    searchResults,
    isLoading,
    error,
    filters,
    currentPage,
    totalPages,
    itemsPerPage,
    hasNextPage,
    hasPrevPage,
    search,
    updateFilters,
    clearSearch,
    openFile,
    revealFile,
    goToPage,
    nextPage,
    prevPage
  };
}
