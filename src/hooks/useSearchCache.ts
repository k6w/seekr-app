import { useState, useCallback, useRef } from 'react';
import { SearchResult, SearchFilters } from '@/types';

interface CacheEntry {
  result: SearchResult;
  timestamp: number;
  filters: SearchFilters;
}

interface SearchCacheOptions {
  maxSize?: number;
  ttl?: number; // Time to live in milliseconds
}

export function useSearchCache(options: SearchCacheOptions = {}) {
  const { maxSize = 100, ttl = 5 * 60 * 1000 } = options; // 5 minutes default TTL
  const cache = useRef<Map<string, CacheEntry>>(new Map());

  const generateCacheKey = useCallback((query: string, filters: SearchFilters): string => {
    const filterKey = JSON.stringify(filters, Object.keys(filters).sort());
    return `${query}:${filterKey}`;
  }, []);

  const isExpired = useCallback((entry: CacheEntry): boolean => {
    return Date.now() - entry.timestamp > ttl;
  }, [ttl]);

  const cleanupExpired = useCallback(() => {
    const now = Date.now();
    for (const [key, entry] of cache.current.entries()) {
      if (now - entry.timestamp > ttl) {
        cache.current.delete(key);
      }
    }
  }, [ttl]);

  const get = useCallback((query: string, filters: SearchFilters): SearchResult | null => {
    const key = generateCacheKey(query, filters);
    const entry = cache.current.get(key);
    
    if (!entry || isExpired(entry)) {
      if (entry) {
        cache.current.delete(key);
      }
      return null;
    }
    
    return entry.result;
  }, [generateCacheKey, isExpired]);

  const set = useCallback((query: string, filters: SearchFilters, result: SearchResult) => {
    const key = generateCacheKey(query, filters);
    
    // Clean up expired entries periodically
    if (cache.current.size > maxSize * 0.8) {
      cleanupExpired();
    }
    
    // If still over limit, remove oldest entries
    if (cache.current.size >= maxSize) {
      const oldestKey = cache.current.keys().next().value;
      if (oldestKey) {
        cache.current.delete(oldestKey);
      }
    }
    
    cache.current.set(key, {
      result,
      timestamp: Date.now(),
      filters: { ...filters }
    });
  }, [generateCacheKey, maxSize, cleanupExpired]);

  const clear = useCallback(() => {
    cache.current.clear();
  }, []);

  const invalidate = useCallback((query?: string) => {
    if (query) {
      // Remove all entries that match the query (regardless of filters)
      for (const key of cache.current.keys()) {
        if (key.startsWith(`${query}:`)) {
          cache.current.delete(key);
        }
      }
    } else {
      clear();
    }
  }, [clear]);

  const getStats = useCallback(() => {
    const entries = Array.from(cache.current.values());
    const expired = entries.filter(isExpired).length;
    
    return {
      size: cache.current.size,
      expired,
      valid: cache.current.size - expired
    };
  }, [isExpired]);

  return {
    get,
    set,
    clear,
    invalidate,
    getStats
  };
}
